# 招聘系统技术设计与开发环境说明

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 编写日期 | 2026-11-11 |
| 配套文档 | `ats-功能需求文档-v1.2.md`、`ats-PRD-v1.0.md` |
| 适用读者 | 研发、测试、运维、实施 |
| 文档性质 | 开发基线；标记「待评审」的选型需在对应开发任务开始前冻结 |

---

## 0. 基线与决策摘要

### 0.1 已确认事实

- 当前代码根目录为 **`d:/hr`**；PRD 中的原型路径已同步修正为 `d:/hr/src`。
- 现有原型为 React 18 + Vite + TypeScript，数据保存在浏览器 `localStorage`，没有后端、数据库和真实鉴权。
- 部署目标为阿里云、单租户；无租户维度。
- 钉钉是唯一业务系统集成，包含组织身份、消息、日历、听记、OA 录用审批和 OA 招聘需求同步六类能力。
- 新增 Chrome/Edge MV3 浏览器插件，支持 BOSS 直聘/猎聘的用户主动导入。
- AI 解析、AI 评估、邮件、插件导入均存在异步处理与失败重试要求。

### 0.2 本版建议冻结的技术决策

| 决策 | 结论 |
|---|---|
| 总体架构 | **模块化单体 API + 独立 Worker + Web 前端 + 浏览器扩展** |
| 后端 | Node.js 22 LTS + TypeScript + NestJS |
| 数据库 | MySQL 8 + Prisma ORM |
| 异步任务 | Redis 7 + BullMQ |
| 前端 | 保留 React 18 + Vite，逐步迁移到真实 API |
| 文件存储 | 统一 Storage 接口；开发环境本地磁盘，测试/生产阿里云 OSS |
| 外部能力 | AI、钉钉、招聘网站适配器全部接口化，开发期使用 Mock |
| 部署形态 | 容器化部署到 ECS；首期不引入 Kubernetes、不拆微服务 |

> 后端框架与 ORM 为本版建议选型。若团队已有统一 Java/Python 技术栈，可替换实现，但本文的模块边界、接口契约、异步与审计规则不变。

---

## 1. 设计目标与原则

1. **先跑通业务主链**：数据模型、简历入场、候选人状态机优先于外部集成。
2. **外部能力不阻塞开发**：AI、钉钉、BOSS/猎聘均提供 Mock，可独立替换。
3. **避免过度设计**：单租户、单套服务，不引入多租户框架、服务网格或复杂编排。
4. **业务写入可追溯**：状态变化、字段修改、自动动作和文件访问均有审计记录。
5. **异步结果可重试**：任何网络重试、Worker 重试不得产生重复候选人或重复任务。
6. **敏感数据最小化**：不存薪资，不存第三方平台凭据，附件默认私有。

---

## 2. 总体架构

```text
HR / 用人经理 / 面试官
        │
        ▼
React Web（Vite 构建，Nginx 托管）
        │ HTTPS /api/v1
        ▼
NestJS API（模块化单体）
        ├─ 身份、组织、RBAC、字段级权限
        ├─ 职位、候选人、面试、Offer、人才库
        ├─ 导入、查重、报表、设置、审计
        └─ Outbox / 任务生产
              │
              ▼
         MySQL 8 ◄──────────────┐
         Redis 7 / BullMQ       │
              │                 │
              ▼                 │
       Worker 独立进程           │
        ├─ 邮件获取              │
        ├─ 插件导入与解析         │
        ├─ AI 评估               │
        ├─ 钉钉同步与通知         │
        └─ 数据保留与清理         │
              │                 │
              ├─ Storage ──► OSS │
              ├─ AI Provider     │
              └─ DingTalk Adapter│
                                │
Chrome/Edge MV3 扩展 ────────────┘
（Content Script → Service Worker → Browser Import API）
```

### 2.1 为什么采用模块化单体

- 招聘主链强事务、强一致性，拆服务会增加分布式事务成本。
- 团队首期的主要不确定性在业务规则和外部平台适配，不在服务扩容。
- API 与 Worker 共享领域模型和 Prisma Client，但独立部署、独立扩缩容。
- 后续确有必要时，可按模块边界拆出 AI、导入或通知服务。

