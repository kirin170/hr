import { Global, Module } from '@nestjs/common';
import { StorageService, createStorageDriver } from './storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: () => new StorageService(createStorageDriver()),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
