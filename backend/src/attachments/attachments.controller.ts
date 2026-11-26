import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, PublicRoute, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { AttachmentsService } from './attachments.service.js';

@Controller('api/v1/attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
  ) {}

  /** 签发短期私有读链接；访问权限与敏感材料授权在签发时校验并留痕。 */
  @Get(':id/read-url')
  @RequirePermission('intake:read')
  readUrl(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attachments.issueReadUrl(id, actor, {
      requestId: this.audit.requestId(request),
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /** 本地开发驱动：校验签名与有效期后回源输出文件，不接受目录直读。 */
  @Get('content')
  @PublicRoute()
  async content(
    @Query('key') key: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('actor') actor: string | undefined,
    @Query('signature') signature: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { file, buffer } = await this.attachments.openSignedContent(
      { key, expires, actor, signature },
      {
        requestId: this.audit.requestId(request),
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(buffer.length));
    response.setHeader('Content-Disposition', contentDisposition(file.fileName));
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(buffer);
  }
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
