import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { OffersService } from '../offers/offers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequisitionsService } from '../requisitions/requisitions.service.js';
import { parseDateOnly, toDateOnly } from '../requisitions/requisition-cycle.js';
import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_ID_PATTERN,
  DingTalkOaClient,
  DingTalkOaError,
  parseApprovalInstanceRef,
  type DingTalkApprovalInstance,
} from './dingtalk-oa.client.js';
import { loadOaConfig, type OaConfig, type OaFieldMap, type OaTemplateKey } from './dingtalk-oa.config.js';
import { dingtalkDepartmentCode, parseDingtalkDepartmentCode } from './dingtalk-department-code.js';
import { OaSyncError, oaErrorCode, oaErrorToHttp } from './dingtalk-oa.errors.js';
import { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';

const ROOT_DEPARTMENT_ID = 1;
/** 发起占用超过该时长仍未回写实例 ID 时允许重新发起，用于清理进程崩溃留下的残留占用。 */
const SUBMITTING_STALE_MS = 5 * 60_000;
/** 单个审批表单控件值的长度上限，避免异常材料把审批单写满。 */
const MAX_FORM_VALUE_CHARS = 10_000;

export type OaCallbackInspection = {
  kind: 'start' | 'finish' | 'terminate';
  template: OaTemplateKey;
  processInstanceId: string;
};

type SyncTrigger = 'callback' | 'manual';

/** 回调触发的落库由系统身份留痕；该身份不是可登录账号，仅用于时间线标识。 */
const SYSTEM_ACTOR: AuthenticatedUser = {
  id: 'system:dingtalk-oa',
  displayName: '钉钉 OA 回调',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [],
};

/**
 * 钉钉 OA 对接（DT-5 录用审批、DT-6 招聘需求审批同步）。
 *
 * 边界：
 * - 系统只“发起一次录用审批实例”和“只读查询实例”，不提供撤销、评论、修改原单的任何能力；
 * - 回调只提供实例 ID，实例状态与表单内容一律回读 OA 接口核实，不信任回调里的结论；
 * - 审批结论只做展示；Offer 阶段结果由人事回填，招聘需求生成走 oaApprovalId 幂等；
 * - 审批材料固定为简历信息、面试登记表、录用职级三项，不含面试评价、AI 建议和薪资。
 */
@Injectable()
export class DingTalkOaService {
  private readonly logger = new Logger(DingTalkOaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: DingTalkOaClient,
    private readonly requisitions: RequisitionsService,
    private readonly offers: OffersService,
    private readonly queue: DingTalkSyncQueueService,
  ) {}

  /** 供管理端展示真实配置状态；未配置时页面只保留人工通道，不产生模拟数据。 */
  capability() {
    const config = loadOaConfig();
    return {
      valid: config.valid,
      code: config.code,
      requisition: { configured: config.valid && !!config.requisition.processCode },
      offer: {
        configured: config.valid && !!config.offer.processCode,
        approverLevelSizes: config.offer.approverLevels.map((level) => level.length),
        approverAction: config.offer.approverAction,
      },
      note: '未配置 OA 模板时不发起、不同步，招聘需求与 OA 单号仍可人工处理',
    };
  }

  /**
   * 回调来源核对：只接受“已配置模板 + 合法实例 ID + 已知变更类型”的事件。
   * 其他审批模板、缺 processCode 或格式异常的事件一律忽略，不落库、不触发任何业务。
   */
  inspectApprovalCallback(payload: Record<string, unknown>): OaCallbackInspection | null {
    const processInstanceId = parseApprovalInstanceRef(
      payload.processInstanceId ?? payload.ProcessInstanceId,
    );
    const kind = text(payload.type)?.toLowerCase();
    if (!processInstanceId || !kind || !['start', 'finish', 'terminate'].includes(kind)) return null;
    const template = this.templateFor(text(payload.processCode));
    return template
      ? { kind: kind as OaCallbackInspection['kind'], template, processInstanceId }
      : null;
  }

  /** 人事查看 OA 同步事件状态：仅限审批事件，失败项可人工重试或改用人工触发同步。 */
  async listApprovalEvents(limit = 50) {
    return this.prisma.dingTalkSyncEvent.findMany({
      where: { eventType: { startsWith: `${APPROVAL_EVENT_TYPE}:` } },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        eventType: true,
        subjectId: true,
        status: true,
        attempts: true,
        receivedAt: true,
        processedAt: true,
        lastError: true,
      },
    });
  }

  /** 只允许重试审批事件，避免持有招聘需求同步权限的人重试组织同步事件。 */
  async retryApprovalEvent(id: string) {
    const event = await this.prisma.dingTalkSyncEvent.findUnique({ where: { id } });
    if (!event?.eventType.startsWith(`${APPROVAL_EVENT_TYPE}:`)) {
      throw new NotFoundException('OA 同步事件不存在');
    }
    return this.queue.retryFailed(id);
  }

  /** 由同步 Worker 调用：eventType 形如 bpms_instance_change:finish:requisition。 */
  async processApprovalEvent(event: {
    id: string;
    eventType: string;
    subjectId: string | null;
  }): Promise<void> {
    const [, kind, template] = event.eventType.split(':');
    const processInstanceId = event.subjectId ?? '';
    if (!APPROVAL_INSTANCE_ID_PATTERN.test(processInstanceId)) {
      throw new OaSyncError('OA_INSTANCE_ID_INVALID', '审批实例标识无效', 400);
    }
    if (template === 'requisition') {
      // 只有审批正常结束才生成需求；实例开始、撤销都不产生招聘需求。
      if (kind !== 'finish') return;
      await this.applyRequisition(processInstanceId, {
        trigger: 'callback',
        processCodeVerified: true,
        recruitmentStartDate: undefined,
        actor: SYSTEM_ACTOR,
      });
      return;
    }
    if (template === 'offer') {
      if (kind === 'start') return;
      await this.syncOfferStatus(processInstanceId, 'callback');
      return;
    }
    throw new OaSyncError('OA_TEMPLATE_UNKNOWN', '审批模板未识别', 400);
  }

  /** 人工触发同步（FR-REQ-1）：按审批实例 ID 或详情链接回读 OA，幂等生成招聘需求。 */
  async syncRequisition(value: unknown, actor: AuthenticatedUser) {
    // 入口校验与回读失败都转换为带 code 的 HTTP 异常，不把内部错误类型暴露给框架默认的 500。
    try {
      const input = asRecord(value);
      if (!input) throw new OaSyncError('OA_SYNC_INPUT_INVALID', '请求体必须是 JSON 对象', 400);
      const processInstanceId = parseApprovalInstanceRef(
        input.processInstanceId ?? input.processInstanceRef ?? input.oaApprovalId,
      );
      if (!processInstanceId) {
        throw new OaSyncError('OA_INSTANCE_ID_REQUIRED', '请提供 OA 审批实例 ID 或审批详情链接', 400);
      }
      // 人工同步允许补录开始招聘时间（FR-REQ-2：生成需求时必须填写）；回调路径不允许补录。
      let recruitmentStartDate: Date | undefined;
      if (
        input.recruitmentStartDate !== undefined &&
        input.recruitmentStartDate !== null &&
        input.recruitmentStartDate !== ''
      ) {
        const parsed = strictDate(input.recruitmentStartDate);
        if (!parsed) throw new OaSyncError('OA_START_DATE_INVALID', '开始招聘时间必须为有效日期', 400);
        recruitmentStartDate = parsed;
      }
      return await this.applyRequisition(processInstanceId, {
        trigger: 'manual',
        processCodeVerified: false,
        recruitmentStartDate,
        actor,
      });
    } catch (error) {
      throw oaErrorToHttp(error, '同步 OA 招聘需求');
    }
  }

  /** 人事在系统内发起钉钉 OA 录用审批：材料三项、两级审批人、发起人为当前操作人。 */
  async submitOfferApproval(candidateId: string, actor: AuthenticatedUser) {
    const config = this.offerTemplate();
    const candidate = await this.offers.assertOfferCandidate(candidateId, actor);
    const offer = await this.prisma.offerRecord.findUnique({ where: { candidateId } });
    if (!offer || offer.jobId !== candidate.jobId) throw new NotFoundException('Offer 不存在');
    if (offer.oaInstanceId) throw new ConflictException('OA 审批已由系统发起，请勿重复发起');
    if (
      offer.stageStatus === 'NOT_PASSED' ||
      !['APPROVAL_MATERIALS', 'OA_APPROVAL'].includes(offer.workflowStage ?? '')
    ) {
      throw new ConflictException('仅在录用审批资料或 OA 审批阶段可发起 OA 审批');
    }
    if (!offer.hireLevel?.trim()) {
      throw new ConflictException('请先保存录用职级，再发起 OA 审批');
    }

    // 审批发起人必须是已绑定钉钉身份的当前操作人，不能代他人发起。
    const identity = await this.prisma.identityLink.findUnique({
      where: { provider_userId: { provider: IdentityProvider.DINGTALK, userId: actor.id } },
      select: { subject: true },
    });
    if (!identity) throw new ConflictException('当前操作人未绑定钉钉身份，无法作为审批发起人');

    const materials = await this.offerMaterials(candidateId, offer, config.fieldMap, actor);
    const deptId = await this.originatorDepartmentId(actor);

    // 先占用再调用钉钉：并发点击或跨实例部署下只有一个请求能真正发起。
    const staleBefore = new Date(Date.now() - SUBMITTING_STALE_MS);
    const claim = await this.prisma.offerRecord.updateMany({
      where: {
        id: offer.id,
        oaInstanceId: null,
        workflowVersion: offer.workflowVersion,
        OR: [
          { oaInstanceStatus: null },
          { oaInstanceStatus: 'SUBMITTING', updatedAt: { lt: staleBefore } },
        ],
      },
      data: { oaInstanceStatus: 'SUBMITTING' },
    });
    if (!claim.count) {
      throw new ConflictException(
        offer.oaInstanceStatus === 'SUBMITTING'
          ? 'OA 审批正在发起，请稍后刷新状态'
          : 'Offer 已变化，请刷新后重试',
      );
    }

    let instanceId: string;
    try {
      instanceId = (
        await this.client.startInstance({
          processCode: config.processCode!,
          originatorUserId: identity.subject,
          deptId,
          formComponentValues: materials,
          approvers: config.approverLevels.map((userIds) => ({
            actionType: userIds.length > 1 ? config.approverAction : 'NONE',
            userIds,
          })),
        })
      ).id;
    } catch (error) {
      // 平台明确拒绝时实例一定没有创建，可释放占用；超时、网络、限流的结果未知，保留占用防止重复发起。
      if (error instanceof DingTalkOaError && error.kind !== 'UNAVAILABLE') {
        await this.prisma.offerRecord.updateMany({
          where: { id: offer.id, oaInstanceStatus: 'SUBMITTING' },
          data: { oaInstanceStatus: null },
        });
      }
      this.logger.warn(`DingTalk OA offer approval start failed: ${oaErrorCode(error)}`);
      throw oaErrorToHttp(error, '发起 OA 审批');
    }

    await this.prisma.offerRecord.updateMany({
      where: { id: offer.id, oaInstanceStatus: 'SUBMITTING' },
      data: {
        oaInstanceId: instanceId,
        oaApprovalId: offer.oaApprovalId?.trim() || instanceId,
        oaInstanceStatus: 'RUNNING',
        oaInstanceResult: null,
        oaSyncedAt: new Date(),
        oaSource: 'DINGTALK',
      },
    });
    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'Candidate',
        entityId: candidateId,
        actorId: actor.id,
        action: 'offer.oa_submitted',
        payload: {
          instanceId,
          originatorUserId: identity.subject,
          approverLevelSizes: config.approverLevels.map((level) => level.length),
          materialKeys: Object.keys(config.fieldMap).filter((key) => config.fieldMap[key]),
        },
      },
    });
    return { offer: await this.offers.read(candidateId, actor) };
  }

  /** 人工刷新系统发起的 OA 实例状态；只更新展示字段，不改变阶段结果。 */
  async refreshOfferApproval(candidateId: string, actor: AuthenticatedUser) {
    await this.offers.assertOfferCandidate(candidateId, actor);
    const offer = await this.prisma.offerRecord.findUnique({ where: { candidateId } });
    if (!offer?.oaInstanceId) {
      throw new ConflictException('该 Offer 的 OA 单号为人工回填，没有系统发起的审批实例可刷新');
    }
    try {
      const result = await this.syncOfferStatus(offer.oaInstanceId, 'manual');
      return { offer: await this.offers.read(candidateId, actor), ...result };
    } catch (error) {
      throw oaErrorToHttp(error, '刷新 OA 审批状态');
    }
  }

  private async applyRequisition(
    processInstanceId: string,
    context: {
      trigger: SyncTrigger;
      processCodeVerified: boolean;
      recruitmentStartDate: Date | undefined;
      actor: AuthenticatedUser;
    },
  ) {
    const config = this.templateConfig('requisition');
    const instance = await this.readInstance(processInstanceId);
    // 只有“审批正常结束且结论为同意”才生成需求；撤销、拒绝、审批中一律不生成。
    if (instance.status !== 'COMPLETED' || instance.result !== 'agree') {
      throw new OaSyncError(
        'OA_APPROVAL_NOT_APPROVED',
        `OA 审批尚未通过（${instance.status}${instance.result ? ` / ${instance.result}` : ''}），不生成招聘需求`,
        409,
      );
    }
    const mapped = await this.mapRequisition(instance, config.fieldMap);
    const recruitmentStartDate = context.recruitmentStartDate ?? mapped.recruitmentStartDate;
    if (!recruitmentStartDate) {
      throw new OaSyncError(
        'OA_RECRUITMENT_START_DATE_MISSING',
        'OA 审批表单未填写开始招聘时间；请人工触发同步并补充开始招聘时间',
        400,
      );
    }

    const result = await this.requisitions.syncFromOa(
      {
        oaApprovalId: instance.processInstanceId,
        oaApprovalTitle: instance.title,
        oaBusinessId: instance.businessId,
        title: mapped.title,
        departmentId: mapped.departmentId,
        headcount: mapped.headcount,
        // 需求提报时间取 OA 实例提交时间，按业务时区（北京时间）取日。
        submittedAt: businessDate(instance.createTime ?? instance.finishTime ?? new Date()),
        recruitmentStartDate: toDateOnly(recruitmentStartDate),
        jobLevel: mapped.jobLevel,
        recruiterId: mapped.recruiterId,
        note: mapped.note,
        requirements: mapped.requirements,
      },
      context.actor,
      { trigger: context.trigger, processCodeVerified: context.processCodeVerified },
    );
    return {
      ...result,
      oa: {
        processInstanceId: instance.processInstanceId,
        businessId: instance.businessId,
        title: instance.title,
        status: instance.status,
        result: instance.result,
        finishedAt: instance.finishTime?.toISOString() ?? null,
      },
    };
  }

  /** 把 OA 实例表单映射为招聘需求字段；必填字段缺失或无法映射时拒绝生成。 */
  private async mapRequisition(instance: DingTalkApprovalInstance, fieldMap: OaFieldMap) {
    // 映射值 null 表示该模板没有这个字段；空值表示表单里有该字段但未填写。
    const pick = (key: string): string | null | undefined => {
      const label = fieldMap[key];
      if (label === null || label === undefined) return undefined;
      const matched = instance.form.filter(
        (field) => field.name === label || field.id === label || field.bizAlias === label,
      );
      if (!matched.length) return undefined;
      const value = matched.map((field) => field.value ?? '').filter(Boolean).join('\n').trim();
      return value || '';
    };
    const required = (key: string): string => {
      const value = pick(key);
      if (!value) {
        throw new OaSyncError(
          `OA_FIELD_MISSING_${key.toUpperCase()}`,
          `OA 审批表单缺少必填字段“${fieldMap[key]}”`,
          400,
        );
      }
      return value;
    };

    const title = required('title');
    const departmentValue = required('department');
    const headcountRaw = required('headcount');
    const headcount = /^\d+$/.test(headcountRaw) ? Number(headcountRaw) : Number.NaN;
    if (!Number.isInteger(headcount) || headcount <= 0) {
      throw new OaSyncError('OA_HEADCOUNT_INVALID', 'OA 审批表单的招聘人数不是正整数', 400);
    }
    const departmentId = await this.resolveDepartment(departmentValue);
    if (!departmentId) {
      throw new OaSyncError(
        'OA_DEPARTMENT_UNMAPPED',
        'OA 需求部门尚未同步为本系统部门，请先完成组织同步或由管理员核对部门映射',
        409,
      );
    }
    const recruiterValue = pick('recruiter');
    const startDateRaw = pick('recruitmentStartDate');
    const startDate = startDateRaw ? strictDate(startDateRaw.slice(0, 10)) : null;

    return {
      title,
      departmentId,
      headcount,
      jobLevel: pick('jobLevel') ?? null,
      recruiterId: recruiterValue ? await this.resolveRecruiter(recruiterValue) : null,
      recruitmentStartDate: startDate,
      note: pick('note') ?? null,
      requirements: pick('requirements') ?? null,
    };
  }

  private async resolveDepartment(value: string): Promise<string | null> {
    // 1) 钉钉部门控件：值为 deptId 列表，按组织同步写入的部门编码直接定位。
    const corpId = this.corpId();
    const items = parseList(value);
    for (const item of items) {
      if (!/^[1-9]\d*$/.test(item)) continue;
      const department = await this.prisma.department.findFirst({
        where: { code: dingtalkDepartmentCode(corpId, Number(item)), isActive: true },
        select: { id: true },
      });
      if (department) return department.id;
    }
    // 2) 文本控件：按部门名称精确匹配且必须唯一，不猜测同名部门。
    const names = items.filter((item) => !/^[1-9]\d*$/.test(item));
    if (!names.length) return null;
    const matches = await this.prisma.department.findMany({
      where: { name: { in: names }, isActive: true },
      select: { id: true },
      take: 2,
    });
    return matches.length === 1 ? matches[0]!.id : null;
  }

  private async resolveRecruiter(value: string): Promise<string | null> {
    // 仅按“钉钉 userId ↔ User”一对一身份映射解析，不按姓名猜测招聘负责人。
    for (const subject of parseList(value)) {
      const identity = await this.prisma.identityLink.findUnique({
        where: { provider_subject: { provider: IdentityProvider.DINGTALK, subject } },
        select: { userId: true },
      });
      if (identity) return identity.userId;
    }
    return null;
  }

  /**
   * 审批材料固定三项：简历信息（白名单字段，不含联系方式）、面试登记表、录用职级。
   * 复用 Offer 材料预览的同一套过滤规则，因此不会带入面试评价、AI 建议或薪资字段。
   */
  private async offerMaterials(
    candidateId: string,
    offer: { jobId: string; hireLevel: string | null },
    fieldMap: OaFieldMap,
    actor: AuthenticatedUser,
  ): Promise<{ name: string; value: string }[]> {
    const [preview, job] = await Promise.all([
      this.offers.preview(candidateId, actor),
      this.prisma.job.findUnique({ where: { id: offer.jobId }, select: { title: true } }),
    ]);
    const jobTitle = job?.title ?? '';
    const registration = preview.registration;
    const materials: Record<string, string> = {
      candidate: [preview.resume.name, jobTitle ? `应聘职位：${jobTitle}` : ''].filter(Boolean).join('\n'),
      job: jobTitle,
      resume: renderResume(preview.resume),
      registration: registration ? renderRegistration(registration) : '候选人尚未填写面试登记表',
      hireLevel: offer.hireLevel!.trim(),
    };
    return Object.entries(materials)
      .filter(([key]) => fieldMap[key])
      .map(([key, value]) => ({ name: fieldMap[key]!, value: value.slice(0, MAX_FORM_VALUE_CHARS) }));
  }

  private async originatorDepartmentId(actor: AuthenticatedUser): Promise<number> {
    if (actor.departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: actor.departmentId },
        select: { code: true },
      });
      const externalId = parseDingtalkDepartmentCode(department?.code);
      if (externalId) return externalId;
    }
    const fallback = process.env.DINGTALK_OA_ORIGINATOR_DEPT_ID?.trim();
    return fallback && /^[1-9]\d*$/.test(fallback) ? Number(fallback) : ROOT_DEPARTMENT_ID;
  }

  private async syncOfferStatus(processInstanceId: string, trigger: SyncTrigger) {
    const offer = await this.prisma.offerRecord.findFirst({
      where: { oaInstanceId: processInstanceId },
    });
    // 实例不属于任何系统发起的 Offer（例如人事直接在钉钉里发起）时不处理。
    if (!offer) return { matched: false };
    const instance = await this.readInstance(processInstanceId);
    const changed =
      offer.oaInstanceStatus !== instance.status || offer.oaInstanceResult !== instance.result;
    await this.prisma.offerRecord.updateMany({
      where: { id: offer.id, oaInstanceId: processInstanceId },
      data: { oaInstanceStatus: instance.status, oaInstanceResult: instance.result, oaSyncedAt: new Date() },
    });
    if (changed) {
      await this.prisma.timelineEvent.create({
        data: {
          entityType: 'Candidate',
          entityId: offer.candidateId,
          actorId: trigger === 'callback' ? SYSTEM_ACTOR.id : null,
          action: 'offer.oa_synced',
          payload: { instanceId: processInstanceId, status: instance.status, result: instance.result, trigger },
        },
      });
    }
    return { matched: true, changed, status: instance.status, result: instance.result };
  }

  private templateConfig<K extends OaTemplateKey>(template: K): OaConfig[K] {
    const config = loadOaConfig();
    if (!config.valid) {
      throw new OaSyncError(config.code ?? 'OA_CONFIG_INVALID', '钉钉 OA 配置无效，请联系管理员检查环境变量', 503);
    }
    if (!config[template].processCode) {
      throw new OaSyncError(
        `OA_${template.toUpperCase()}_TEMPLATE_NOT_CONFIGURED`,
        template === 'requisition'
          ? '钉钉 OA 招聘需求审批模板尚未配置'
          : '钉钉 OA 录用审批模板尚未配置',
        503,
      );
    }
    return config[template];
  }

  /** 人工入口的配置错误直接以 HTTP 状态返回，不进入同步事件。 */
  private offerTemplate(): OaConfig['offer'] {
    try {
      return this.templateConfig('offer');
    } catch (error) {
      throw oaErrorToHttp(error, '发起 OA 审批');
    }
  }

  private templateFor(processCode: string | null): OaTemplateKey | null {
    if (!processCode) return null;
    const config = loadOaConfig();
    if (!config.valid) return null;
    if (config.requisition.processCode === processCode) return 'requisition';
    if (config.offer.processCode === processCode) return 'offer';
    return null;
  }

  private async readInstance(processInstanceId: string): Promise<DingTalkApprovalInstance> {
    try {
      return await this.client.getInstance(processInstanceId);
    } catch (error) {
      if (error instanceof DingTalkOaError) {
        if (error.kind === 'NOT_FOUND' || error.kind === 'INVALID') {
          throw new OaSyncError('OA_INSTANCE_NOT_FOUND', 'OA 审批实例不存在或应用无权查看', 404);
        }
        if (error.kind === 'DENIED') {
          throw new OaSyncError('OA_INSTANCE_DENIED', '应用缺少 OA 审批实例读取权限，请联系管理员', 403);
        }
        if (error.kind === 'NOT_CONFIGURED') {
          throw new OaSyncError('OA_NOT_CONFIGURED', '钉钉 OA 正式接入尚未配置', 503);
        }
      }
      // 限流、网络、服务端错误：保留可重试错误，由同步队列退避重试。
      throw error;
    }
  }

  private corpId(): string {
    const corpId = process.env.DINGTALK_CORP_ID?.trim();
    if (!corpId) throw new OaSyncError('OA_NOT_CONFIGURED', '钉钉正式接入尚未配置', 503);
    return corpId;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 钉钉成员/部门控件的值：`["a","b"]`、`[1,2]` 或 `a,b`；统一为去空白的字符串列表。 */
function parseList(value: string): string[] {
  const trimmed = value.trim();
  const items: unknown[] = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) items.push(...parsed);
    } catch {
      items.push(trimmed);
    }
  } else {
    items.push(...trimmed.split(/[,，\n]+/));
  }
  return items.flatMap((item) => {
    const itemText = typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '';
    return itemText ? [itemText] : [];
  });
}

