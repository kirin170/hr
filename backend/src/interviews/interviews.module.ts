import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { DingTalkMinutesClient, MINUTES_SOURCE } from '../dingtalk/dingtalk-minutes.client.js';
import { DingTalkApiClient } from '../dingtalk/dingtalk-api.client.js';
import { DingTalkCalendarClient } from '../dingtalk/dingtalk-calendar.client.js';
import { DingTalkCalendarIdentities } from '../dingtalk/dingtalk-calendar-identities.js';
import { DingTalkReadonlyInterviewCalendar } from './dingtalk-readonly-calendar.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { INTERVIEW_CALENDAR, INTERVIEW_NOTIFICATIONS, MockInterviewCalendar, MockInterviewNotifications } from './interview-adapters.js';
import { InterviewTranscriptsService } from './interview-transcripts.service.js';
import { InterviewsController, InterviewRegistrationController } from './interviews.controller.js';
import { InterviewsService } from './interviews.service.js';
@Module({ imports: [AuthorizationModule, TimelineModule], controllers: [InterviewsController, InterviewRegistrationController], providers: [InterviewsService, InterviewTranscriptsService, DingTalkMinutesClient, DingTalkApiClient, DingTalkCalendarClient, DingTalkCalendarIdentities, DingTalkReadonlyInterviewCalendar, MockInterviewCalendar, { provide: MINUTES_SOURCE, useExisting: DingTalkMinutesClient }, { provide: INTERVIEW_CALENDAR, useFactory: (mock: MockInterviewCalendar, live: DingTalkReadonlyInterviewCalendar) => process.env.DINGTALK_CALENDAR_MODE === 'live-readonly' ? live : mock, inject: [MockInterviewCalendar, DingTalkReadonlyInterviewCalendar] }, { provide: INTERVIEW_NOTIFICATIONS, useClass: MockInterviewNotifications }] })
export class InterviewsModule {}
