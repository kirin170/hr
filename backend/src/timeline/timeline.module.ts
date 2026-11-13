import { Global, Module } from '@nestjs/common';
import { TimelineService } from './timeline.service.js';

@Global()
@Module({
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineModule {}
