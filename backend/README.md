# Backend

仓库级 Windows 本地开发、数据库初始化和前端接入说明见[ATS 本地开发运行手册](../docs/ats-本地开发运行手册.md)。本文补充后端环境、安全和 API 细节。

## 技术栈

- NestJS + TypeScript
- Prisma + MySQL 8
- BullMQ + Redis 7
- Vitest / Supertest

## 本地运行

在仓库根目录安装前后端依赖，并复制无真实密钥的环境模板：

```powershell
npm ci
npm ci --prefix backend
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

编辑 `backend/.env`，填入本机 MySQL 密码、至少 32 字节的随机 `JWT_ACCESS_SECRET`、`REFRESH_TOKEN_PEPPER` 和 `INITIAL_ADMIN_SECRET`。首次启动先创建空库 `talentflow` 并启动 MySQL、Redis，然后初始化：

```powershell
npm run db:setup
```

`db:setup` 会应用迁移并写入默认权限、`ADMIN`、`RECRUITER`、`HIRING_MANAGER` 和 `INTERVIEWER` 角色，不创建任何用户。使用配置的 `INITIAL_ADMIN_SECRET` 调用 `POST /api/v1/auth/bootstrap` 一次性创建管理员，提交成功后从运行环境移除该初始化密钥。此接口由数据库唯一标记保护，重复或并发初始化会被拒绝。示例请求体：

```json
{
  "setupToken": "${INITIAL_ADMIN_SECRET}",
  "displayName": "系统管理员",
  "identityProvider": "DINGTALK",
  "identitySubject": "已核验的钉钉用户 ID"
}
```

ATS-004 提供钉钉身份映射，不含钉钉 OAuth 授权码交换流程；正式登录接入在 ATS-017。开发时如需本地登录，显式设置 `APP_ENV=local`、`LOCAL_AUTH_ENABLED=true` 和 `LOCAL_AUTH_SECRET`。生产环境不能启用本地身份适配。默认角色不会获得候选人联系方式授权；管理员通过 `/api/v1/authz/field-grants` 按用户或用户组授予独立的读取/写入权限及有效期。

受保护 API 使用 `Authorization: Bearer <accessToken>`。访问令牌默认 15 分钟；刷新令牌通过 HttpOnly Cookie 轮换，数据库只保存其 HMAC 哈希。管理员可通过 `/api/v1/authz` 管理用户、角色、部门、用户组和字段授权，通过 `/api/v1/audit-logs` 查询或导出审计记录。

Web、API、解析 Worker 分别运行在三个终端：

```powershell
npm run dev:web
npm run dev:api
npm run dev:worker
```

API 和 Worker 使用独立进程；API 不消费解析队列。生产启动命令分别为 `npm --prefix backend run start:prod` 和 `npm --prefix backend run start:worker`。

## 数据库迁移

迁移历史保存在 `prisma/migrations`。修改 Schema 后使用 `npm run db:migrate` 创建并应用新迁移；已提交迁移不可覆盖或编辑。CI 和部署使用 `npm run db:migrate:deploy`，空数据库可用 `npm run db:setup` 重复初始化。

此前通过 `prisma db push` 建立、但没有迁移历史的数据库需要先备份并比较实际结构。只有数据库结构与 `20261113000000_initial` 完全一致时，才可登记迁移基线：

```powershell
Set-Location backend
npx prisma migrate resolve --applied 20261113000000_initial --schema prisma/schema.prisma
Set-Location ..
```

未核对的已有数据库不要直接运行 `db:setup` 或 `db:migrate:deploy`，因为首个迁移会创建全部表。

## 职位与招聘需求 API

职位与 HC 分离：职位编号由服务端按 `MJ%06d` 生成，虚拟职位默认不进入普通职位列表；HC 满员只返回提示，不自动关闭。招聘需求由 OA 审批通过后生成，周期为需求级指标。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/jobs` | `job:read` | 职位列表与筛选（编号/部门/渠道/负责人/简历更新时间/状态） |
| GET | `/jobs/virtual` | `job:read` | 虚拟职位（校招容器）列表 |
| POST | `/jobs` | `job:create` | 新建职位，编号自动生成 |
| PATCH | `/jobs/:id` | `job:update` | 编辑职位；招聘要求仅该职位招聘负责人或管理员可改 |
| POST | `/jobs/:id/close` | `job:close` | 关闭职位，仅停止新简历进入，不改动流程中候选人 |
| GET | `/requisitions` | `requisition:read` | 需求列表、周期区间筛选与排序 |
| GET | `/requisitions/in-progress` | `requisition:read` | 在招时长列表（`sort=days_asc\|days_desc`） |
| GET | `/requisitions/stats/cycle` | `requisition:read` | 周期汇总（排除未关闭与不补录的存量需求） |
| POST | `/requisitions/oa-sync` | `requisition:sync` | OA 审批通过回调（本期 Mock 契约，按 `oaApprovalId` 幂等） |
| POST | `/requisitions/sync-from-oa` | `requisition:sync` | 回调失败后的人工同步，同一幂等规则 |
| PATCH | `/requisitions/:id` | `requisition:manage` | 人事优化内容，与同步信息同一条记录，留痕前后值 |
| PATCH | `/requisitions/:id/start-date` | `requisition:manage` | 仅招聘中可改，重算在招天数 |
| POST | `/requisitions/:id/close` | `requisition:manage` | 写入关闭时间并计算周期 |
| POST | `/requisitions/:id/revert` | `requisition:manage` | 回退为招聘中，清空当前周期并保留时间线历史 |