---

## 3. 技术选型

| 层 | 建议选型 | 用途 |
|---|---|---|
| 运行时 | Node.js 22 LTS、npm | 与现有前端工具链统一 |
| 语言 | TypeScript，开启 `strict` | 前后端共享契约 |
| Web | React 18、Vite 5、React Router、TanStack Query | 页面路由、服务端状态与缓存 |
| 表单/校验 | React Hook Form + Zod | 草稿表单、接口数据校验 |
| API | NestJS、REST `/api/v1` | 业务接口与鉴权 |
| ORM | Prisma | Schema、迁移、类型生成 |
| 数据库 | MySQL 8（InnoDB、utf8mb4、UTC） | 业务数据 |
| 队列 | BullMQ + Redis 7 | 解析、评估、通知、同步、清理 |
| 附件 | Storage 接口 + 阿里云 OSS SDK | 私有附件与签名访问 |
| 测试 | Vitest、Supertest、Playwright | 单元、接口、端到端 |
| 插件 | Manifest V3、TypeScript、Service Worker | 用户主动导入 |
| 日志 | JSON 结构化日志，测试/生产写入 SLS | 审计与问题定位 |

版本在脚手架建立时写入锁文件；生产构建必须使用锁文件执行 `npm ci`。

---

## 4. 目标仓库结构

```text
d:/hr/
├─ apps/
│  ├─ web/                 # 现有 React 应用迁移至此
│  ├─ api/                 # NestJS HTTP 服务
│  ├─ worker/              # BullMQ 消费者与定时任务
│  └─ extension/           # MV3 浏览器插件
├─ packages/
│  ├─ contracts/           # DTO、Zod Schema、稳定枚举、错误码
│  ├─ database/            # Prisma Client、事务与仓储公共代码
│  └─ shared/              # 纯工具函数，不含业务单例
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ deploy/
│  ├─ docker-compose.yml   # 本地依赖
│  └─ nginx/               # Web 托管与 API 反向代理
├─ fixtures/
│  ├─ resumes/             # 脱敏简历样本
│  └─ extension/           # 脱敏平台 HTML/附件样本
├─ docs/
├─ scripts/
├─ .env.example
├─ .nvmrc
└─ package.json            # npm workspaces
```

### 4.1 迁移原则

- 不做一次性重写；先将现有页面移入 `apps/web`，再逐页替换 `localStorage`。
- `packages/contracts` 只放稳定枚举和接口契约，不复制后端实体实现。
- 业务规则放在 API 的领域服务中，前端不得自行判断状态能否流转。
- 现有 `src/types.ts` 按 PRD 重构，不在原类型上继续堆可选字段。

---

## 5. 后端模块划分

| 模块 | 主要职责 |
|---|---|
| `IdentityModule` | 登录、令牌、钉钉身份映射、安装授权 |
| `OrganizationModule` | 部门、用户、用户组、钉钉同步 |
| `AccessModule` | 功能权限、数据范围、字段级脱敏 |
| `JobModule` | 职位、HC、招聘要求、面试方案 |
| `CandidateModule` | 候选人、阶段流转、筛选、锁定、时间线 |
| `InterviewModule` | 面试、评价、代填、日程、听记链接 |
| `OfferModule` | Offer 状态、背调材料、待入职、试用期 |
| `ImportModule` | 上传、邮箱、浏览器插件、查重、导入监控 |
| `AIModule` | 模型适配、模板版本、草稿、评估任务 |
| `TalentPoolModule` | 归档、激活、人才库 |
| `NotificationModule` | 通知规则、钉钉消息、重试 |
| `ReportModule` | 指标、下钻、报表口径 |
| `SettingModule` | 字段、原因选项、标签、渠道、插件配置 |
| `AuditModule` | 操作日志、附件访问日志、导出 |
| `RetentionModule` | 到期识别、删除、清理记录 |

