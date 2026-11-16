import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationController } from './authorization.controller.js';
import { AuthorizationService } from './authorization.service.js';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuthorizationController],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
