import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RequisitionsController } from './requisitions.controller.js';
import { RequisitionsService } from './requisitions.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [RequisitionsController],
  providers: [RequisitionsService],
  exports: [RequisitionsService],
})
export class RequisitionsModule {}
