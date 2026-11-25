import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { AiConfigService } from './ai-config.service.js';
import { AiProviderRouter } from './ai-provider.router.js';
import { AiRunController } from './ai-run.controller.js';
import { AiRunService } from './ai-run.service.js';
import { AiEvalWorkerService } from './ai-run.worker.js';
import { AiSettingsController } from './ai-settings.controller.js';
import { AiEvalQueueService } from './eval.queue.js';
import { ParseQueueService } from './parse.queue.js';
import { ParseWorkerService } from './parse.worker.js';
import { ResumeContentLoader } from './resume-content.loader.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [AiRunController, AiSettingsController],
  providers: [
    AiConfigService,
    AiProviderRouter,
    ResumeContentLoader,
    AiRunService,
    AiEvalQueueService,
    AiEvalWorkerService,
    ParseQueueService,
    ParseWorkerService,
  ],
  exports: [AiRunService, AiConfigService, ParseQueueService],
})
export class AiModule {}