跨模块写入通过领域服务或事件完成，禁止 Controller 之间互相调用。

---

## 6. 核心数据与一致性设计

### 6.1 数据库约定

- 表名使用 `snake_case`，实体字段在 TypeScript 中使用 `camelCase`。
- 主键使用 UUIDv7 字符串；业务展示编号单独生成，如职位 `MJ000005`。
- 时间统一保存 UTC，展示层转换为中国时区。
- 状态字段保存 PRD 中的稳定英文 key，中文名称不得进入逻辑判断。
- 动态配置使用 JSON，但核心筛选字段必须结构化并建立索引。
- 所有业务表包含 `createdAt`、`updatedAt`；需要乐观锁的实体增加 `version`。

### 6.2 事务与状态流转

一次候选人阶段流转必须在同一数据库事务内完成：

1. 校验当前用户功能权限与数据范围。
2. 使用 `id + version` 做乐观锁更新。
3. 校验 PRD 状态机和必填字段。
4. 写入 `TimelineEvent`。
5. 写入 `OutboxEvent`，供后续通知或异步任务消费。
6. 提交事务；失败整体回滚。

前端只提交动作，不直接写入目标阶段；目标状态由后端领域服务计算。

### 6.3 Outbox 与异步任务

```text
业务事务提交
  → OutboxEvent(NEW)
  → 调度器投递 BullMQ
  → Worker 幂等消费
  → 标记 OutboxEvent(PROCESSED / FAILED)
```

- 队列消息必须携带 `eventId`、`taskType`、`aggregateId`。
- 消费端先检查事件是否已处理，网络重试不得重复创建业务对象。
- 默认指数退避重试；超过上限进入失败队列并告警，支持人工重放。
- 邮件、AI、钉钉均设置独立并发上限，防止触发第三方限流。

### 6.4 查重与幂等

- 上传接口接受 `Idempotency-Key`；浏览器插件使用 `requestId`。
- 附件计算 SHA-256，文件内容相同不得重复占用存储。
- 候选人查重顺序：平台身份 → 附件哈希 → 规范化手机号/邮箱。
- 查重命中只返回候选结果，不自动合并；由 HR 确认更新或取消。

---

## 7. 认证、权限与审计

### 7.1 Web 登录

- 内部用户优先通过钉钉 OAuth 登录，后端使用授权码换取身份。
- `dingtalkUserId ↔ systemUserId` 一对一映射。
- Access Token：JWT，有效期 15 分钟，保存在前端内存。
- Refresh Token：旋转式、HttpOnly + Secure + SameSite=Lax Cookie，数据库只存哈希。
- 首次管理员通过一次性初始化流程创建，完成后关闭初始化接口。

### 7.2 插件授权

1. 用户在系统设置中生成一次性配对码，有效期 5 分钟。
2. 扩展使用配对码换取安装级凭据。
3. 后端只保存凭据哈希、安装 ID、授权人和权限范围。
4. 每次导入使用短期 Access Token；管理员可撤销单个安装。
5. 不申请、不保存 BOSS/猎聘密码、Cookie 或会话令牌。

### 7.3 权限执行位置

- 功能权限在 API 入口校验。
- 数据范围在领域查询和写入服务中强制添加，不依赖前端隐藏按钮。
- 字段级权限在响应序列化层脱敏，禁止“先返回完整数据再由前端隐藏”。
- 背调/流水等敏感附件使用独立权限点。
- 导出、批量操作和附件签名 URL 必须再次鉴权并写审计日志。

### 7.4 审计

审计记录至少包含：`actorId`、`action`、`resourceType`、`resourceId`、`requestId`、`before/after` 摘要、IP、User-Agent、时间。简历正文、第三方凭据和完整敏感附件内容不得写入日志。

---

## 8. 文件、AI 与外部适配器

### 8.1 文件存储

统一接口：

```text
Storage.put() / Storage.getSignedReadUrl() / Storage.delete() / Storage.exists()
```

