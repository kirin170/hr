import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { OffersModule } from '../offers/offers.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RequisitionsModule } from '../requisitions/requisitions.module.js';
import { DingTalkAuthController } from './dingtalk-auth.controller.js';
import { DingTalkCallbackController } from './dingtalk-callback.controller.js';
import { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkCallbackCrypto } from './dingtalk-callback-crypto.js';
import { DingTalkMinutesClient, MINUTES_SOURCE } from './dingtalk-minutes.client.js';
import { DingTalkOaClient } from './dingtalk-oa.client.js';
import { DingTalkOaController } from './dingtalk-oa.controller.js';
import { DingTalkOaService } from './dingtalk-oa.service.js';
import { DingTalkSyncController } from './dingtalk-sync.controller.js';
import { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';
import { DingTalkSyncWorker } from './dingtalk-sync.worker.js';

@Module({
  // OA 对接（DT-5/DT-6）复用招聘需求的幂等落库与 Offer 材料预览，不另建一套规则。
  imports: [AuthModule, AuthorizationModule, PrismaModule, RequisitionsModule, OffersModule],
  controllers: [
    DingTalkAuthController,
    DingTalkCallbackController,
    DingTalkSyncController,
    DingTalkOaController,
  ],
  providers: [
    DingTalkApiClient,
    DingTalkCallbackCrypto,
    DingTalkMinutesClient,
    { provide: MINUTES_SOURCE, useExisting: DingTalkMinutesClient },
    DingTalkOaClient,
    DingTalkOaService,
    DingTalkSyncQueueService,
    DingTalkSyncService,
    DingTalkSyncWorker,
  ],
  exports: [DingTalkApiClient, DingTalkSyncService, MINUTES_SOURCE],
})
export class DingTalkModule {}
