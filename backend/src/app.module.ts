import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CandidatesModule } from './candidates/candidates.module.js';
import { IntakeModule } from './intake/intake.module.js';
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
    CandidatesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