/** 需求提报时间按业务时区取日；钉钉返回 UTC 时间，直接取 UTC 日期在北京时间 0-8 点会差一天。 */
function businessDate(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

/** 严格 yyyy-MM-dd：复用需求模块的日期校验，拒绝 2026-02-30 这类会被自动进位的无效日期。 */
function strictDate(value: unknown): Date | null {
  return parseDateOnly(value);
}

/** 审批单里允许出现的简历字段；电话、邮箱等联系方式不在其中。 */
const RESUME_LABELS: [string, string][] = [
  ['name', '姓名'],
  ['experience', '工作年限'],
  ['education', '学历'],
  ['school', '学校'],
  ['currentCompany', '当前公司'],
  ['currentTitle', '当前职位'],
];

const EXCLUDED_MATERIAL = /薪|salary|pay|compensation|评级|评估|评价|结论|建议|\bai\b|电话|手机|邮箱|联系|phone|email|contact/i;

function renderResume(resume: Record<string, unknown>): string {
  const lines = RESUME_LABELS.flatMap(([key, label]) => {
    const value = resume[key];
    return value === null || value === undefined || value === '' ? [] : [`${label}：${displayMaterialValue(value)}`];
  });
  const history = Array.isArray(resume.workHistory) ? resume.workHistory : [];
  if (history.length) {
    lines.push('工作经历：');
    for (const item of history) {
      const row = asRecord(item);
      if (row) {
        lines.push(`- ${[row.company, row.title, row.period].filter(Boolean).map(String).join(' / ')}`);
      }
    }
  }
  return lines.join('\n');
}

function renderRegistration(registration: { fields: unknown[]; values: Record<string, unknown> }): string {
  const lines = registration.fields.flatMap((field) => {
    const row = asRecord(field);
    if (!row) return [];
    const key = displayMaterialValue(row.key);
    const label = typeof row.label === 'string' && row.label ? row.label : key;
    // Offer 预览已过滤薪资、AI 建议和未授权联系方式；这里再拦一次，避免规则被改动后泄漏到审批单。
    if (EXCLUDED_MATERIAL.test(`${key} ${label}`)) return [];
    return [`${label}：${displayMaterialValue(registration.values[key])}`];
  });
  return lines.length ? lines.join('\n') : '（无登记表字段）';
}

function displayMaterialValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未填写';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(displayMaterialValue).join('、');
  return JSON.stringify(value);
}
