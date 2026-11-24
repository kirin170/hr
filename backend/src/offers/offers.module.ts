import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { OfferMaterialsController } from './offer-materials.controller.js';
import { OfferMaterialsService } from './offer-materials.service.js';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { OffersController } from './offers.controller.js';
import { OffersService } from './offers.service.js';
@Module({ imports: [AuthorizationModule, AttachmentsModule], controllers: [OffersController, OfferMaterialsController], providers: [OffersService, OfferMaterialsService], exports: [OffersService] })
export class OffersModule {}
