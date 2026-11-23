import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { CandidatesModule } from './candidates/candidates.module.js';
import { DingTalkModule } from './dingtalk/dingtalk.module.js';
import { InterviewsModule } from './interviews/interviews.module.js';
import { IntakeModule } from './intake/intake.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MailModule } from './mail/mail.module.js';
import { RequisitionsModule } from './requisitions/requisitions.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TimelineModule } from './timeline/timeline.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './auth/authorization.module.js';
import { AuditModule } from './audit/audit.module.js';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthorizationModule,
    AuthModule,
    TimelineModule,
    StorageModule,
    AiModule,
    IntakeModule,
    InterviewsModule,
    CandidatesModule,
    JobsModule,
    RequisitionsModule,
    AttachmentsModule,
    RetentionModule,
    DingTalkModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
