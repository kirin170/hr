# TalentFlow ATS API 契约与错误码参考 v1.0

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 核对日期 | 2026-11-21 |
| 依据代码 | `backend/src/**`、`backend/prisma/seed.mjs`、`vite.config.ts` |
| 覆盖范围 | 截至 `ATS-010` / `ATS-012` / `ATS-017` / `ATS-022` 已实现的全部 HTTP 接口、权限点与错误码 |

> 本文档为**已实现 API 的权威速查参考**。后续任务（`ATS-013`～`024`）新增接口或错误码时必须同步更新本文档。

---

## 1. 协议与路由约定

### 1.1 路由前缀现状与代理规则

当前后端接口存在两类前缀（因早期骨架与后续规范演进所致），前端开发和接口联调时需注意区分：

| 模块 | 后端实际路径前缀 | 前端调用路径（经 Vite 代理） | 代理规则（[vite.config.ts](../vite.config.ts)） |
|---|---|---|---|
| `auth`、`authz`、`intake`、`campus`、`browser-import`、`mail`、`attachments`、`retention`、`ai-runs`、`audit-logs`、`dingtalk` | `/api/v1/...` | `/api/v1/...` | `/api/v1` 直接转发到 `http://localhost:3000/api/v1`（不改写） |
| `candidates`、`jobs`、`requisitions`（早期模块） | `/candidates`、`/jobs`、`/requisitions` | `/api/candidates`、`/api/jobs`、`/api/requisitions` | `/api` 转发前剥离 `/api` 前缀 |
| 健康检查 | `/` | — | 直接访问 `http://127.0.0.1:3000/` 返回 `Hello World!` |

> **新增模块规范**：所有新开发模块（`ATS-013` 及以后）统一使用 `@Controller('api/v1/<resource>')`，不再新增无前缀根路由。

### 1.2 认证、请求头与审计

| 机制 | 约定 |
|---|---|
| 标准会话鉴权 | `Authorization: Bearer <accessToken>`；访问令牌为 JWT（默认 TTL 15 分钟 / `TOKEN_TTL=900`），仅存前端内存 |
| 刷新令牌 | HttpOnly Cookie `talentflow_refresh`（`Path=/api/v1/auth`，`SameSite=Lax`，非 `local` 环境 `Secure`），支持轮换，库中仅存 HMAC 哈希 |
| 扩展短期系统令牌 | `X-System-Token: <token>`（`ATS-010`）；由 `POST /api/v1/browser-import/token` 签发，仅存加盐 SHA-256，代表签发操作者，不额外提权 |
| 公开路由 | 标注 `@PublicRoute()` 的路由跳过全局 `AccessControlGuard` |
| 请求关联 ID | 可传入 `X-Request-Id`（允许 `[A-Za-z0-9._:-]{1,128}`）；未传时服务端生成 UUID，写入 `audit_logs.requestId` |
| 越权审计 | 401/403 拒绝事件由 `AccessControlGuard` 自动写入 `audit_logs`（`outcome=DENIED`）；资源越权在敏感模块（如附件/浏览器导入任务）按 404 处理以防探测 |

---

## 2. 权限点、默认角色与字段授权

### 2.1 默认角色与数据范围（`backend/prisma/seed.mjs`）

| 角色编码 | 中文名 | 默认数据范围 | 默认权限集 |
|---|---|---|---|
| `ADMIN` | 系统管理员 | `ALL` | 全部 21 个应用权限（**不含**默认敏感字段读/写授权，需单独授字段权限） |
| `RECRUITER` | 招聘 HR | `OWN_JOBS` | `candidate:*`、`job:*`、`requisition:*`、`intake:*`、`ai:*`（14 项） |
| `HIRING_MANAGER` | 用人经理 | `DEPARTMENT` | `candidate:read`、`candidate:stage:update`、`job:read`、`requisition:read`、`intake:read`、`ai:read`（6 项） |
| `INTERVIEWER` | 面试官 | `PARTICIPATING` | `candidate:read`、`job:read`、`ai:read`（3 项） |
| `SYSTEM_INTEGRATION` | 邮箱抓取机器人（按需自动创建） | — | `intake:read`、`intake:manage`、`candidate:read`、`candidate:create`、`ai:read`（不可登录） |