- `LocalStorageDriver`：仅开发环境，保存到非 Git 目录。
- `OssStorageDriver`：测试与生产，Bucket 私有。
- 小文件可经 API 流式上传；大文件使用一次性上传凭证直传 OSS，完成后由后端校验。
- 文件类型通过扩展名、MIME 与文件头共同判断，不能只信任浏览器声明。
- 签名读 URL 默认短有效期，生成前检查访问权限并记录日志。
- 原始附件与解析结果分开存储，解析失败不得删除原件。

### 8.2 AI 服务

```text
ModelProvider
├─ MockProvider（默认开发实现）
└─ QwenProvider（待验证后启用）
```

- 模板按 `RESUME_PARSE`、`RESUME_EVAL`、`INTERVIEW_EVAL` 分版本管理。
- 输出先通过 JSON Schema/Zod 校验，再写入 `AIRun.output`。
- 模型超时、限流、结构错误分别记录错误码。
- 模型日志默认不保存完整简历或听记原文，只保存任务 ID、模板版本、耗时与错误。
- AI 输出始终为草稿，不触发状态流转，不进入 OA 审批结论。

### 8.3 钉钉适配器

按能力拆分：组织、日历、听记、OA、消息。共享 Token 缓存、限流和错误处理。

- 开发默认使用 `MockDingTalkAdapter`。
- 回调验证签名并校验事件 ID 幂等。
- Token 统一缓存，禁止各模块独立频繁获取。
- 同步失败进入重试，不阻塞本地候选人主流程。
- 每用户日程创建限额纳入校招批量排期设计。
- 具体 API、权限点和听记能力以技术验证结果为准。

### 8.4 浏览器插件

```text
Content Script
  └─ PlatformAdapter（BOSS / 猎聘）
Service Worker
  ├─ 本系统鉴权
  ├─ 文件上传与任务查询
  └─ 结果通知与失败重试
```

- `host_permissions` 只包含必要平台域名和本系统 API 域名。
- 适配器版本独立管理，支持远程停用和回滚。
- 使用脱敏 HTML 和附件夹具做回归测试，避免平台改版后无感知失效。
- 打开页面只检测，不导入；必须用户点击确认。
- 不遍历列表、不后台批量抓取、不绕过验证码或访问限制。

---

## 9. 开发、测试与生产环境

### 9.1 环境矩阵

| 项 | local | dev/test | production |
|---|---|---|---|
| 前端 | Vite `4173` | 测试域名 | 正式域名 HTTPS |
| API | `localhost:3000` | 测试 API 域名 | 正式 API 域名 |
| 数据库 | Docker MySQL 8 | 独立 RDS 测试库 | 独立 RDS 生产库 |
| Redis | Docker Redis 7 | 测试实例 | 生产实例 |
| 文件 | 本地磁盘 | OSS 测试 Bucket | OSS 生产 Bucket |
| AI | Mock | 专用测试账号/低配额 | 正式账号与配额 |
| 钉钉 | Mock | 测试企业/测试应用 | 正式企业应用 |
| 招聘平台 | 脱敏夹具 + Mock | 受控人工验证 | 灰度适配器 |
| 日志 | 控制台 | SLS 测试项目 | SLS 生产项目 |

生产真实候选人数据不得复制到 local 或 dev/test。

### 9.2 本地前置条件

- Node.js 22 LTS、npm、Git
- Docker Desktop（MySQL、Redis、Mailpit）
- Chrome 或 Edge 最新稳定版
- 可选：钉钉测试企业、AI 测试密钥、OSS 测试 Bucket

> Docker、钉钉测试应用和云资源是否已具备尚未检查，属于开发准备项，不影响先建立脚手架。

### 9.3 环境变量

仓库只提交 `.env.example`，真实密钥放入本地未跟踪文件或部署环境密钥管理。

