import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DingTalkAuthController } from './dingtalk-auth.controller.js';
import { DingTalkCallbackController } from './dingtalk-callback.controller.js';
import { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkCallbackCrypto } from './dingtalk-callback-crypto.js';
import { DingTalkSyncController } from './dingtalk-sync.controller.js';
import { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';
import { DingTalkSyncWorker } from './dingtalk-sync.worker.js';

@Module({
  imports: [AuthModule, AuthorizationModule, PrismaModule],
  controllers: [
    DingTalkAuthController,
    DingTalkCallbackController,
    DingTalkSyncController,
  ],
  providers: [
    DingTalkApiClient,
    DingTalkCallbackCrypto,
    DingTalkSyncQueueService,
    DingTalkSyncService,
    DingTalkSyncWorker,
  ],
  exports: [DingTalkApiClient, DingTalkSyncService],
})
export class DingTalkModule {}
