import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
