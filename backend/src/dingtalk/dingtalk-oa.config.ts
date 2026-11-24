/**
 * 钉钉 OA 两类审批模板的部署侧配置（DT-5 / DT-6）。
 * 表单字段映射依赖各企业自己的审批模板，默认值只是常见命名，必须由部署方按实际模板确认或覆盖。
 * 所有配置只从环境注入；本文件不读取、不输出任何密钥。
 */

export type OaTemplateKey = 'requisition' | 'offer';

export type OaFieldMap = Record<string, string | null>;

export type OaApproverAction = 'AND' | 'OR' | 'NONE';

export type OaTemplateConfig = {
  processCode: string | null;
  fieldMap: OaFieldMap;
};

export type OaConfig = {
  /** 配置本身是否可用（JSON 可解析、取值合法）；为 false 时 code 说明原因 */
  valid: boolean;
  code: string | null;
  requisition: OaTemplateConfig;
  offer: OaTemplateConfig & { approverLevels: string[][]; approverAction: OaApproverAction };
};

/** 招聘需求审批表单 → 招聘需求字段；值为 null 表示表单没有该字段，不做映射。 */
export const REQUISITION_FIELD_DEFAULTS: OaFieldMap = {
  title: '需求名称',
  department: '需求部门',
  headcount: '招聘人数',
  jobLevel: '职级',
  recruitmentStartDate: '开始招聘时间',
  recruiter: '招聘负责人',
  note: '备注',
  requirements: '招聘要求',
};

/** 录用审批表单只允许这三项材料，禁止出现面试评级、AI 建议或薪资字段。 */
export const OFFER_FIELD_DEFAULTS: OaFieldMap = {
  candidate: '候选人',
  job: '申请职位',
  resume: '简历信息',
  registration: '面试登记表',
  hireLevel: '录用职级',
};

export const OA_REQUISITION_FIELDS = Object.keys(REQUISITION_FIELD_DEFAULTS) as (keyof OaFieldMap)[];
export const OA_OFFER_FIELDS = Object.keys(OFFER_FIELD_DEFAULTS) as (keyof OaFieldMap)[];

const ENV_KEYS = {
  requisitionProcessCode: 'DINGTALK_OA_REQUISITION_PROCESS_CODE',
  requisitionFieldMap: 'DINGTALK_OA_REQUISITION_FIELD_MAP',
  offerProcessCode: 'DINGTALK_OA_OFFER_PROCESS_CODE',
  offerFieldMap: 'DINGTALK_OA_OFFER_FIELD_MAP',
  approversLevel1: 'DINGTALK_OA_OFFER_APPROVERS_LEVEL_1',
  approversLevel2: 'DINGTALK_OA_OFFER_APPROVERS_LEVEL_2',
  approverAction: 'DINGTALK_OA_OFFER_APPROVER_ACTION',
} as const;

export function loadOaConfig(env: Record<string, string | undefined> = process.env): OaConfig {
  const config: OaConfig = {
    valid: true,
    code: null,
    requisition: {
      processCode: requiredCode(env[ENV_KEYS.requisitionProcessCode]),
      fieldMap: { ...REQUISITION_FIELD_DEFAULTS },
    },
    offer: {
      processCode: requiredCode(env[ENV_KEYS.offerProcessCode]),
      fieldMap: { ...OFFER_FIELD_DEFAULTS },
      approverLevels: [],
      approverAction: 'AND',
    },
  };

  mergeFieldMap(config, 'requisition', env[ENV_KEYS.requisitionFieldMap], REQUISITION_FIELD_DEFAULTS);
  mergeFieldMap(config, 'offer', env[ENV_KEYS.offerFieldMap], OFFER_FIELD_DEFAULTS);

  const level1 = splitUserIds(env[ENV_KEYS.approversLevel1]);
  const level2 = splitUserIds(env[ENV_KEYS.approversLevel2]);
  // 两级审批人要么同时配置（人事经理 → 人事主管），要么都不配置并沿用 OA 模板自身的流程。
  if (Boolean(level1.length) !== Boolean(level2.length)) {
    return invalid(config, 'OA_APPROVERS_INCOMPLETE');
  }
  config.offer.approverLevels = level1.length ? [level1, level2] : [];

  const action = env[ENV_KEYS.approverAction]?.trim().toUpperCase();
  if (action !== undefined && !['AND', 'OR', 'NONE'].includes(action)) {
    return invalid(config, 'OA_APPROVER_ACTION_INVALID');
  }
  if (action) config.offer.approverAction = action as OaApproverAction;

  return config;
}

function requiredCode(value: string | undefined): string | null {
  const code = value?.trim();
  return code ? code : null;
}

function mergeFieldMap(
  config: OaConfig,
  template: OaTemplateKey,
  raw: string | undefined,
  defaults: OaFieldMap,
): void {
  if (raw === undefined || raw.trim() === '') return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid(config, `OA_${template.toUpperCase()}_FIELD_MAP_INVALID`);
    return;
  }  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid(config, `OA_${template.toUpperCase()}_FIELD_MAP_INVALID`);
    return;
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in defaults)) {
      invalid(config, `OA_${template.toUpperCase()}_FIELD_MAP_INVALID`);
      return;
    }
    if (value === null) {
      config[template].fieldMap[key] = null;
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      invalid(config, `OA_${template.toUpperCase()}_FIELD_MAP_INVALID`);
      return;
    }
    config[template].fieldMap[key] = value.trim();
  }
}

function splitUserIds(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]+$/.test(id)))];
}

function invalid(config: OaConfig, code: string): OaConfig {
  config.valid = false;
  config.code ??= code;
  return config;
}
