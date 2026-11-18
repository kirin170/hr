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
- `APP_ENV=local`、`LOCAL_AUTH_ENABLED=true`、`LOCAL_ADMIN_IDENTIFIER=admin`、`LOCAL_AUTH_SECRET=admin`：启用仅供本机开发的管理员账号密码登录。示例密码不得用于共享、测试部署或生产环境。
- `INITIAL_ADMIN_SECRET`：生产环境或钉钉初始化管理员时使用的一次性随机值，至少 32 字节。
- `REDIS_URL`：本机 Redis 地址，默认 `redis://127.0.0.1:6379`。

如需验证钉钉 OAuth，另外配置 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`、`DINGTALK_CORP_ID` 和 `DINGTALK_REDIRECT_URI`。回调地址必须与开发者后台登记值完全一致；本机前后端使用 `localhost` 主机名时，可用 `http://localhost:3000/api/v1/auth/dingtalk/callback`，登录成功地址设为 `http://localhost:4173/?dingtalk_login=success`。不要混用 `localhost` 与 `127.0.0.1`，浏览器 Cookie 按主机名隔离。组织事件同步另需回调 Token/AESKey 和具有 `organization:sync` 权限的管理员账号。真实凭据只放在未提交的 `backend/.env`。

真实数据库和钉钉凭据只保存在未提交的 `backend/.env` 或本机密钥管理器中，不要提交、粘贴到代码或复用生产密钥。可在 PowerShell 中生成随机值，例如：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

每个生产密钥分别生成一次。`admin/admin` 只允许用于隔离的本机开发环境；不要把 `APP_ENV=local`、`LOCAL_AUTH_ENABLED=true` 或此默认账号部署到共享环境。

## 3. 创建空数据库并初始化

仅对新建的空数据库执行。先用本机 MySQL 管理员创建数据库：

```powershell
mysql -u root -p -e "CREATE DATABASE talentflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

将 `.env` 中 `DATABASE_URL` 的账号、密码和库名改成与本机配置一致，然后在仓库根目录运行：

```powershell
npm run db:setup
```

该命令依次生成 Prisma Client、应用已提交的迁移，并运行可重复的权限/角色种子数据脚本。种子脚本创建权限与 `ADMIN`、`RECRUITER`、`HIRING_MANAGER`、`INTERVIEWER` 角色；当 `APP_ENV=local` 且启用本地认证时，也会创建账号 `admin`、密码 `admin` 的本机管理员并赋予 `ADMIN` 全量应用权限。

**已有数据库提示：** 如果库里已有表或由 `prisma db push` 建立但没有迁移历史，先备份并将实际结构与 `20261113000000_initial` 迁移逐项比对。仅在确认结构完全一致后，才可登记迁移基线；具体命令见 [backend README 的迁移说明](../backend/README.md#数据库迁移)。没有核对结构时不要运行 `db:setup` 或 `db:migrate:deploy`。

## 4. 本地管理员和登录

运行 `npm run db:setup` 后，种子脚本会在本地环境创建登录账号 `admin`、密码 `admin`，并关联 `ADMIN` 角色。若之前已执行过数据库初始化，重新运行 `npm run db:seed` 即可补建本机管理员。账号密码登录要求后端环境为 `APP_ENV=local`、`LOCAL_AUTH_ENABLED=true`，并且 `LOCAL_ADMIN_IDENTIFIER`、`LOCAL_AUTH_SECRET` 与登录值一致。

启动第 5 节中的前端和 API 服务后，开发登录页可同时选择账号密码登录和钉钉授权登录。此账号仅用于本机开发；钉钉 OAuth 仍需配置有效的开放平台凭据。

生产或真实钉钉管理员仍通过后端 `POST /api/v1/auth/bootstrap` 使用一次性 `INITIAL_ADMIN_SECRET` 初始化，不能使用本地 `admin/admin` 默认账号。详细接口约束见 [backend README](../backend/README.md)。

本地管理员通过 `LOCAL` 身份关联和 `LOCAL_AUTH_SECRET` 完成本机认证；该方式只用于隔离开发环境。开发登录页同时提供账号密码登录和钉钉授权入口。正式登录需配置钉钉开放平台应用、回调和组织身份映射；不要在生产环境开启本地身份适配。

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
