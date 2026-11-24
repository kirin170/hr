import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { CandidatesModule } from '../candidates/candidates.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DingTalkMinutesClient, MINUTES_SOURCE } from '../dingtalk/dingtalk-minutes.client.js';
import { DingTalkApiClient } from '../dingtalk/dingtalk-api.client.js';
import { DingTalkCalendarClient } from '../dingtalk/dingtalk-calendar.client.js';
import { DingTalkCalendarIdentities } from '../dingtalk/dingtalk-calendar-identities.js';
import { InterviewCalendarSyncService } from '../dingtalk/interview-calendar-sync.service.js';
import { InterviewCalendarSyncWorker } from '../dingtalk/interview-calendar-sync.worker.js';
import { InterviewReminderScanner } from '../dingtalk/interview-reminder-scanner.js';
import { NotificationOutboxService } from '../dingtalk/notification-outbox.service.js';
import { DingTalkWorkNoticeClient } from '../dingtalk/dingtalk-work-notice.client.js';
import { NotificationDeliveryWorker } from '../dingtalk/notification-delivery.worker.js';
import { OnboardingNotificationScanner } from '../dingtalk/onboarding-notification-scanner.js';
import { ResumeTimeoutScanner } from '../dingtalk/resume-timeout-scanner.js';
import { DingTalkReadonlyInterviewCalendar } from './dingtalk-readonly-calendar.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { INTERVIEW_CALENDAR, INTERVIEW_NOTIFICATIONS, MockInterviewCalendar, MockInterviewNotifications } from './interview-adapters.js';
import { InterviewTranscriptsService } from './interview-transcripts.service.js';
import { InterviewsController, InterviewRegistrationController } from './interviews.controller.js';
import { InterviewsService } from './interviews.service.js';
@Module({ imports: [AuthorizationModule, TimelineModule, CandidatesModule, SettingsModule], controllers: [InterviewsController, InterviewRegistrationController], providers: [InterviewsService, InterviewTranscriptsService, DingTalkMinutesClient, DingTalkApiClient, DingTalkCalendarClient, DingTalkCalendarIdentities, DingTalkReadonlyInterviewCalendar, NotificationOutboxService, InterviewReminderScanner, OnboardingNotificationScanner, ResumeTimeoutScanner, DingTalkWorkNoticeClient, NotificationDeliveryWorker, InterviewCalendarSyncService, InterviewCalendarSyncWorker, MockInterviewCalendar, { provide: MINUTES_SOURCE, useExisting: DingTalkMinutesClient }, { provide: INTERVIEW_CALENDAR, useFactory: (mock: MockInterviewCalendar, live: DingTalkReadonlyInterviewCalendar) => process.env.DINGTALK_CALENDAR_MODE === 'live-readonly' ? live : mock, inject: [MockInterviewCalendar, DingTalkReadonlyInterviewCalendar] }, { provide: INTERVIEW_NOTIFICATIONS, useClass: MockInterviewNotifications }] })
export class InterviewsModule {}
