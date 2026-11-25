import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AccessControlGuard } from './access-control.guard.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthorizationModule } from './authorization.module.js';
import { DingTalkIdentityMapper, LocalIdentityAdapter } from './identity.adapters.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SystemTokenService } from './system-token.service.js';

@Global()
@Module({
  imports: [PrismaModule, AuthorizationModule, AuditModule],
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    AuthService,
    SystemTokenService,
    LocalIdentityAdapter,
    DingTalkIdentityMapper,
    RateLimitGuard,
    AccessControlGuard,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AccessControlGuard },
  ],
  exports: [AccessTokenService, AuthService, SystemTokenService],
})
export class AuthModule {}
