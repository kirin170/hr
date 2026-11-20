import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../prisma/prisma.service.js';
import { IntakeService } from '../intake/intake.service.js';
import { classifyMailAttachments, type MailAttachmentInput } from './mail-attachment.js';
import { MailConfigService } from './mail-config.service.js';
import { MailSystemActorService } from './mail-system-actor.service.js';
import { describeMailError, withImapClient } from './imap.client.js';
import {
  FIRST_POLL_MAX_MESSAGES,
  MAIL_OUTCOME,
  MAIL_PROVIDER,
  type MailOutcome,
} from './mail.constants.js';

/** 单封邮件正文上限，避免超大邮件占满内存 */
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;

export type MailPollResult = {
  configId: string;
  address: string;
  ok: boolean;
  fetched: number;
  created: number;
  duplicate: number;
  skipped: number;
  error?: string;
  startedAt: string;
  finishedAt: string;
};

export type MailPollSummary = {
  polled: number;
  failed: number;
  results: MailPollResult[];
};

type MessageEnvelope = {
  uid: number;
  subject: string | null;
  from: string | null;
  receivedAt: Date | null;
  messageId: string | null;
};

@Injectable()
export class MailPollService {
  private readonly logger = new Logger(MailPollService.name);
  private running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: MailConfigService,
    private readonly intake: IntakeService,
    private readonly systemActor: MailSystemActorService,
  ) {}

  /** 轮询所有到期邮箱；单个邮箱失败不影响其他邮箱 */
  async pollAll(): Promise<MailPollSummary> {
    const due = await this.configs.listDue();
    const results: MailPollResult[] = [];
    for (const config of due) {
      if (this.running.has(config.id)) continue;
      results.push(await this.pollOne(config.id));
    }
    return {
      polled: results.length,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  }

  async pollOne(configId: string): Promise<MailPollResult> {
    const startedAt = new Date();
    const config = await this.configs.requireConfig(configId);

    if (this.running.has(configId)) {
      return this.buildResult(configId, config.address, true, startedAt, {
        skipped: 0,
        error: '该邮箱正在抓取中，已跳过本次触发',
      });
    }
    if (config.provider !== MAIL_PROVIDER.IMAP) {
      return this.buildResult(configId, config.address, false, startedAt, {
        error: '该邮箱为 MOCK 配置，不支持真实轮询',
      });
    }

    this.running.add(configId);
    let fetched = 0;
    let created = 0;
    let duplicate = 0;
    let skipped = 0;

    try {
      const actorId = await this.systemActor.ensureActorId();
      const connection = this.configs.toConnection(config);

      const outcome = await withImapClient(connection, async (client) => {
        const lock = await client.getMailboxLock(config.folder);
        try {
          const mailbox = client.mailbox;
          if (!mailbox) throw new Error('收件箱不可用');
          const uidValidity =
            mailbox.uidValidity === undefined ? null : String(mailbox.uidValidity);
          // UIDVALIDITY 变化意味着 UID 空间重建，必须从头回看，否则会漏抓
          const cursorReset = Boolean(config.lastUidValidity && config.lastUidValidity !== uidValidity);
          const lastUid = cursorReset ? null : config.lastUid;
          const exists = mailbox.exists ?? 0;

          let maxUid = lastUid ? Number(lastUid) : 0;
          if (exists === 0) {
            return { uidValidity, maxUid, fetched, created, duplicate, skipped };
          }

          const range = lastUid
            ? `${Number(lastUid) + 1}:*`
            : `${Math.max(1, exists - FIRST_POLL_MAX_MESSAGES + 1)}:*`;

          for await (const message of client.fetch(
            range,
            { uid: true, envelope: true, source: { maxLength: MAX_MESSAGE_BYTES } },
            { uid: Boolean(lastUid) },
          )) {
            if (lastUid && message.uid <= Number(lastUid)) continue;
            fetched += 1;
            const result = await this.processMessage(config.address, actorId, message);
            created += result.created;
            duplicate += result.duplicate;
            skipped += result.skipped ? 1 : 0;
            if (message.uid > maxUid) maxUid = message.uid;
          }

          return { uidValidity, maxUid, fetched, created, duplicate, skipped };
        } finally {
          lock.release();
        }
      });

      await this.prisma.mailInboxConfig.update({
        where: { id: configId },
        data: {
          lastUidValidity: outcome.uidValidity,
          lastUid: outcome.maxUid ? String(outcome.maxUid) : config.lastUid,
          lastPolledAt: new Date(),
          lastPollStatus: 'OK',
          lastError: null,
          lastErrorAt: null,
          consecutiveFailures: 0,
          lastFetchedCount: outcome.fetched,
          lastCreatedCount: outcome.created,
          lastDuplicateCount: outcome.duplicate,
          lastSkippedCount: outcome.skipped,
        },
      });

      return this.buildResult(configId, config.address, true, startedAt, {
        fetched,
        created,
        duplicate,
        skipped,
      });
    } catch (error) {
      const message = describeMailError(error);
      this.logger.warn(`邮箱 ${config.address} 抓取失败：${message}`);
      await this.prisma.mailInboxConfig
        .update({
          where: { id: configId },
          data: {
            lastPolledAt: new Date(),
            lastPollStatus: 'FAILED',
            lastError: message,
            lastErrorAt: new Date(),
            consecutiveFailures: { increment: 1 },
          },
        })
        .catch(() => {});
      return this.buildResult(configId, config.address, false, startedAt, {
        fetched,
        created,
        duplicate,
        skipped,
        error: message,
      });
    } finally {
      this.running.delete(configId);
    }
  }

  /** 抓取监控：按邮箱查看最近处理记录（FR-ENT-8） */
  async listMessages(configId: string, limit = 20) {
    const config = await this.configs.requireConfig(configId);
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const logs = await this.prisma.mailMessageLog.findMany({
      where: { mailboxAddress: config.address },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return logs.map((log) => ({
      id: log.id,
      messageId: log.messageId,
      uid: log.uid,
      subject: log.subject,
      fromAddress: log.fromAddress,
      receivedAt: log.receivedAt?.toISOString() ?? null,
      outcome: log.outcome,
      detail: log.detail,
      attachmentCount: log.attachmentCount,
      intakeCount: log.intakeCount,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  private async processMessage(
    mailboxAddress: string,
    actorId: string,
    message: FetchMessageObject,
  ): Promise<{ created: number; duplicate: number; skipped: boolean }> {
    const source = message.source;
    if (!source) {
      return { created: 0, duplicate: 0, skipped: true };
    }

    const parsed = await simpleParser(source).catch(() => null);
    const messageId = this.resolveMessageId(parsed?.messageId ?? message.envelope?.messageId, source);
    const envelopeDate = message.envelope?.date;
    const envelope: MessageEnvelope = {
      uid: message.uid,
      subject: parsed?.subject ?? message.envelope?.subject ?? null,
      from:
        parsed?.from?.value?.[0]?.address ??
        message.envelope?.from?.[0]?.address ??
        null,
      receivedAt: parsed?.date ?? (envelopeDate ? new Date(envelopeDate) : null),
      messageId,
    };

    // 幂等键：同一邮箱同一 Message-ID 只处理一次，断点恢复与并发触发都不会重复建档
    try {
      await this.prisma.mailMessageLog.create({
        data: {
          mailboxAddress,
          messageId: envelope.messageId ?? messageId,
          uid: String(message.uid),
          subject: envelope.subject,
          fromAddress: envelope.from,
          receivedAt: envelope.receivedAt,
          outcome: MAIL_OUTCOME.PROCESSING,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return { created: 0, duplicate: 0, skipped: true };
      }
      throw error;
    }

    try {
      const attachments: MailAttachmentInput[] = (parsed?.attachments ?? [])
        .filter((item) => item.content && item.filename)
        .map((item) => ({
          fileName: item.filename ?? 'attachment',
          mimeType: item.contentType ?? 'application/octet-stream',
          buffer: item.content,
        }));

      const classified = await classifyMailAttachments(attachments);
      let created = 0;
      let duplicate = 0;
      let outcome: MailOutcome;
      const detail: string[] = [];

      if (classified.resume.length) {
        const results = await this.intake.ingestEmailAttachments({
          actorId,
          from: envelope.from,
          subject: envelope.subject,
          mailboxAddress,
          receivedAt: envelope.receivedAt ?? new Date(),
          files: classified.resume,
        });
        created = results.filter((item) => !item.duplicate).length;
        duplicate = results.filter((item) => item.duplicate).length;
        const rejected = results.length - created - duplicate;
        outcome = created > 0 ? MAIL_OUTCOME.INGESTED : duplicate > 0 ? MAIL_OUTCOME.DUPLICATE : MAIL_OUTCOME.UNSUPPORTED;
        detail.push(`简历附件 ${classified.resume.length} 个：新建 ${created}，重复 ${duplicate}，拒绝 ${rejected}`);
      } else if (classified.excel.length) {
        outcome = MAIL_OUTCOME.EXCEL;
        detail.push(`Excel 附件 ${classified.excel.length} 个：需走独立表格导入，未进入 AI 解析`);
      } else if (classified.unsupported.length) {
        outcome = MAIL_OUTCOME.UNSUPPORTED;
        detail.push(`不支持的附件 ${classified.unsupported.length} 个：${classified.unsupported.map((item) => item.fileName).join(', ')}`);
      } else {
        outcome = MAIL_OUTCOME.NO_ATTACHMENT;
        detail.push('邮件无简历附件，不建立简历档案');
      }

      if (classified.excel.length && classified.resume.length) {
        detail.push(`另有 Excel 附件 ${classified.excel.length} 个：需走独立表格导入，未进入 AI 解析`);
      }
      if (classified.unsupported.length && classified.resume.length) {
        detail.push(`另有 ${classified.unsupported.length} 个附件格式不支持，已忽略`);
      }

      await this.prisma.mailMessageLog.update({
        where: { mailboxAddress_messageId: { mailboxAddress, messageId: envelope.messageId ?? messageId } },
        data: {
          outcome,
          detail: detail.join('；').slice(0, 2000),
          attachmentCount: attachments.length,
          intakeCount: created,
        },
      });

      return { created, duplicate, skipped: false };
    } catch (error) {
      await this.prisma.mailMessageLog
        .update({
          where: { mailboxAddress_messageId: { mailboxAddress, messageId: envelope.messageId ?? messageId } },
          data: {
            outcome: MAIL_OUTCOME.ERROR,
            detail: describeMailError(error),
          },
        })
        .catch(() => {});
      return { created: 0, duplicate: 0, skipped: true };
    }
  }

  private resolveMessageId(candidate: string | undefined, source: Buffer): string {
    const normalized = candidate?.trim().replace(/^<|>$/g, '');
    if (normalized) return normalized.slice(0, 190);
    // Message-ID 缺失时用正文哈希兜底，保证同一封邮件仍然只处理一次
    return `sha256:${createHash('sha256').update(source).digest('hex')}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(
      error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'P2002',
    );
  }

  private buildResult(
    configId: string,
    address: string,
    ok: boolean,
    startedAt: Date,
    counts: { fetched?: number; created?: number; duplicate?: number; skipped?: number; error?: string },
  ): MailPollResult {
    return {
      configId,
      address,
      ok,
      fetched: counts.fetched ?? 0,
      created: counts.created ?? 0,
      duplicate: counts.duplicate ?? 0,
      skipped: counts.skipped ?? 0,
      error: counts.error,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}
