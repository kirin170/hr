import { Injectable } from '@nestjs/common';
import { DingTalkApiClient } from '../dingtalk/dingtalk-api.client.js';
import { DingTalkCalendarClient, DingTalkCalendarError } from '../dingtalk/dingtalk-calendar.client.js';
import { DingTalkCalendarIdentities } from '../dingtalk/dingtalk-calendar-identities.js';
import type { InterviewCalendar } from './interview-adapters.js';

/** 仅查询忙闲；写入、邀请和通知须由后续持久化同步通道处理。 */
@Injectable()
export class DingTalkReadonlyInterviewCalendar implements InterviewCalendar {
  readonly kind = 'DINGTALK_READONLY';
  constructor(private readonly api: DingTalkApiClient, private readonly client: DingTalkCalendarClient, private readonly identities: DingTalkCalendarIdentities) {}

  async conflicts(interviewerIds: string[], start: Date, end: Date): Promise<string[]> {
    const organizer = process.env.DINGTALK_CALENDAR_OPERATOR_UNION_ID?.trim();
    if (!organizer) throw new DingTalkCalendarError('missing_calendar_operator', false);
    const mapping = await this.identities.resolve(interviewerIds);
    const unionIds = interviewerIds.map(id => {
      const resolved = mapping.get(id);
      if (!resolved) throw new DingTalkCalendarError('identity_not_mapped', false);
      return resolved;
    });
    const busy = new Set(await this.client.busy(await this.api.getAppAccessToken(), organizer, unionIds, start, end));
    return interviewerIds.filter(id => busy.has(mapping.get(id)!));
  }
}
