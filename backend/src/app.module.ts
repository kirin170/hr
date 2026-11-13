import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CandidatesModule } from './candidates/candidates.module.js';
import { IntakeModule } from './intake/intake.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TimelineModule } from './timeline/timeline.module.js';

@Module({
  imports: [
    PrismaModule,
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
