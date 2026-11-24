import { Injectable, Logger } from '@nestjs/common';
import { AiRunStatus, BrowserImportStatus, IntakeStatus } from '@prisma/client';
import { Redis } from 'ioredis';
import { redisConnection } from '../ai/parse.queue.js';
import { maskText } from '../audit/audit.mask.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NOTIFICATION_EVENTS } from './settings-shared.js';

export type ServiceStatus = 'UP' | 'DOWN' | 'NOT_CONFIGURED';

function safeError(text: string | null | undefined): string | null {
  if (!text) return null;
  const masked = maskText(text).replace(/\s+/g, ' ');
  return masked.length > 200 ? `${masked.slice(0, 200)}…` : masked;
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/**
 * 运行监控与恢复入口（FR-ADM-10）：汇总服务连接、各接入通道与异步任务状态。
 *
 * 只返回任务标识、状态、错误码与脱敏后的错误信息，不返回候选人姓名、联系方式或附件；
 * 真正的重试动作回到各领域接口执行，并按领域权限校验，管理权限不隐含业务数据访问权。
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [
      database,
      redis,
      mailboxes,
      mailOutcomes,
      syncEvents,
      syncPending,
      tokens,
      intakeFailures,
      browserFailures,
      aiFailures,
      aiCounts,
      retentionRuns,
      notificationSent,
    ] = await Promise.all([
      this.databaseStatus(),
      this.redisStatus(),
      this.prisma.mailInboxConfig.findMany({
        orderBy: { address: 'asc' },
        select: {
          id: true, address: true, provider: true, active: true, pollIntervalSeconds: true,
          lastPolledAt: true, lastPollStatus: true, lastError: true, lastErrorAt: true,
          consecutiveFailures: true, lastFetchedCount: true, lastCreatedCount: true,
          lastDuplicateCount: true, lastSkippedCount: true,
          // host / username / secretCipher 等连接凭据一律不出监控视图
        },
      }),
      this.prisma.mailMessageLog.groupBy({
        by: ['outcome'],
        where: { createdAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
      this.prisma.dingTalkSyncEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 20 }),
      this.prisma.dingTalkSyncEvent.count({ where: { status: { in: ['RECEIVED', 'QUEUED', 'RUNNING'] } } }),
      this.prisma.systemToken.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.resumeIntake.findMany({
        where: { status: { in: [IntakeStatus.FAILED, IntakeStatus.NEEDS_MANUAL] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, source: true, entryMode: true, status: true, airRunId: true,
          attempts: true, errorCode: true, errorMessage: true, createdAt: true,
        },
      }),
      this.prisma.browserImportTask.findMany({
        where: { status: BrowserImportStatus.FAILED },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, errorStage: true, errorCode: true, errorMessage: true,
          operatorId: true, createdAt: true, completedAt: true,
        },
      }),
      this.prisma.aIRun.findMany({
        where: { status: AiRunStatus.FAILED },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true, type: true, attempts: true, errorCode: true, errorMessage: true, updatedAt: true },
      }),
      this.prisma.aIRun.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.retentionRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.interviewMockNotification.groupBy({
        by: ['action'],
        where: { createdAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
    ]);

    const dingtalkConfigured = ['DINGTALK_CLIENT_ID', 'DINGTALK_CLIENT_SECRET', 'DINGTALK_REDIRECT_URI']
      .every((name) => !!process.env[name]?.trim());
    const activeImap = mailboxes.filter((mailbox) => mailbox.active && mailbox.provider === 'IMAP');

    return {
      generatedAt: now.toISOString(),
      services: { database, redis },
      integrations: [
        {
          key: 'mail',
          name: '招聘邮箱抓取',
          status: activeImap.length ? 'READY' : (mailboxes.length ? 'MOCK_ONLY' : 'NOT_CONFIGURED'),
          detail: `${activeImap.length} 个启用中的 IMAP 邮箱`,
          permission: 'intake:manage',
        },
        {
          key: 'dingtalk.login',
          name: '钉钉登录',
          status: dingtalkConfigured ? 'READY' : 'NOT_CONFIGURED',
          detail: dingtalkConfigured ? '应用凭据已配置' : '缺少 DINGTALK_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI',
        },
        {
          key: 'dingtalk.organization',
          name: '钉钉组织同步',
          status: dingtalkConfigured ? 'READY' : 'NOT_CONFIGURED',
          detail: `待处理事件 ${syncPending} 条`,
          permission: 'organization:sync',
        },
        {
          key: 'dingtalk.oa',
          name: '钉钉 OA 审批',
          status: 'NOT_INTEGRATED',
          detail: 'ATS-024 交付时未接入（ATS-019 进行中），状态以主干为准',
        },
        {
          key: 'dingtalk.notification',
          name: '钉钉通知与日程',
          status: 'NOT_INTEGRATED',
          detail: 'ATS-018 未接入',
        },
        {
          key: 'ai',
          name: 'AI 简历与面试辅助',
          status: 'MOCK',
          detail: 'Mock 通道，产出均为草稿且须人工确认',
        },
        {
          key: 'extension',
          name: '浏览器插件',
          status: 'NOT_INTEGRATED',
          detail: 'ATS-011 未接入；导入 API 与系统令牌已交付',
        },
      ],
      mail: {
        mailboxes: mailboxes.map((mailbox) => ({
          id: mailbox.id,
          address: maskText(mailbox.address),
          provider: mailbox.provider,
          active: mailbox.active,
          pollIntervalSeconds: mailbox.pollIntervalSeconds,
          lastPolledAt: iso(mailbox.lastPolledAt),
          lastPollStatus: mailbox.lastPollStatus,
          lastError: safeError(mailbox.lastError),
          lastErrorAt: iso(mailbox.lastErrorAt),
          consecutiveFailures: mailbox.consecutiveFailures,
          lastFetchedCount: mailbox.lastFetchedCount,
          lastCreatedCount: mailbox.lastCreatedCount,
          lastDuplicateCount: mailbox.lastDuplicateCount,
          lastSkippedCount: mailbox.lastSkippedCount,
        })),
        outcomes24h: Object.fromEntries(mailOutcomes.map((group) => [group.outcome, group._count._all])),
      },
      dingtalk: {
        events: syncEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          status: event.status,
          attempts: event.attempts,
          receivedAt: iso(event.receivedAt),
          processedAt: iso(event.processedAt),
          lastError: safeError(event.lastError),
          retryable: event.status === 'FAILED',
        })),
      },
      tokens: { active: tokens },
      tasks: {
        intakeFailures: intakeFailures.map((intake) => ({
          id: intake.id,
          source: intake.source,
          entryMode: intake.entryMode,
          status: intake.status,
          airRunId: intake.airRunId,
          attempts: intake.attempts,
          errorCode: intake.errorCode,
          errorMessage: safeError(intake.errorMessage),
          createdAt: iso(intake.createdAt),
          retryable: intake.status === IntakeStatus.FAILED && !!intake.airRunId,
        })),
        browserImportFailures: browserFailures.map((task) => ({
          taskId: task.id,
          errorStage: task.errorStage,
          errorCode: task.errorCode,
          errorMessage: safeError(task.errorMessage),
          createdAt: iso(task.createdAt),
          completedAt: iso(task.completedAt),
        })),
        aiFailures: aiFailures.map((run) => ({
          id: run.id,
          type: run.type,
          attempts: run.attempts,
          errorCode: run.errorCode,
          errorMessage: safeError(run.errorMessage),
          updatedAt: iso(run.updatedAt),
        })),
        aiByStatus: Object.fromEntries(aiCounts.map((group) => [group.status, group._count._all])),
        retentionRuns: retentionRuns.map((run) => ({
          id: run.id,
          scope: run.scope,
          cutoff: iso(run.cutoff),
          scanned: run.scanned,
          expired: run.expired,
          deletedFiles: run.deletedFiles,
          detachedIntakes: run.detachedIntakes,
          failedDeletes: run.failedDeletes,
          dryRun: run.dryRun,
          createdAt: iso(run.createdAt),
        })),
      },
      notifications: {
        channel: 'MOCK',
        integrated: false,
        events: NOTIFICATION_EVENTS.map((event) => ({
          ...event,
          sent24h: notificationSent.find((group) => group.action === event.key.split('.')[1])?._count._all ?? 0,
        })),
      },
    };
  }

  private async databaseStatus(): Promise<{ name: string; status: ServiceStatus; detail: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name: 'MySQL', status: 'UP', detail: '连接正常' };
    } catch (error) {
      this.logger.warn(`Database probe failed: ${(error as Error).message}`);
      return { name: 'MySQL', status: 'DOWN', detail: '数据库连接失败' };
    }
  }

  private async redisStatus(): Promise<{ name: string; status: ServiceStatus; detail: string }> {
    if (!process.env.REDIS_URL) {
      return { name: 'Redis', status: 'NOT_CONFIGURED', detail: '未配置 REDIS_URL，队列不可用' };
    }
    const client = new Redis({ ...redisConnection(), lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1 });
    try {
      await client.ping();
      return { name: 'Redis', status: 'UP', detail: '连接正常' };
    } catch (error) {
      this.logger.warn(`Redis probe failed: ${(error as Error).message}`);
      return { name: 'Redis', status: 'DOWN', detail: '缓存与任务队列连接失败' };
    } finally {
      client.disconnect();
    }
  }
}

export type OperationsSnapshot = Awaited<ReturnType<OperationsService['snapshot']>>;