> 数据范围枚举（`DataScope`）：`ALL`（全局）、`DEPARTMENT`（本部门及子部门，兼容钉钉多部门 `user_departments`）、`OWN_JOBS`（本人负责职位）、`PARTICIPATING`（本人参与流程）。

### 2.2 全量权限点字典（21 项）

| 分类 | 权限点 | 说明 |
|---|---|---|
| 身份与授权 | `authz:read` | 查看角色、用户组、部门和用户 |
| | `authz:admin` | 管理用户、角色、部门与用户组 |
| | `authz:field-grant:manage` | 管理敏感字段授权 |
| 组织同步 | `organization:sync` | 触发钉钉组织同步、查看同步事件与重试 |
| 审计 | `audit:read` | 查询审计日志 |
| | `audit:export` | 导出审计日志 CSV |
| 候选人 | `candidate:read` | 查看权限范围内候选人、详情、时间线与保存筛选 |
| | `candidate:create` | 创建候选人 |
| | `candidate:stage:update` | 推进/撤销阶段、分配职位、记录部门筛选、锁定与批量操作 |
| 职位 | `job:read` | 查看职位与虚拟职位列表/详情/时间线 |
| | `job:create` | 创建职位 |
| | `job:update` | 编辑职位（招聘要求仅该职位负责人或管理员可改） |
| | `job:close` | 关闭职位 |
| 招聘需求 | `requisition:read` | 查看需求列表、在招时长、周期汇总与时间线 |
| | `requisition:manage` | 编辑需求、修改开始招聘时间、关闭与回退 |
| | `requisition:sync` | 触发 OA 需求同步（Mock 回调 / 人工同步） |
| 简历入场 | `intake:read` | 查看入场记录、待分配池、查重、监控、来源、校招投递、邮箱配置与签发附件读链接 |
| | `intake:manage` | 上传/手工/Excel/邮箱/浏览器导入、分配职位、查重合并、维护来源、管理邮箱与轮询 |
| 生命周期 | `retention:manage` | 查看保留策略并触发到期清理 |
| AI | `ai:read` | 查看权限范围内 AI 解析草稿 |
| | `ai:confirm` | 确认 AI 解析草稿转正式档案 |

### 2.3 敏感字段独立授权枚举（`SensitiveField`）

通过 `/api/v1/authz/field-grants` 按用户或用户组授予，支持 `canRead`、`canWrite` 与有效期 `expiresAt`：

- `CANDIDATE_CONTACT`：候选人联系方式（手机号、邮箱等，响应序列化层按授权脱敏）
- `BACKGROUND_MATERIALS`：背调材料附件独立访问权
- `BANK_STATEMENTS`：银行流水附件独立访问权

---

## 3. 已实现接口总表