| 分组 | 主要变量 |
|---|---|
| 应用 | `APP_ENV`、`APP_PORT`、`WEB_BASE_URL`、`API_BASE_URL` |
| 数据库 | `DATABASE_URL`、`REDIS_URL` |
| 鉴权 | `JWT_ACCESS_SECRET`、`REFRESH_TOKEN_PEPPER`、`TOKEN_TTL` |
| 文件 | `STORAGE_DRIVER`、`LOCAL_STORAGE_DIR`、`OSS_BUCKET`、`OSS_REGION` |
| AI | `AI_PROVIDER`、`AI_MODEL`、`AI_API_KEY`、`AI_TIMEOUT_MS` |
| 钉钉 | `DINGTALK_PROVIDER`、`DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_CALLBACK_URL` |
| 插件 | `EXTENSION_ALLOWED_ORIGINS`、`EXTENSION_TOKEN_TTL` |
| 限制 | `RESUME_MAX_MB`、`QUEUE_CONCURRENCY`、`SIGNED_URL_TTL_SECONDS` |

`.env.local`、配对码、Access Token、第三方 Cookie 均不得提交 Git。

### 9.4 目标启动命令

以下为脚手架完成后的目标命令，并非当前原型已经具备：

```bash
npm ci
docker compose up -d mysql redis mailpit
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` 并行启动 Web、API、Worker；插件通过 `npm run dev:extension` 构建后在浏览器开发者模式加载。

种子数据只包含：管理员、演示部门/角色、职位、原因选项、脱敏候选人和 Mock 外部账号。

---

## 10. API 与错误处理约定

- 基础路径：`/api/v1`。
- 列表优先游标分页；管理类小列表可使用页码分页。
- 写操作接受 `requestId`；浏览器导入强制 `Idempotency-Key`。
- 响应统一包含 `requestId`，便于关联日志。
- 错误结构：

```json
{
  "code": "CANDIDATE_STAGE_CONFLICT",
  "message": "候选人状态已变化，请刷新后重试",
  "requestId": "...",
  "details": {}
}
```

- 常见错误码：鉴权失效、权限不足、状态冲突、重复候选人、附件不可用、解析失败、适配器失效、第三方限流。
- 不向扩展或前端返回堆栈、SQL、密钥或第三方原始响应中的敏感内容。

---

## 11. 测试与质量门禁

### 11.1 测试分层

| 层 | 工具 | 重点 |
|---|---|---|
| 领域单元测试 | Vitest | 状态机、权限、查重、阶段条件 |
| API 集成测试 | Supertest + 测试 MySQL | 鉴权、事务、幂等、字段脱敏 |
| Worker 测试 | Vitest + Redis 测试实例 | 重试、重复消费、失败降级 |
| 契约测试 | Zod + fixtures | AI 输出、插件导入、钉钉回调 |
| E2E | Playwright | 简历入场到主链流转、插件主动导入 |
| 适配器回归 | 脱敏 HTML/附件 fixtures | BOSS/猎聘页面结构变化 |

状态机与权限判断要求覆盖所有分支；外部平台不得作为自动化测试的稳定依赖。

### 11.2 提交与合并门禁

1. TypeScript 类型检查。
2. ESLint / 格式检查。
3. 单元测试与 API 集成测试。
4. 前端、API、Worker、扩展构建。
5. Prisma migration 校验。
6. 密钥扫描与依赖漏洞检查。

数据库迁移不得直接修改已部署迁移文件；通过新迁移演进。

---

## 12. 部署设计

```text
用户 HTTPS
   ▼
SLB / Nginx
   ├─ 静态 Web
   └─ /api → API ECS
                 ├─ RDS MySQL
                 ├─ Redis
                 ├─ OSS
                 └─ SLS
Worker ECS（可独立扩缩容）
钉钉回调 → HTTPS → API /integrations/dingtalk/callback
```

- 构建统一容器镜像，环境差异只通过配置注入。
- dev 可单 ECS；生产建议至少两个 API 实例跨可用区，Worker 可独立部署。
- 定时任务使用 Redis 锁避免多实例重复执行。
- 健康检查：`/health/live`、`/health/ready`；就绪检查包含数据库和 Redis。
- 上线先执行迁移检查，再滚动替换实例；不兼容变更采用向后兼容的两阶段发布。
- 暂不引入 Kubernetes；实例数量和运维复杂度确有需要时再评估。

