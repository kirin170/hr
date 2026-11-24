import { Module } from '@nestjs/common';
import { OnboardingRemindersService } from './onboarding-reminders.service.js';
import { CandidatesController } from './candidates.controller.js';
import { CandidatesService } from './candidates.service.js';
import { AuthorizationModule } from '../auth/authorization.module.js';

@Module({
  controllers: [CandidatesController],
  imports: [AuthorizationModule],
  providers: [CandidatesService, OnboardingRemindersService],
})
export class CandidatesModule {}
