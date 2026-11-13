import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AiRunService } from './ai-run.service.js';

@Controller('api/v1/ai-runs')
export class AiRunController {
  constructor(private readonly aiRuns: AiRunService) {}

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.aiRuns.getRun(id);
  }

  @Post(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() body: { actorId?: string } = {},
  ) {
    return this.aiRuns.confirmRun(id, body?.actorId ?? null);
  }
}