### 3.1 基础与认证（`AuthController`、`DingTalkAuthController`、`AppController`）

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/` | 公开 | — | 服务存活检查，返回 `Hello World!` |
| `POST` | `/api/v1/auth/bootstrap` | 公开（一次性 `setupToken`） | `auth.initial_admin.bootstrap` | 一次性初始化首位管理员，要求 `INITIAL_ADMIN_SECRET` ≥ 32 字节 |
| `POST` | `/api/v1/auth/local` | 公开（仅 `local` + 开关开启） | `auth.local_login` | 本地账号密码登录，返回访问 JWT 并写刷新 Cookie |
| `POST` | `/api/v1/auth/refresh` | 公开（刷新 Cookie） | `auth.refresh` | 轮换刷新令牌并签发新访问 JWT |
| `POST` | `/api/v1/auth/logout` | 公开（刷新 Cookie） | `auth.logout` | 吊销当前刷新会话并清理 Cookie |
| `GET` | `/api/v1/auth/dingtalk/login` | 公开 | — | 生成随机 `state` Cookie 并 302 跳转钉钉 OAuth 授权页 |
| `GET` | `/api/v1/auth/dingtalk/callback` | 公开 | `auth.dingtalk.login` | 校验 `state` 与 `corpId`，`unionId → userId` 映射登录，写刷新 Cookie 后 303 跳转前端 |

### 3.2 授权管理（`AuthorizationController`）

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/api/v1/authz/me` | 已登录 | `authz.me` | 当前登录用户上下文、角色、权限与数据范围 |
| `GET` | `/api/v1/authz/roles` | `authz:read` | `authz.roles.read` | 角色列表 |
| `GET` | `/api/v1/authz/groups` | `authz:read` | `authz.groups.read` | 用户组列表 |
| `POST` | `/api/v1/authz/groups` | `authz:admin` | `authz.group.create` | 新建用户组 |
| `POST` | `/api/v1/authz/groups/:groupId/members/:userId` | `authz:admin` | `authz.group.member.add` | 向用户组添加成员 |
| `GET` | `/api/v1/authz/departments` | `authz:read` | `authz.departments.read` | 部门列表 |
| `POST` | `/api/v1/authz/departments` | `authz:admin` | `authz.department.create` | 新建部门 |
| `GET` | `/api/v1/authz/users` | `authz:read` | `authz.users.read` | 用户列表（`limit` 1～500） |
| `POST` | `/api/v1/authz/users` | `authz:admin` | `authz.user.create` | 创建用户并绑定 `LOCAL` 或 `DINGTALK` 身份 |
| `PUT` | `/api/v1/authz/users/:userId/roles` | `authz:admin` | `authz.user.roles.update` | 分配角色及可选 `scopeOverride` |
| `GET` | `/api/v1/authz/field-grants` | `authz:field-grant:manage` | `authz.field-grants.read` | 查询敏感字段授权列表 |
| `POST` | `/api/v1/authz/field-grants` | `authz:field-grant:manage` | `authz.field-grant.create` | 授予用户/用户组敏感字段读写权限 |
| `DELETE` | `/api/v1/authz/field-grants/:id` | `authz:field-grant:manage` | `authz.field-grant.revoke` | 撤销敏感字段授权 |

### 3.3 钉钉组织同步与回调（`DingTalkCallbackController`、`DingTalkSyncController`）

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/api/v1/dingtalk/events` | 公开（签名 + AES 验签） | — | 钉钉事件订阅 URL 校验（返回加密 challenge） |
| `POST` | `/api/v1/dingtalk/events` | 公开（签名 + AES 验签） | — | 接收钉钉通讯录变更回调，校验后幂等入队 |
| `POST` | `/api/v1/admin/organization/dingtalk/sync` | `organization:sync` | `dingtalk.organization.sync.queued` | 202 入队触发全量或指定 `departmentId` 子树同步 |
| `GET` | `/api/v1/admin/organization/dingtalk/events` | `organization:sync` | `dingtalk.sync_events.read` | 查看钉钉同步事件列表（`limit` 默认 50） |
| `POST` | `/api/v1/admin/organization/dingtalk/events/:id/retry` | `organization:sync` | `dingtalk.sync_event.retry` | 202 重试失败的同步事件 |

### 3.4 职位与招聘需求（`JobsController`、`RequisitionsController`）

> 以下路由后端无 `/api/v1` 前缀；前端经 Vite 调用时路径加 `/api` 前缀。

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/jobs` | `job:read` | `job.list` | 职位列表与筛选（默认排除虚拟职位） |
| `GET` | `/jobs/virtual` | `job:read` | `job.virtual.list` | 虚拟职位（校招容器）列表 |
| `GET` | `/jobs/:id` | `job:read` | `job.read` | 职位详情 |
| `GET` | `/jobs/:id/timeline` | `job:read` | `job.timeline.read` | 职位操作时间线 |
| `POST` | `/jobs` | `job:create` | `job.create` | 新建职位，自动生成 `MJ%06d` 编号 |
| `PATCH` | `/jobs/:id` | `job:update` | `job.update` | 编辑职位（`requirements` 限负责人/管理员） |
| `POST` | `/jobs/:id/close` | `job:close` | `job.close` | 关闭职位，不改动在流程候选人 |
| `GET` | `/requisitions` | `requisition:read` | `requisition.list` | 需求列表、周期区间筛选与排序 |
| `GET` | `/requisitions/in-progress` | `requisition:read` | `requisition.in_progress` | 在招时长列表（`sort=days_asc\|days_desc`） |
| `GET` | `/requisitions/stats/cycle` | `requisition:read` | `requisition.cycle_stats` | 需求级招聘周期汇总（排除未关闭与存量不补录） |
| `GET` | `/requisitions/:id` | `requisition:read` | `requisition.read` | 需求详情 |
| `GET` | `/requisitions/:id/timeline` | `requisition:read` | `requisition.timeline.read` | 需求变更时间线 |
| `POST` | `/requisitions/oa-sync` | `requisition:sync` | `requisition.oa_sync` | OA 需求审批通过回调（Mock 契约，按 `oaApprovalId` 幂等） |
| `POST` | `/requisitions/sync-from-oa` | `requisition:sync` | `requisition.manual_sync` | 人工补同步 OA 需求，同一幂等规则 |
| `PATCH` | `/requisitions/:id` | `requisition:manage` | `requisition.update` | 人事优化需求内容，同一记录留痕前后值 |
| `PATCH` | `/requisitions/:id/start-date` | `requisition:manage` | `requisition.start_date.update` | 修改开始招聘时间（仅 `ACTIVE` 可改） |
| `POST` | `/requisitions/:id/close` | `requisition:manage` | `requisition.close` | 手动关闭需求并计算 `cycleDays` |
| `POST` | `/requisitions/:id/revert` | `requisition:manage` | `requisition.revert` | 回退为招聘中，清空当前周期并保留时间线历史 |