周期规则：`cycleDays = max(1, 关闭日期 - 开始招聘日期)`，同日计 1 天、多日按自然日差不累加首尾日；开始招聘时间必填且不可事后补录，已关闭需求需先回退才能修改；未关闭需求显示「进行中 · 已 N 天」且不计入周期汇总；本期不补录的已关闭存量需求 `cycleEligible=false`，不纳入统计。需求提报时间只读、不参与计算。

## 附件存储与生命周期 API

附件只通过私有存储与短期签名链接读取，不提供静态目录或公开 URL。上传统一校验扩展名、声明 MIME 与文件头，并按 `RESUME_MAX_MB` 限制大小；被拒绝的文件写入 `resume_intakes` 并带 `errorCode`（`UNSUPPORTED_FORMAT` / `MIME_MISMATCH` / `CONTENT_MISMATCH` / `FILE_TOO_LARGE` / `EMPTY_FILE`）。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/attachments/:id/read-url` | `intake:read` | 校验数据范围与敏感材料独立授权后签发签名链接（`SIGNED_URL_TTL_SECONDS`，默认 300 秒） |
| GET | `/attachments/content` | 签名 | 本地驱动回源下载；签名绑定 key、有效期与访问人，过期或篡改返回 403 |
| GET | `/retention/policy` | `retention:manage` | 当前保留期限配置，用于上线前与业务确认 |
| POST | `/retention/purge` | `retention:manage` | 到期清理；请求体 `{"dryRun": true}` 时只统计不删除 |

- 驱动：`STORAGE_DRIVER=local` 写入 `LOCAL_STORAGE_DIR`（非 Git 目录）；`oss` 使用阿里云 OSS SDK，Bucket 私有，读操作只返回签名 URL。
- 对象 key 为 `resumes/<sha256><ext>`，同一文件按内容去重，不重复占用存储。
- 签发与下载分别写入审计 `attachment.read_url_issued`、`attachment.downloaded`；背调、流水等敏感材料需先授予 `BACKGROUND_MATERIALS` / `BANK_STATEMENTS` 的独立读授权。
- 清理同时删除对象文件与 `resume_files` 记录，解绑 `resume_intakes.resumeFileId`，并写入 `timeline_events`、`audit_logs` 与 `retention_runs`；对象删除失败时保留结构化记录等待下次重试。
- 定期执行：构建后 `npm --prefix backend run retention:purge`，开发环境 `npm --prefix backend run retention:purge:dev`，`RETENTION_DRY_RUN=true` 只统计。保留天数默认简历 365 天、敏感材料 180 天，具体数值上线前与业务确认。

## 质量门禁

```powershell
npm run typecheck --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run test:e2e --prefix backend
npm run build:api
```

GitHub Actions 使用临时 MySQL 8 和 Redis 7 执行 Schema 校验、迁移、类型检查、Lint、单元/API 测试、前后端构建及 Gitleaks 密钥扫描。当前仓库尚未包含浏览器扩展工程。
