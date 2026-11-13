import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CandidatesService } from './candidates.service.js';

@Controller()
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get('candidates')
  list(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ) {
    return this.candidates.list(page, pageSize);
  }

  @Get('candidates/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.candidates.timeline(id);
  }

  @Get('candidates/:id')
  get(@Param('id') id: string) {
    return this.candidates.get(id);
  }

  @Post('candidates')
  create(@Body() body: unknown) {
    return this.candidates.create(body);
  }

  @Patch('candidates/:id/stage')
  updateStage(@Param('id') id: string, @Body() body: unknown) {
    return this.candidates.updateStage(id, body);
  }

  @Get('jobs')
  listJobs() {
    return this.candidates.listJobs();
  }
}
