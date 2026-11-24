import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  CYCLE_DIMENSIONS,
  ReportsService,
  type CycleDimension,
  type ReasonReportType,
  type ReportFilters,
} from './reports.service.js';

type FiltersQuery = {
  from?: string;
  to?: string;
  departmentId?: string;
  recruiterId?: string;
  requisitionType?: string;
};

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('filters')
  @RequirePermission('candidate:read')
  filterOptions() {
    return this.reports.filterOptions();
  }

  @Get('funnel')
  @RequirePermission('candidate:read')
  funnel(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FiltersQuery & { drillStage?: string },
  ) {
    return this.reports.funnel(actor, this.filters(query), query.drillStage);
  }

  @Get('channels')
  @RequirePermission('candidate:read')
  channels(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FiltersQuery & { drillChannel?: string },
  ) {
    return this.reports.channels(actor, this.filters(query), query.drillChannel);
  }

  @Get('reasons')
  @RequirePermission('candidate:read')
  reasons(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FiltersQuery & { type?: string; drillKey?: string },
  ) {
    const type = (query.type ?? 'ARCHIVE') as ReasonReportType;
    return this.reports.reasons(actor, type, this.filters(query), query.drillKey);
  }

  @Get('probation')
  @RequirePermission('candidate:read')
  probation(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FiltersQuery & { drillGroup?: string },
  ) {
    return this.reports.probation(actor, this.filters(query), query.drillGroup);
  }

  @Get('cycles')
  @RequirePermission('candidate:read')
  cycles(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FiltersQuery & { dimensions?: string; drillGroup?: string },
  ) {
    const requested = (query.dimensions ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is CycleDimension => (CYCLE_DIMENSIONS as readonly string[]).includes(item));
    return this.reports.cycles(actor, this.filters(query), requested, query.drillGroup);
  }

  private filters(query: FiltersQuery): ReportFilters {
    return {
      from: query.from,
      to: query.to,
      departmentId: query.departmentId,
      recruiterId: query.recruiterId,
      requisitionType: query.requisitionType,
    };
  }
}
