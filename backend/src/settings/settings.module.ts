import { Global, Module } from '@nestjs/common';
import { DictSettingsService } from './dict-settings.service.js';
import { FieldConfigService } from './field-config.service.js';
import { NotificationPreferenceService } from './notification-preference.service.js';
import { OperationsService } from './operations.service.js';
import { ReasonSettingsService } from './reason-settings.service.js';
import { NotificationOutboxService } from '../dingtalk/notification-outbox.service.js';
import { SettingsController } from './settings.controller.js';

/**
 * 全局模块：候选人、职位等业务服务通过 FieldConfigService 读取字段必填、渠道与面试方案配置，
 * 因此业务保存路径上的校验与后台配置使用同一份持久化数据。
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [
    ReasonSettingsService,
    DictSettingsService,
    FieldConfigService,
    NotificationPreferenceService,
    NotificationOutboxService,
    OperationsService,
  ],
  exports: [ReasonSettingsService, DictSettingsService, FieldConfigService, NotificationPreferenceService],
})
export class SettingsModule {}
