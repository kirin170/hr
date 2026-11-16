import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { IntakeController } from './intake.controller.js';
import { IntakeService } from './intake.service.js';
import { AuthorizationModule } from '../auth/authorization.module.js';

@Module({
  imports: [AiModule, AuthorizationModule],
  controllers: [IntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
