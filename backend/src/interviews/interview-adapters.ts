import { Injectable } from '@nestjs/common';
import { InterviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export const INTERVIEW_CALENDAR = Symbol('INTERVIEW_CALENDAR');
export const INTERVIEW_NOTIFICATIONS = Symbol('INTERVIEW_NOTIFICATIONS');
export interface InterviewCalendar {
  readonly kind?: string;
  conflicts(interviewerIds: string[], start: Date, end: Date, exceptId?: string): Promise<string[]>;
}
export interface InterviewNotifications {
  notify(action: string, recipients: string[], interviewId: string): Promise<void>;
}
@Injectable()
export class MockInterviewCalendar implements InterviewCalendar {
  constructor(private readonly db: PrismaService) {}
  async conflicts(interviewerIds: string[], start: Date, end: Date, exceptId?: string): Promise<string[]> {
    const possible = await this.db.interview.findMany({ where: { id: exceptId ? { not: exceptId } : undefined, status: { not: InterviewStatus.CANCELLED }, time: { lt: end }, endTime: { gt: start } }, select: { interviewerIds: true, responses: true } });
    return interviewerIds.filter(id => possible.some(row => {
      const responses = row.responses && typeof row.responses === 'object' && !Array.isArray(row.responses) ? row.responses : {};
      return (row.interviewerIds ?? '').split('|').includes(id) && responses[id] === 'ACCEPTED';
    }));
  }
}
@Injectable()
export class MockInterviewNotifications implements InterviewNotifications {
  constructor(private readonly db: PrismaService) {}
  async notify(action: string, recipients: string[], interviewId: string): Promise<void> {
    await this.db.interviewMockNotification.createMany({ data: recipients.map(recipient => ({ interviewId, action, recipient })) });
  }
}
