# TalentFlow ATS 本地开发运行手册

本文说明在 Windows 原生环境启动当前仓库、初始化一套新的本地数据库并访问已接入的 API。这里的初始化只适用于新建的空开发库；不要直接对已有或含业务数据的数据库执行初始化。

## 1. 环境要求

- Windows PowerShell。
- Node.js 22（项目基线为 Node.js 22.20.0 / npm 10.9.3）。
- MySQL 8 和 Redis 7 服务已启动；本机开发不使用 Docker。
- Git 仓库根目录为 `D:\hr`。

检查运行时：

```powershell
node --version
npm --version
mysql --version
redis-cli ping
```

`redis-cli ping` 应返回 `PONG`。若本机 MySQL/Redis 使用不同端口或账号，后续用本机实际连接信息配置。

## 2. 安装依赖和配置环境

在仓库根目录执行：

```powershell
npm ci
npm ci --prefix backend
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

编辑 `backend/.env`，至少设置：

- `DATABASE_URL`：指向下面创建的本地 `talentflow` 数据库。
- `JWT_ACCESS_SECRET`、`REFRESH_TOKEN_PEPPER`：各自使用至少 32 字节的本地随机值。
- `INITIAL_ADMIN_SECRET`：首次创建管理员时使用的一次性随机值，至少 32 字节。
- `APP_ENV=local`、`LOCAL_AUTH_ENABLED=true`、`LOCAL_AUTH_SECRET`：启用本地开发登录；本地登录密钥至少 32 字节。
- `REDIS_URL`：本机 Redis 地址，默认 `redis://127.0.0.1:6379`。

这些值只保存在未提交的 `backend/.env` 或本机密钥管理器中，不要提交、粘贴到代码或复用生产密钥。可在 PowerShell 中生成随机值，例如：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

每个密钥分别生成一次。`.env.example` 中的 `local-only` 值只适合明确隔离的本机演示；在可访问的共享环境中必须换成独立随机值。

## 3. 创建空数据库并初始化

仅对新建的空数据库执行。先用本机 MySQL 管理员创建数据库：

```powershell
mysql -u root -p -e "CREATE DATABASE talentflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

将 `.env` 中 `DATABASE_URL` 的账号、密码和库名改成与本机配置一致，然后在仓库根目录运行：

```powershell
npm run db:setup
```

该命令依次生成 Prisma Client、应用已提交的迁移，并运行可重复的权限/角色种子数据脚本。种子脚本创建权限与 `ADMIN`、`RECRUITER`、`HIRING_MANAGER`、`INTERVIEWER` 角色，不创建用户。

**已有数据库提示：** 如果库里已有表或由 `prisma db push` 建立但没有迁移历史，先备份并将实际结构与 `20261113000000_initial` 迁移逐项比对。仅在确认结构完全一致后，才可登记迁移基线；具体命令见 [backend README 的迁移说明](../backend/README.md#数据库迁移)。没有核对结构时不要运行 `db:setup` 或 `db:migrate:deploy`。

## 4. 创建本地管理员并登录

先启动 API（第 5 节）。使用与 `backend/.env` 中相同的 `INITIAL_ADMIN_SECRET`，通过 `LOCAL` 身份创建一次管理员。以下命令中的占位值仅在本地临时替换，不要把实际密钥写入脚本或提交到 Git：

```powershell
$bootstrapBody = @{
  setupToken = '<INITIAL_ADMIN_SECRET>'
  displayName = '本地管理员'
  identityProvider = 'LOCAL'
  identitySubject = 'local-admin'
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3000/api/v1/auth/bootstrap' `
  -ContentType 'application/json' `
  -Body $bootstrapBody
```

创建成功后，从 `backend/.env` 清除 `INITIAL_ADMIN_SECRET` 并重启 API。该接口只能成功初始化一次。开发登录使用相同的 `LOCAL_AUTH_SECRET`：

```powershell
$loginBody = @{
  identifier = 'local-admin'
  secret = '<LOCAL_AUTH_SECRET>'
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3000/api/v1/auth/local' `
  -ContentType 'application/json' `
  -Body $loginBody

$login.accessToken
```

前端还没有登录页面。若需走查接入后端的页面，在 `http://localhost:4173` 打开浏览器开发者工具 Console，将刚取得的短期令牌写入当前本地站点，再刷新页面：

```javascript
localStorage.setItem('talentflow.accessToken', '<本次登录返回的 accessToken>')
```

访问令牌默认 15 分钟有效；失效后重新调用本地登录接口并替换令牌。不要将真实令牌保存到文档、截图或仓库。

本地登录只适用于隔离开发环境。正式登录需接入组织身份，当前仓库不含钉钉 OAuth 登录流程；不要在生产环境开启本地身份适配。

## 5. 启动 Web、API 和 Worker

在仓库根目录打开三个独立 PowerShell 终端，分别运行：

```powershell
npm run dev:web
```

```powershell
npm run dev:api
```

```powershell
npm run dev:worker
```

Web 地址为 `http://localhost:4173`；API 默认监听 `http://localhost:3000`。Vite 将 `/api` 请求代理到 API。API 与 Worker 分别运行，API 不会消费解析队列；需要验证异步解析时应保持 Worker 和 Redis 同时运行。

快速检查 API 进程：

```powershell
Invoke-RestMethod 'http://localhost:3000/'
```

应返回 `Hello World!`。登录后也可通过前端页面确认候选人列表和职位/招聘需求页面能加载；未经授权的请求返回 401 属于预期行为。

## 6. 可复现的检查命令

按需在仓库根目录运行：

```powershell
npm run db:validate
npm run typecheck --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run test:e2e --prefix backend
npm run build:api
npm run build
```

这些是当前仓库定义的本地检查命令；执行结果应以本次实际运行记录为准，不能仅凭本手册或历史 CI 记录推断当前检查已通过。MySQL 迁移验证需要单独的隔离测试库，不能使用个人或生产数据库。

## 7. 数据范围与原型功能收敛

- 候选人列表、详情、新建和阶段更新连接 API，后端 MySQL 是其数据来源。现有页面仍展示早期六阶段；目标九阶段和完整人才库闭环尚未交付。
- 职位与招聘需求页面连接后端 API。OA 招聘需求同步目前是供开发和验收使用的 Mock 契约，不接收真实钉钉 OA 回调。
- 工作台、面试、部门协同、报表和试用期页面使用内存中的演示初始数据；刷新会恢复初值。“重置演示数据”不会清除 API 或数据库中的候选人、职位和需求。
- 原型“待办审批”及其通过按钮不是本系统审批流。招聘审批应以钉钉 OA 为准，正式对接由对应集成任务完成；不得依据原型演示审批结果处理业务。
- 试用期原型的评分、目标进度、打卡和反馈不属于最终范围。目标能力只记录是否转正及转正时间；后续按待入职与试用期任务迁移/收敛，不迁移演示分数或绩效数据。
- 批量导入、导出、日历、邮件及其他未接入入口可能仍展示交互，但不代表对应外部系统或业务能力已交付。

正式业务范围和未决事项以 [功能需求文档](ats-功能需求文档-v1.2.md)、[PRD](ats-PRD-v1.0.md) 及[实施路线图](ats-项目目标与实施路线图-v1.0.md)为准；后续模块交付时应继续更新本手册。