### 3.5 候选人九阶段主链（`CandidatesController`）

> 以下路由后端无 `/api/v1` 前缀；前端经 Vite 调用时路径加 `/api` 前缀。状态转换规则见 [ats012-candidate-stage-migration.md](ats012-candidate-stage-migration.md)。

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/candidates` | `candidate:read` | `candidate.list` | 列表、权限内各阶段实时计数与多条件筛选分页 |
| `GET` | `/candidates/:id` | `candidate:read` | `candidate.read` | 候选人详情（联系方式按字段授权脱敏） |
| `GET` | `/candidates/:id/timeline` | `candidate:read` | `candidate.timeline.read` | 候选人操作时间线 |
| `POST` | `/candidates` | `candidate:create` | `candidate.create` | 创建候选人 |
| `PATCH` | `/candidates/:id/stage` | `candidate:stage:update` | `candidate.stage.update` | 显式阶段流转（带状态机与并发校验） |
| `POST` | `/candidates/:id/stage/undo` | `candidate:stage:update` | `candidate.stage.undo` | 撤销最近一次有效阶段动作（写补偿时间线） |
| `POST` | `/candidates/:id/assign-job` | `candidate:stage:update` | `candidate.job.assign` | 待分配/虚拟池分配正式职位，进入 `RECOMMENDED` |
| `POST` | `/candidates/:id/department-screening` | `candidate:stage:update` | `candidate.department-screening.record` | 记录部门筛选 `PASS`/`HOLD`/`REJECT`；任一 `PASS` 附原因与可约时段推进至面试 |
| `PATCH` | `/candidates/:id/lock` | `candidate:stage:update` | `candidate.lock.update` | 设置锁定态（`NONE` / `OPERABLE` / `INOPERABLE`） |
| `POST` | `/candidates/batch/stage` | `candidate:stage:update` | `candidate.stage.batch` | 批量显式转阶段，返回逐项成功/失败明细 |
| `POST` | `/candidates/batch/department-screening` | `candidate:stage:update` | `candidate.department-screening.batch` | 批量记录部门筛选结论 |
| `POST` | `/candidates/batch/tags` | `candidate:stage:update` | `candidate.tags.batch` | 批量更新标签 |
| `GET` | `/candidates/filters` | `candidate:read` | `candidate.filters.read` | 获取当前用户已保存筛选条件 |
| `POST` | `/candidates/filters` | `candidate:read` | `candidate.filters.save` | 保存筛选条件 |
| `DELETE` | `/candidates/filters/:id` | `candidate:read` | `candidate.filters.delete` | 删除已保存筛选条件 |

### 3.6 简历入场、待分配池、Excel 与来源台账（`IntakeController`）

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `POST` | `/api/v1/intake/upload` | `intake:manage` | `intake.upload` | 单/批量文件上传（multipart `files`，最多 20 份） |
| `POST` | `/api/v1/intake/manual` | `intake:manage` | `intake.manual` | 手工录入候选人 |
| `POST` | `/api/v1/intake/email/mock` | `intake:manage` | `intake.email_mock` | 模拟邮件入场（开发/演示） |
| `GET` | `/api/v1/intake/excel/template` | `intake:read` | `intake.excel_template` | 下载 Excel 批量导入模板（`.xlsx`） |
| `POST` | `/api/v1/intake/excel/import` | `intake:manage` | `intake.excel_import` | Excel 表格导入（独立链路，不进入 AI 解析） |
| `GET` | `/api/v1/intake/excel/batches/:batchId` | `intake:read` | `intake.excel_batch` | 查询 Excel 导入批次结果与校验报告 |
| `GET` | `/api/v1/intake/excel/batches/:batchId/failed-rows` | `intake:read` | `intake.excel_failed_export` | 导出失败行 `.xlsx` |
| `GET` | `/api/v1/intake/monitor` | `intake:read` | `intake.monitor` | 入场监控聚合（进入/未进入、渠道/邮箱、时延、失败归因） |
| `GET` | `/api/v1/intake/pool` | `intake:read` | `intake.pool` | 待分配池列表 |
| `GET` | `/api/v1/intake/duplicates` | `intake:read` | `intake.duplicates` | 待处理查重列表 |
| `GET` | `/api/v1/intake/mailboxes` | `intake:read` | `intake.mailboxes` | 已配置接收邮箱摘要列表 |
| `GET` | `/api/v1/intake/sources` | `intake:read` | `intake.sources` | 简历来源/推荐人台账查询筛选 |
| `PATCH` | `/api/v1/intake/sources/:id` | `intake:manage` | `intake.source_update` | HR 维护来源与推荐人信息 |
| `POST` | `/api/v1/intake/batch-assign-job` | `intake:manage` | `intake.batch_assign_job` | 待分配池批量分配职位 |
| `POST` | `/api/v1/intake/:id/assign-job` | `intake:manage` | `intake.assign_job` | 单条入场记录分配职位 |
| `POST` | `/api/v1/intake/:id/merge` | `intake:manage` | `intake.merge_duplicate` | 查重合并至原候选人，保留全部来源与附件 |
| `POST` | `/api/v1/intake/:id/retry` | `intake:manage` | `intake.retry` | 失败记录重试解析 |
| `GET` | `/api/v1/intake` | `intake:read` | `intake.list` | 入场记录分页与多维筛选 |
| `GET` | `/api/v1/intake/:id` | `intake:read` | `intake.read` | 单条入场记录详情 |

### 3.7 校园招聘投递门户（`CampusController`）

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/api/v1/campus/jobs` | 公开 | `campus.jobs` | 公开获取可投递的校招职位（含虚拟职位） |
| `POST` | `/api/v1/campus/applications` | 公开 | `campus.apply` | 公开校招投递（multipart `resume` 可选 + 个人意愿表） |
| `GET` | `/api/v1/campus/applications` | `intake:read` | `campus.applications` | HR 查看校招投递列表与个人意愿 |
| `POST` | `/api/v1/campus/applications/batch-assign` | `intake:manage` | `campus.batch_assign` | 批量人工分配正式职位，保留原始个人意愿不覆盖 |

