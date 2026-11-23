import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { DingTalkMinutesClient, MINUTES_SOURCE } from '../dingtalk/dingtalk-minutes.client.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { INTERVIEW_CALENDAR, INTERVIEW_NOTIFICATIONS, MockInterviewCalendar, MockInterviewNotifications } from './interview-adapters.js';
import { InterviewTranscriptsService } from './interview-transcripts.service.js';
import { InterviewsController, InterviewRegistrationController } from './interviews.controller.js';
import { InterviewsService } from './interviews.service.js';
@Module({ imports: [AuthorizationModule, TimelineModule], controllers: [InterviewsController, InterviewRegistrationController], providers: [InterviewsService, InterviewTranscriptsService, DingTalkMinutesClient, { provide: MINUTES_SOURCE, useExisting: DingTalkMinutesClient }, { provide: INTERVIEW_CALENDAR, useClass: MockInterviewCalendar }, { provide: INTERVIEW_NOTIFICATIONS, useClass: MockInterviewNotifications }] })
export class InterviewsModule {}
