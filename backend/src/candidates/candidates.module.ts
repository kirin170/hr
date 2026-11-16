import { Module } from '@nestjs/common';
import { CandidatesController } from './candidates.controller.js';
import { CandidatesService } from './candidates.service.js';
import { AuthorizationModule } from '../auth/authorization.module.js';

@Module({
  controllers: [CandidatesController],
  imports: [AuthorizationModule],
  providers: [CandidatesService],
})
export class CandidatesModule {}