### 3.8 通用浏览器导入 API（`BrowserImportController`）

> 支持 `Authorization: Bearer` 或 `X-System-Token` 认证（签发令牌端点除外）。

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `POST` | `/api/v1/browser-import/token` | `intake:manage`（仅登录会话） | `import.token_issue` | 签发短期系统令牌，明文仅返回一次 |
| `POST` | `/api/v1/browser-import/tasks` | `intake:manage` | `import.task_create` | 提交当前简历与附件字节（multipart `resume`），同操作者同 `requestId` 幂等，命中查重落 `DUPLICATE` |
| `GET` | `/api/v1/browser-import/tasks/:taskId` | `intake:manage`（仅所有者） | `import.task_read` | 查询导入任务状态与结果，非所有者返回 `TASK_NOT_FOUND` |
| `GET` | `/api/v1/browser-import/tasks` | `intake:manage`（仅本人） | `import.task_list` | 当前操作者的导入任务审计列表 |

### 3.9 真实邮箱 IMAP 配置与轮询（`MailController`）

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/api/v1/mail/mailboxes` | `intake:read` | — | 已关联招聘邮箱列表（只返回 `hasCredential`，不返回明文密码） |
| `GET` | `/api/v1/mail/mailboxes/:id` | `intake:read` | — | 单个邮箱配置与抓取游标详情 |
| `POST` | `/api/v1/mail/mailboxes` | `intake:manage` | `mail.mailbox_create` | 新增关联招聘邮箱（授权码 AES-256-GCM 密文落库） |
| `PATCH` | `/api/v1/mail/mailboxes/:id` | `intake:manage` | `mail.mailbox_update` | 更新邮箱配置或启停 |
| `DELETE` | `/api/v1/mail/mailboxes/:id` | `intake:manage` | `mail.mailbox_delete` | 删除邮箱配置 |
| `POST` | `/api/v1/mail/mailboxes/:id/test-connection` | `intake:manage` | `mail.mailbox_test` | 只读 IMAP 连通性测试，不拉取邮件、不推进游标 |
| `POST` | `/api/v1/mail/mailboxes/:id/poll` | `intake:manage` | `mail.mailbox_poll` | 手动触发一次抓取（与 Worker 定时轮询共用幂等链路） |
| `GET` | `/api/v1/mail/mailboxes/:id/messages` | `intake:read` | — | 该邮箱最近处理台账与失败归因（`limit` 默认 20） |

### 3.10 附件私有读、数据保留、AI 草稿与审计日志

| 方法 | 实际路径 | 权限 | 审计动作 | 说明 |
|---|---|---|---|---|
| `GET` | `/api/v1/attachments/:id/read-url` | `intake:read` + 数据范围 + 敏感授权 | `attachment.read_url_issued` | 签发短期私有签名读链接（默认 300s，区间 30～3600s） |
| `GET` | `/api/v1/attachments/content` | 公开（URL 签名校验） | `attachment.downloaded` | 本地存储驱动回源下载，校验签名/有效期/访问人 |
| `GET` | `/api/v1/retention/policy` | `retention:manage` | — | 查询当前简历与敏感材料保留天数配置 |
| `POST` | `/api/v1/retention/purge` | `retention:manage` | `retention.purge` | 执行到期清理（`{"dryRun": true}` 只统计不删除） |
| `GET` | `/api/v1/ai-runs/:id` | `ai:read` | `ai_run.read` | 查看 AI 解析任务与结构化草稿 |
| `POST` | `/api/v1/ai-runs/:id/confirm` | `ai:confirm` | `ai_run.confirm` | HR 显式确认解析草稿并转正式档案 |
| `GET` | `/api/v1/audit-logs` | `audit:read` | `audit.read` | 查询审计日志（支持 `actorId`、`from`、`to`、`limit`≤1000） |
| `GET` | `/api/v1/audit-logs/export.csv` | `audit:export` | `audit.export` | 导出脱敏审计日志 CSV（`limit`≤10000，含 CSV 注入防护） |

---

## 4. 标准错误码与状态字典

### 4.1 统一上传校验错误码（`UPLOAD_ERROR`）

用于文件上传、校招附件、邮箱附件与浏览器导入附件的统一魔数/MIME/大小校验（`backend/src/storage/upload-validation.ts`）：

| 错误码 | 含义 |
|---|---|
| `EMPTY_FILE` | 文件内容为空（0 字节） |
| `FILE_TOO_LARGE` | 超过 `RESUME_MAX_MB` 限制（默认 20 MB） |
| `UNSUPPORTED_FORMAT` | 扩展名不在允许范围（本期支持 `.pdf` / `.doc` / `.docx` / `.png` / `.jpg` / `.jpeg` / `.webp`） |
| `MIME_MISMATCH` | 声明的 MIME 类型与扩展名不符 |
| `CONTENT_MISMATCH` | 文件头魔数识别结果与扩展名不符或无法识别 |

### 4.2 浏览器导入标准错误码（`BROWSER_IMPORT_ERROR`）

定义于 `backend/src/intake/browser-import.contract.ts`，扩展端按 `code` 精确分支：

| 错误码 | 触发场景与约束 |
|---|---|
| `TOKEN_INVALID` | 短期系统令牌缺失、格式错误或已撤销 |
| `TOKEN_EXPIRED` | 短期系统令牌已过期 |
| `TOKEN_OWNER_MISMATCH` | 令牌无权代表目标操作者 |
| `REQUEST_ID_REQUIRED` | 缺少合法的 `requestId`（幂等键） |
| `SOURCE_SITE_UNSUPPORTED` | 来源站点不在白名单（`BOSS_ZHIPIN` / `LIEPIN` / `OTHER`） |
| `SOURCE_URL_INVALID` | 来源页面 URL 非法或非 `http`/`https` 协议 |
| `THIRD_PARTY_CREDENTIAL_REJECTED` | 请求体任意层级包含 `cookie`/`authorization`/`password`/`token`/`secret`/`csrf` 等凭据键，立即拒绝且不落库 |
| `PAYLOAD_REQUIRED` | 既无附件字节也无白名单页面结构化字段 |
| `ATTACHMENT_UNAVAILABLE` | 附件不可用、传输中断或字节为空（失败阶段记为 `UPLOAD`） |
| `ATTACHMENT_INVALID` | 附件未通过统一上传校验（附带 `UPLOAD_ERROR` 明细） |
| `JOB_NOT_FOUND` | 指定的 `targetJobId` 不存在或当前操作者无权访问 |
| `TASK_NOT_FOUND` | 任务不存在或不属于当前操作者（统一防探测） |

### 4.3 AI 与邮箱处理状态码

- **AI 解析失败码**：`PARSE_FAILED`（解析异常或结构校验不通过时记录于 `AIRun.errorCode` 与 `ResumeIntake.errorCode`，降级转人工处理）。
- **邮箱单封邮件处理结论（`MAIL_OUTCOME`）**：
  - `PROCESSING`（处理中，异常中断重启后可排查重放）
  - `INGESTED`（已入待分配池建档）
  - `DUPLICATE`（附件哈希命中既有简历跳过）
  - `NO_ATTACHMENT`（无附件邮件，只记台账不建简历）
  - `UNSUPPORTED`（非允许格式或 `.eml` 解包后无可用附件）
  - `EXCEL`（含 `.xls`/`.xlsx`/`.csv`，不走 AI 解析）
  - `ERROR`（单封处理异常，不阻断同批其他邮件）

### 4.4 通用 HTTP 状态码约定

| 状态码 | 语义 |
|---|---|
| `200` / `201` | 同步读写或资源创建成功 |
| `202` | 异步任务已受理入队（如钉钉同步、同步重试、浏览器导入任务契约） |
| `400` | 参数校验失败、非法日期或业务必填项缺失 |
| `401` | 未认证、JWT/刷新令牌/系统令牌无效或钉钉回调签名无效 |
| `403` | 缺少功能权限、字段/附件敏感授权或操作越权 |
| `404` | 资源不存在，或对无权访问的隔离资源（如附件、他人导入任务）隐藏存在性 |
| `409` | 乐观并发冲突、重复初始化或非法状态机跃迁冲突 |
