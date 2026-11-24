import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { AuditAction, RequirePermission } from '../auth/auth.decorators.js';
import { AuditService } from './audit.service.js';

@Controller('api/v1/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** 审计检索：支持按操作人、时间段、对象与动作（或动作前缀）查询，返回内容已脱敏。 */
  @Get()
  @RequirePermission('audit:read')
  @AuditAction('audit.read', 'AuditLog')
  async list(
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('action') action?: string,
    @Query('actionPrefix') actionPrefix?: string,
  ) {
    return this.audit.list({
      actorId,
      from: this.parseDate(from, 'from'),
      to: this.parseDate(to, 'to'),
      limit: this.parseLimit(limit, 1000),
      ...this.filters({ resourceType, resourceId, action, actionPrefix }),
    });
  }

  @Get('export.csv')
  @RequirePermission('audit:export')
  @AuditAction('audit.export', 'AuditLog')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
  async export(
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('action') action?: string,
    @Query('actionPrefix') actionPrefix?: string,
  ): Promise<string> {
    const items = await this.audit.list({
      actorId,
      from: this.parseDate(from, 'from'),
      to: this.parseDate(to, 'to'),
      limit: this.parseLimit(limit, 10000),
      ...this.filters({ resourceType, resourceId, action, actionPrefix }),
    });
    const columns = [
      'id',
      'actorId',
      'actorName',
      'action',
      'resourceType',
      'resourceId',
      'requestId',
      'beforeSummary',
      'afterSummary',
      'ip',
      'userAgent',
      'outcome',
      'createdAt',
    ] as const;
    const rows = items.map((item) =>
      columns.map((column) => this.csvCell(item[column])).join(','),
    );
    return `\uFEFF${columns.join(',')}\r\n${rows.join('\r\n')}`;
  }

  private filters(input: {
    resourceType?: string;
    resourceId?: string;
    action?: string;
    actionPrefix?: string;
  }) {
    for (const [name, value] of Object.entries(input)) {
      if (value !== undefined && !/^[\w.:\-]{1,191}$/.test(value)) {
        throw new BadRequestException(`${name} 筛选值无效`);
      }
    }
    return { ...input, action: input.action || undefined, actionPrefix: input.actionPrefix || undefined };
  }

  private parseDate(value: string | undefined, name: string): Date | undefined {
    if (value === undefined) return undefined;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${name} 日期格式无效`);
    return date;
  }

  private parseLimit(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > fallback) {
      throw new BadRequestException(`limit 必须为 1 至 ${fallback} 的整数`);
    }
    return parsed;
  }

  private csvCell(value: unknown): string {
    const text =
      value instanceof Date
        ? value.toISOString()
        : value === null || value === undefined
          ? ''
          : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
    const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  }
}