---

## 13. 可观测性、备份与安全

### 13.1 日志与告警

- JSON 日志包含 `requestId`、`taskId`、`actorId`、`module`，不包含简历正文和密钥。
- 指标：API 错误率、队列积压、任务失败率、AI 耗时、钉钉限流、插件适配器失败率。
- 告警：队列持续积压、任务多次重试、钉钉 Token 失效、适配器突然大面积失败、签名 URL 异常访问。

### 13.2 备份与清理

- RDS 开启自动备份并定期验证恢复。
- OSS 生产 Bucket 私有，按环境隔离。
- 数据保留任务必须同时处理结构化记录和附件。
- 备份保留周期与候选人删除策略需在上线前形成一致口径。

### 13.3 安全基线

- 全站 HTTPS，CORS 使用域名白名单。
- Refresh Token、插件安装凭据只存哈希。
- 限制登录、配对、上传和导出接口频率。
- 文件上传校验大小、类型和内容；必要时接入病毒扫描。
- 生产密钥通过部署环境或密钥管理服务注入，禁止写入镜像和仓库。

---

## 14. 开发顺序与并行验证

### 14.1 主开发线

1. **脚手架与基线**：workspaces、API/Worker、Prisma、鉴权、Mock 适配器、CI。
2. **数据模型与权限**：核心实体、状态机、RBAC、审计、迁移与种子数据。
3. **入场链路**：上传/手工、待分配池、查重、统一解析、Browser Import API。
4. **候选人主链**：阶段 Tab、筛选、状态流转、时间线。
5. **浏览器插件**：通用骨架 + 单平台灰度 + 第二平台适配。
6. **面试、Offer、入职**：主业务链路及权限控制。
7. **钉钉与 AI 实接**：Mock 替换为正式适配器。
8. **人才库、内推、报表、设置与上线准备**。

### 14.2 并行技术验证

| 验证 | 最小目标 | 通过条件 |
|---|---|---|
| AI | 一份 PDF、一张图片、一份听记样本 | 输出符合 JSON Schema，失败可降级，成本与耗时可接受 |
| 钉钉 | 测试企业组织同步 + 日历 + OA + 听记 | 权限可用、回调可验签、失败可重试 |
| 插件 | 单个平台的一份脱敏简历 | 用户点击后可上传字段和附件，重复点击不重复建档 |

验证失败只影响对应适配器，不暂停主开发线。

---

## 15. 待评审与不阻塞项

### 15.1 脚手架前确认

- [ ] 后端 NestJS + Prisma 选型是否接受；如不接受，确定替代框架。
- [ ] Git 仓库地址、默认分支、代码评审和 CI 平台。
- [ ] `d:/hr` 是否作为唯一开发目录，历史 `e:/zhaopin` 是否废弃。
- [ ] 本地 Docker 环境与开发机权限是否具备。

### 15.2 不阻塞主开发线

- AI 具体模型、密钥和听记能力：先 Mock。
- 钉钉应用权限与回调域名：先 Mock。
- BOSS/猎聘真实适配器：先 fixtures + Mock。
- 插件签名和企业分发：上线前确定。
- 数据保留具体期限：先配置化。
- 报表最终口径、Offer 中文状态名、原因选项初值：不影响核心模型。

---

## 16. 开发启动检查清单

完成以下项目即可开始第一阶段编码：

- [ ] 仓库与目录唯一，PRD 历史路径已清理。
- [ ] Node.js 22 与依赖安装方式统一。
- [ ] API、Worker、Web 的目录和启动方式确定。
- [ ] MySQL/Redis 本地依赖可启动。
- [ ] Prisma 初版 Schema 覆盖 PRD 核心实体。
- [ ] 状态机、权限、审计的归属模块明确。
- [ ] AI、钉钉、招聘平台均有 Mock 接口。
- [ ] `.env.example` 完整且不含真实密钥。
- [ ] CI 至少执行类型检查、测试和构建。
- [ ] 业务验收人及脱敏测试样本已指定。
