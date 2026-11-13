import { Module } from '@nestjs/common';
import { AiRunController } from './ai-run.controller.js';
import { AiRunService } from './ai-run.service.js';
import { MockModelProvider } from './mock-model.provider.js';
import { MODEL_PROVIDER } from './model-provider.js';
import { ParseQueueService } from './parse.queue.js';
import { ParseWorkerService } from './parse.worker.js';

@Module({
  controllers: [AiRunController],
  providers: [
    MockModelProvider,
    { provide: MODEL_PROVIDER, useExisting: MockModelProvider },
    AiRunService,
    ParseQueueService,
    ParseWorkerService,
  ],
  exports: [AiRunService, ParseQueueService],
})
export class AiModule {}
