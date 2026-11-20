import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { CampusController } from './campus.controller.js';
import { IntakeController } from './intake.controller.js';
import { IntakeService } from './intake.service.js';
import { BrowserImportController } from './browser-import.controller.js';
import { BrowserImportService } from './browser-import.service.js';
import { AuthorizationModule } from '../auth/authorization.module.js';

@Module({
  imports: [AiModule, AuthorizationModule],
  controllers: [IntakeController, CampusController, BrowserImportController],
  providers: [IntakeService, BrowserImportService],
  exports: [IntakeService, BrowserImportService],
})
export class IntakeModule {}
