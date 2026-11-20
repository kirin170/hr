import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { IntakeModule } from '../intake/intake.module.js';
import { MailConfigService } from './mail-config.service.js';
import { MailController } from './mail.controller.js';
import { MailCredentialService } from './mail-credential.service.js';
import { MailPollRunner } from './mail-poll.runner.js';
import { MailPollService } from './mail-poll.service.js';
import { MailSystemActorService } from './mail-system-actor.service.js';

@Module({
  imports: [IntakeModule, AuthorizationModule],
  controllers: [MailController],
  providers: [
    MailCredentialService,
    MailConfigService,
    MailPollService,
    MailPollRunner,
    MailSystemActorService,
  ],
  exports: [MailConfigService, MailPollService],
})
export class MailModule {}
