import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NOTIFICATION_EVENTS } from './settings-shared.js';

/** 可由用户自行关闭的低优先级事件。 */
export const LOW_PRIORITY_NOTIFICATION_EVENTS = NOTIFICATION_EVENTS.filter((event) => event.lowPriority);

function parseMuted(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'muted' in parsed ? parsed.muted : null;
    if (!Array.isArray(values)) return [];
    return values.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/**
 * 个人通知偏好（FR-ADM-9）：按用户保存在 system_settings，只允许关闭清单中的低优先级事件。
 * 接收角色与高优先级事件由业务规则确定，不提供关闭入口。
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  private key(userId: string): string {
    return `notification.preference.${userId}`;
  }

  async get(userId: string) {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: this.key(userId) } });
    return {
      muted: parseMuted(row?.value),
      closable: LOW_PRIORITY_NOTIFICATION_EVENTS.map((event) => ({ key: event.key, label: event.label })),
      events: NOTIFICATION_EVENTS.map((event) => ({ ...event })),
    };
  }

  async update(userId: string, input: Record<string, unknown>) {
    if (!Array.isArray(input.muted)) throw new BadRequestException('muted 必须为事件标识数组');
    const closable = new Set<string>(LOW_PRIORITY_NOTIFICATION_EVENTS.map((event) => event.key));
    for (const item of input.muted) {
      if (typeof item !== 'string' || !closable.has(item)) {
        throw new BadRequestException('只能关闭清单内的低优先级通知，其余通知由业务规则要求送达');
      }
    }
    const muted = [...new Set(input.muted as string[])];
    await this.prisma.systemSetting.upsert({
      where: { key: this.key(userId) },
      create: { key: this.key(userId), value: JSON.stringify({ muted }) },
      update: { value: JSON.stringify({ muted }) },
    });
    return this.get(userId);
  }
}
