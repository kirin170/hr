import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { INTERVIEW_CALENDAR, INTERVIEW_NOTIFICATIONS, MockInterviewCalendar, MockInterviewNotifications } from './interview-adapters.js';
import { InterviewsController, InterviewRegistrationController } from './interviews.controller.js';
import { InterviewsService } from './interviews.service.js';
@Module({ imports: [AuthorizationModule], controllers: [InterviewsController, InterviewRegistrationController], providers: [InterviewsService, { provide: INTERVIEW_CALENDAR, useClass: MockInterviewCalendar }, { provide: INTERVIEW_NOTIFICATIONS, useClass: MockInterviewNotifications }] })
export class InterviewsModule {}
