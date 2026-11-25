import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AllowSystemToken,
  AuditAction,
  CurrentUser,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { resumeMaxBytes } from '../storage/upload-validation.js';
import { BrowserImportService } from './browser-import.service.js';
import type { BrowserImportBody } from './browser-import.service.js';
import type { UploadedResumeFile } from './intake.service.js';

/** 浏览器导入附件传输层上限；业务侧由统一上传校验再校验一次 */
const MAX_RESUME_BYTES = resumeMaxBytes();

/**
 * 通用浏览器导入 API（ATS-010 / FR-EXT-6、7、9，PRD §5.12）。
 *
 * 认证模型：登录会话 Bearer 令牌，或扩展端专用的短期系统令牌
 * （X-System-Token 头，由 AccessControlGuard 统一解析）。
 * 两种方式都落到同一个操作者上下文，任务按操作者归属、只对所有者可见。
 */
@Controller('api/v1/browser-import')
export class BrowserImportController {
  constructor(private readonly imports: BrowserImportService) {}

  /** 签发短期系统令牌：仅登录会话可调用，明文只返回一次 */
  @Post('token')
  @RequirePermission('intake:manage')
  @AuditAction('import.token_issue', 'SystemToken')
  async issueToken(@CurrentUser() actor: AuthenticatedUser) {
    return this.imports.issueToken(actor);
  }

  /**
   * 吊销系统令牌（ATS-024 / FR-ADM-6）：操作者可吊销本人名下的全部有效令牌；
   * 吊销他人令牌须同时具备授权管理权限。令牌只存哈希，吊销后立即失效。
   */
  @Post('token/revoke/:operatorId')
  @HttpCode(200)
  @RequirePermission('intake:manage')
  @AuditAction('import.token_revoke', 'SystemToken')
  async revokeTokens(@Param('operatorId') operatorId: string, @CurrentUser() actor: AuthenticatedUser) {
    const canManageOthers = actor.roles.some((role) => role.permissions.includes('authz:admin'));
    if (operatorId !== actor.id && !canManageOthers) {
      throw new ForbiddenException('只能撤销本人签发的系统令牌');
    }
    return { operatorId, revoked: await this.imports.revokeTokens(operatorId) };
  }

  /** 创建导入任务：返回任务资源（同步完成落库与投递解析），同 requestId 幂等 */
  @Post('tasks')
  @AllowSystemToken('BROWSER_IMPORT')
  @RequirePermission('intake:manage')
  @AuditAction('import.task_create', 'BrowserImportTask')
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: MAX_RESUME_BYTES } }))
  async createTask(
    @Body() body: BrowserImportBody = {},
    @UploadedFile() file: UploadedResumeFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const result = await this.imports.createImportTask(body, file, actor);
    return result.task;
  }

  /** 任务查询：只允许任务所有者读取 */
  @Get('tasks/:taskId')
  @AllowSystemToken('BROWSER_IMPORT')
  @RequirePermission('intake:manage')
  @AuditAction('import.task_read', 'BrowserImportTask')
  async getTask(@Param('taskId') taskId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.imports.getTask(taskId, actor);
  }

  /** 操作者任务列表（审计视图） */
  @Get('tasks')
  @AllowSystemToken('BROWSER_IMPORT')
  @RequirePermission('intake:manage')
  @AuditAction('import.task_list', 'BrowserImportTask')
  async listTasks(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.imports.listTasks(actor, {
      status,
      page: Number(page ?? 1),
      pageSize: Number(pageSize ?? 20),
    });
  }
}
