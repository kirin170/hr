# TalentFlow ATS 技术设计与开发环境说明

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 编写日期 | 2026-11-11 |
| 最近修订 | 2026-11-21：同步当前实际仓库结构、`dev` 分支流程、环境变量名、钉钉回调路径、排序规则与检查清单 |
| 配套文档 | `ats-功能需求文档-v1.2.md`、`ats-PRD-v1.0.md` |
| 适用读者 | 研发、测试、运维、实施 |
| 文档性质 | 开发基线；前后端技术栈已于 2026-11-11 确认冻结，后续变更需走技术决策记录 |

---

## 0. 基线与决策摘要

### 0.1 已确认事实

- 系统正式全称为 **TalentFlow 招聘管理系统**；技术文档及仓库说明使用 **TalentFlow ATS**；界面显示 **TalentFlow**，配中文副标题“招聘管理系统”。
- 当前代码根目录为 **`d:/hr`**，已确认为唯一开发目录（2026-11-11）；PRD 中的原型路径已同步修正为 `d:/hr/src`。
- 历史路径 `e:/zhaopin` 已不存在，不再保留第二份代码副本；后续开发、构建与文档均以 `d:/hr` 为准。
- 现有原型为 React 18 + Vite + TypeScript，数据保存在浏览器 `localStorage`，没有后端、数据库和真实鉴权。
- 部署目标为阿里云、单租户；无租户维度。
- 本地开发环境为 **Windows**，不使用 Docker；MySQL、Redis、Node.js 已安装并在本机运行。
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
| AI 选型方向 | 钉钉/通义优先 + 外部模型兜底；具体能力与切换细则待验证；本期所有结果人工确认后转正式 |
| 部署形态 | 容器化部署到 ECS；首期不引入 Kubernetes、不拆微服务 |

> **决策状态**：前端 React 18 + Vite + TypeScript，后端 Node.js 22 + TypeScript + NestJS + Prisma，已于 2026-11-11 确认接受。后续如需更换框架，必须重新评估模块边界、接口契约、异步与审计规则。

### 0.3 AI 模型接入策略

- 钉钉/通义优先，外部模型兜底；经统一 `ModelProvider` 接口服务于三个 AI 场景，不将业务模块绑定到单个供应商；业务规则见功能需求 §4.12。
- 降级边界：优先方案不可用或能力不满足时按配置使用外部模型，各方案均失败时继续按既有规则人工处理；AI 草稿、人工复核、权限和脱敏规则对所有方案一致。
- 尚待落实：具体供应商与型号、实际租户听记能力、结构化输出和多模态效果，以及切换细则；由 ATS-020/021 技术验证，不把接入策略当作实接验收证据。

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

| 层 | 已确认选型 | 用途 |
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

## 4. 仓库结构

> 说明：早期曾规划 `apps/web` + `apps/api` + `apps/worker` 的 monorepo 结构；实际演进中确定采用**根目录前端 + `backend/` 独立工程**的扁平布局，以避免迁移中断。当前仓库权威结构如下：

```text
d:/hr/
├─ src/                    # React 18 + Vite 前端应用
├─ public/                 # 前端静态资源
├─ backend/                # NestJS 模块化单体 API 与 Worker（含独立 package.json）
│  ├─ prisma/
│  │  ├─ schema.prisma     # 数据库模型（唯一权威 Schema）
│  │  ├─ migrations/       # Prisma 迁移历史（只追加，不改旧文件）
│  │  └─ seed.mjs          # 默认权限/角色与本地开发管理员种子
│  ├─ scripts/             # 运维与联调辅助脚本（如邮箱探测）
│  ├─ src/                 # 业务模块（auth/candidates/jobs/requisitions/intake/mail/ai/dingtalk/attachments/retention/storage/audit/timeline）
│  ├─ test/                # 端到端测试
│  └─ .env.example         # 环境变量唯一权威模板
├─ packages/
│  └─ domain/              # 跨端共享领域契约/辅助代码
├─ docs/                   # 文档中心与 verification/ 验收报告
├─ scripts/                # 仓库级工程脚本
├─ .github/workflows/      # GitHub Actions CI 门禁
└─ package.json            # 前端构建与根目录常用代理脚本（dev:web/dev:api/dev:worker/db:*）
```

> 注：浏览器扩展（`ATS-011`）尚未纳入仓库，后续可独立置于 `extension/` 目录并补入 CI 构建；根目录若存在空 `prisma/` 占位目录，不作为 Schema 来源，一律以 `backend/prisma/` 为准。

### 4.1 迁移原则

- 不做一次性重写；保留根目录 `src/`，逐页替换原型演示数据（`src/data.ts`）为真实 API。
- 业务规则放在 `backend/src/` 的领域服务中，前端不得自行判断状态能否流转。
- 现有 `src/types.ts` 按 PRD 演进，不以原型六阶段覆盖服务端规范状态枚举。

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
| `OfferModule` | PRD §4.2 六个 Offer 阶段及各阶段待处理/接受/不通过子状态、背调材料、待入职、试用期 |
| `ImportModule` | 上传、邮箱、浏览器插件、查重、导入监控 |
| `AIModule` | 模型适配、模板版本、草稿、评估任务 |
| `TalentPoolModule` | 归档、激活、人才库 |
| `NotificationModule` | 通知规则、钉钉消息、重试 |
| `ReportModule` | 指标、下钻、报表口径 |
| `SettingModule` | 管理后台通用配置、字段、字典、原因、表单/面试模板及各集成配置入口；复用对应领域服务 |
| `AuditModule` | 操作日志、附件访问日志、导出 |
| `RetentionModule` | 到期识别、删除、清理记录 |

跨模块写入通过领域服务或事件完成，禁止 Controller 之间互相调用。

### 5.1 管理后台与配置实现

范围对应功能需求 §4.14、PRD §9（FR-ADM-1～10）。沿用现有 React Web 与模块化单体 API，提供独立管理入口及左侧分类导航、右侧配置列表/详情，不另建一套身份体系。个人资料和个人通知偏好位于用户菜单；常用配置与高级参数分层展示。

| 管理模块 | 复用能力 |
|---|---|
| 组织与成员、角色与权限 | Organization/Identity/Access 的钉钉同步、身份映射、角色、用户组、数据范围和字段授权 |
| 招聘基础配置、表单与面试模板、原因选项 | Setting 管理通用配置，Job/Candidate/Interview/TalentPool 领域服务使用并校验 |
| 渠道与导入、钉钉、AI、通知管理 | Import、钉钉适配器、AI、Notification 提供配置、连接测试、运行记录及受控重试入口 |
| 安全、审计与运行监控 | Audit/Retention、既有服务健康状态与异步任务记录；复用日志、文件访问与清理能力 |

实现约束：

- 配置在服务端持久化并校验，管理入口和读写 API 均校验功能权限；候选人数据范围、敏感字段和附件权限独立校验，后台管理员身份不自动获得敏感数据访问权。
- 配置保存明确反馈成功或失败，提交后业务界面和新任务读取有效配置；更新采用事务或版本冲突校验，避免并发修改静默覆盖。不能以只改前端状态作为配置生效证据。
- 字典和原因使用稳定标识并支持启停、排序；模板使用版本或业务记录快照保留既有表单含义。停用/更新不破坏历史显示及统计，不允许直接删除已被引用的数据导致记录失真。
- 变更记录操作人、对象、时间、requestId 及脱敏的前后值。集成凭据从服务端安全配置读取，仅展示配置状态；不向浏览器返回明文、不写入日志。运行详情、导出和人工重试另做鉴权。
- 固定九阶段、Offer 六阶段、业务必填条件和招聘周期规则由领域服务强制执行；AI 人工确认是固定条件。后台不可覆盖上述规则，不新增通用流程或审批引擎。
- 钉钉作为正式组织来源；邮箱附件先进待分配池、人工选职位；不启用虚拟职位自动分配。AI 主选/兜底均执行同一草稿与人工复核契约。
- 服务连接与异步任务页展示状态、最近处理时间、脱敏失败原因及允许的恢复动作；重试沿用原模块的幂等、重试次数和限流机制，不另造任务执行通道。

ATS-024 交付统一入口、通用配置及配置审计；领域能力按 PRD §9.4 复用原任务接口。管理基础、业务配置、集成管理分层交付，未接入项明确显示状态。对应验证覆盖配置持久化与真实生效、直调 API 越权、敏感权限隔离、审计脱敏、历史兼容及失败恢复；正式集成仍须独立验收。

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
- 访问令牌采用 JWT，有效期 15 分钟，保存在前端内存，不落盘且不写入 URL 或日志。
- 刷新令牌使用轮换机制和 HttpOnly、Secure、SameSite=Lax Cookie，数据库仅存哈希。
- 首次管理员通过 `POST /api/v1/auth/bootstrap` 一次性创建；服务端要求至少 32 字节的 `INITIAL_ADMIN_SECRET`，并以数据库唯一初始化标记拒绝重复创建。完成后移除环境中的初始化密钥。
- 本地身份适配仅在 `APP_ENV=local` 且显式设置 `LOCAL_AUTH_ENABLED=true` 时启用；生产环境拒绝本地登录。
- ATS-004 已实现钉钉身份与系统用户的映射，不含 OAuth 授权码交换流程；正式钉钉登录接入属于 ATS-017。

默认权限种子创建管理员、招聘 HR、用人经理和面试官角色，不预置用户，也不会默认授权读取或写入联系方式。联系方式、背调材料与银行流水通过用户或用户组级字段授权单独授予，可设置到期时间。部门范围在 API 查询/写入服务端过滤，不能由前端筛选替代。

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
├─ DingTalkProvider / QwenProvider（主选方向；具体能力验证后启用）
└─ ExternalModelProvider（兜底方向；具体供应商与型号待验证）
```

- 上述为适配器设计，不表示已有正式实现；按 §0.3 钉钉/通义优先，外部模型按配置兜底，均失败时降级人工处理。
- 三场景通过统一接口选择主选/兜底模型，具体切换细则在接入设计中确定；模型切换不改变业务输入输出契约。
- 模板按 `RESUME_PARSE`、`RESUME_EVAL`、`INTERVIEW_EVAL` 分版本管理。
- 输出先通过 JSON Schema/Zod 校验，再写入 `AIRun.output`。
- 模型超时、限流、结构错误分别记录错误码。
- 模型日志默认不保存完整简历或听记原文，只保存任务 ID、模板版本、耗时与错误。
- AI 输出始终为草稿，不触发状态流转，不进入 OA 审批结论。
- 本期全部解析结果须由 HR 显式确认后才能写入正式档案；高置信度也不得绕过确认。`AIRun.output` 可保存草稿，置信度仅辅助核对，后续自动转正式另行开放。

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
| 操作系统 | Windows 10/11 + PowerShell | Linux 容器 | Linux ECS |
| 前端 | Vite `4173` | 测试域名 | 正式域名 HTTPS |
| API | `127.0.0.1:3000` | 测试 API 域名 | 正式 API 域名 |
| 数据库 | **本机 MySQL 8 服务** `127.0.0.1:3306` | 独立 RDS 测试库 | 独立 RDS 生产库 |
| Redis | **本机 Redis 7 服务** `127.0.0.1:6379` | 测试实例 | 生产实例 |
| 文件 | 本地磁盘 | OSS 测试 Bucket | OSS 生产 Bucket |
| AI | Mock | 专用测试账号/低配额 | 正式账号与配额 |
| 钉钉 | Mock | 测试企业/测试应用 | 正式企业应用 |
| 邮件 | Mock | 测试邮箱 | 正式接收邮箱 |
| 招聘平台 | 脱敏夹具 + Mock | 受控人工验证 | 灰度适配器 |
| 日志 | 控制台 | SLS 测试项目 | SLS 生产项目 |

生产真实候选人数据不得复制到 local 或 dev/test。

### 9.2 本地前置条件

- Windows 10/11，PowerShell 5.1 或 PowerShell 7+
- Node.js 22 LTS、npm、Git（已安装）
- MySQL 8（已安装，本地服务运行）
- Redis 7（已安装，本地服务运行）
- Chrome 或 Edge 最新稳定版
- 可选：钉钉测试企业、AI 测试密钥、OSS 测试 Bucket

本地**不使用 Docker**。MySQL、Redis 直接使用 Windows 已安装的服务；如需本地邮件调试，可运行独立 SMTP 工具，否则使用 `MAIL_PROVIDER=mock`。

**2026-11-11 实测环境**：

| 项 | 结果 |
|---|---|
| Node.js | v22.20.0 |
| npm | 10.9.3 |
| MySQL 服务 | `MySQL80` 运行中 |
| Redis 服务 | `Redis` 运行中，`redis-cli ping` 返回 `PONG` |
| MySQL 客户端 | `mysql` 未加入 PATH；完整路径 `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe` |

MySQL 客户端未入 PATH 不影响 Prisma 连接，但执行建库/排查时需使用完整路径，或将 `C:\Program Files\MySQL\MySQL Server 8.0\bin` 加入系统 PATH。

### 9.3 本地服务自检

在 PowerShell 中执行：

```powershell
node -v
npm -v
mysql --version
redis-cli --version
```

检查服务是否运行（服务名以本机实际安装为准）：

```powershell
Get-Service | Where-Object { $_.Name -match 'mysql|redis' } | Select-Object Name, Status
```

若服务未启动：

```powershell
Start-Service -Name "<本机 MySQL 服务名>"
Start-Service -Name "<本机 Redis 服务名>"
```

连接验证：

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -h 127.0.0.1 -P 3306 -u root -p -e "SELECT VERSION();"
redis-cli -h 127.0.0.1 -p 6379 ping
```

`mysql` 当前不在 PATH，使用上述完整路径；`redis-cli` 已在 PATH。Redis 返回 `PONG`、MySQL 返回版本号即视为本地依赖就绪。

创建本地数据库（库名可按实际调整，统一使用 MySQL 8 默认排序规则 `utf8mb4_0900_ai_ci`）：

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -h 127.0.0.1 -P 3306 -u root -p -e "CREATE DATABASE IF NOT EXISTS talentflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

> Windows 下统一使用 `127.0.0.1`，避免 `localhost` 被解析为 IPv6 导致 MySQL/Redis 连接失败。

### 9.4 环境变量

仓库只提交 `backend/.env.example`（唯一权威变量清单）。本地将其复制为被 Git 忽略的 `backend/.env`，并替换示例值；Nest 启动器也支持优先读取 `backend/.env.local`。生产环境通过部署密钥管理注入真实密钥。Prisma CLI 使用 `.env`，因此执行数据库命令时应确保该文件存在。

| 分组 | 主要变量（完整列表见 `backend/.env.example`） |
|---|---|
| 应用 | `APP_ENV`、`APP_PORT`、`API_BASE_URL` |
| 数据库 | `DATABASE_URL`、`REDIS_URL` |
| 鉴权 | `JWT_ACCESS_SECRET`、`REFRESH_TOKEN_PEPPER`、`TOKEN_TTL`、`REFRESH_TOKEN_TTL_DAYS`、`INITIAL_ADMIN_SECRET`、`LOCAL_AUTH_ENABLED`、`LOCAL_ADMIN_IDENTIFIER`、`LOCAL_AUTH_SECRET` |
| 文件与保留 | `STORAGE_DRIVER`、`LOCAL_STORAGE_DIR`、`STORAGE_SIGNING_SECRET`、`OSS_BUCKET`、`OSS_REGION`、`OSS_ENDPOINT`、`RETENTION_RESUME_DAYS`、`RETENTION_SENSITIVE_DAYS` |
| AI | `AI_PROVIDER`（正式接入后补齐模型与密钥项） |
| 钉钉 | `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`、`DINGTALK_CORP_ID`、`DINGTALK_REDIRECT_URI`、`DINGTALK_LOGIN_SUCCESS_REDIRECT`、`DINGTALK_CALLBACK_TOKEN`、`DINGTALK_CALLBACK_AES_KEY`、`DINGTALK_SYNC_ROOT_DEPARTMENT_ID` |
| 邮件 | `MAIL_PROVIDER`、`MAIL_INBOX_HOST`、`MAIL_INBOX_PORT`、`MAIL_INBOX_SECURE`、`MAIL_INBOX_USER`、`MAIL_INBOX_PASSWORD`、`MAIL_POLL_INTERVAL_SECONDS` |
| 限制与队列 | `RESUME_MAX_MB`、`SIGNED_URL_TTL_SECONDS`、`PARSE_MAX_ATTEMPTS`、`QUEUE_CONCURRENCY` |

本地 `backend/.env` 示例由 `backend/.env.example` 提供。设置本机数据库密码、随机访问令牌密钥和刷新令牌 pepper；首次管理员创建前配置一次性初始化密钥。默认关闭本地身份登录：

```dotenv
APP_ENV=local
APP_PORT=3000
DATABASE_URL=${DATABASE_URL}
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
REFRESH_TOKEN_PEPPER=${REFRESH_TOKEN_PEPPER}
INITIAL_ADMIN_SECRET=${INITIAL_ADMIN_SECRET}
LOCAL_AUTH_ENABLED=false
STORAGE_DRIVER=local
AI_PROVIDER=mock
```

`.env.local`、配对码、Access Token、第三方 Cookie 均不得提交 Git。

### 9.5 本地启动与数据库初始化

**执行前先确认 MySQL 与 Redis 服务已启动。** 新环境先创建空数据库，再安装依赖并应用已提交迁移：

```powershell
cd D:/hr
npm ci
npm ci --prefix backend
Copy-Item backend/.env.example backend/.env
npm run db:setup
```

按需替换 `backend/.env` 中的本机 MySQL 密码和随机开发密钥。新环境创建数据库：

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -h 127.0.0.1 -P 3306 -u root -p -e "CREATE DATABASE IF NOT EXISTS talentflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

在三个终端分别启动 Web、API 和解析 Worker：

```powershell
npm run dev:api
```

```powershell
npm run dev:worker
```

```powershell
npm run dev:web
```

脚本约定：

| 命令 | 作用 |
|---|---|
| `npm run db:generate` | 生成 Prisma Client |
| `npm run db:setup` | 生成 Prisma Client、重放全部已提交迁移并写入默认权限/角色，适合空数据库初始化 |
| `npm run db:seed` | 幂等写入默认权限和角色，不创建用户 |
| `npm run db:migrate` | 本地开发时根据 Schema 创建新迁移并应用 |
| `npm run db:migrate:deploy` | 在部署或 CI 中只应用已提交迁移 |
| `npm run db:migrate:status` | 查看数据库迁移状态 |
| `npm run dev:web` | 启动 Vite 前端 |
| `npm run dev:api` | 启动 NestJS API |
| `npm run dev:worker` | 独立启动 BullMQ 解析 Worker |

默认种子只包含权限与角色，不创建用户。已有数据的数据库不得直接使用空库初始化流程；先备份并比较现有结构与迁移，确认结构完全符合首个迁移后才可登记首个迁移基线并执行后续迁移，否则应先制定数据保留迁移方案。已提交迁移只追加新迁移，不修改历史文件。

---

## 10. API 与错误处理约定

- 基础路径：`/api/v1`。
- 列表优先游标分页；管理类小列表可使用页码分页。
- 人才库后台不设硬性拉取上限，通过流式加载、分页与索引优化保障性能；「1w+」仅用于人才库统计总量 ≥10000 的展示，阶段 Tab 和报表显示真实数量。
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

CI 平台：**GitHub Actions**，工作流见 `.github/workflows/ci.yml`。合并到 `master` 前必须全部通过。

1. API/Worker TypeScript 类型检查及 oxlint。
2. 后端单元测试与 API 测试；CI 使用 MySQL 8 和 Redis 7 服务。
3. Web 构建，以及 API/Worker 构建产物入口检查。
4. Prisma Schema 校验、CI 数据库迁移应用与迁移状态检查。
5. Gitleaks 提交密钥扫描。

当前仓库尚无浏览器扩展工程，因此 CI 不构建扩展；扩展纳入仓库后应在此工作流增加对应构建门禁。CI 迁移仅操作临时 MySQL 服务，不连接开发或生产数据库。

数据库迁移不得直接修改已部署迁移文件；通过新迁移演进，并统一通过 `npx prisma migrate dev --create-only` 生成精确到秒的时间戳目录名（禁止手工构造整点时间戳，避免并行开发出现同前缀迁移碰撞）。

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
钉钉回调 → HTTPS → API /api/v1/dingtalk/events
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
8. **人才库、来源与推荐人记录、校招门户、报表、设置与上线准备**。

### 14.2 并行技术验证

| 验证 | 最小目标 | 通过条件 |
|---|---|---|
| AI | 一份 PDF、一张图片、一份听记样本 | 输出符合 JSON Schema，失败可降级，成本与耗时可接受 |
| 钉钉 | 测试企业组织同步 + 日历 + OA + 听记 | 权限可用、回调可验签、失败可重试 |
| 插件 | 单个平台的一份脱敏简历 | 用户点击后可上传字段和附件，重复点击不重复建档 |

验证失败只影响对应适配器，不暂停主开发线。

---

## 15. 开发准备与不阻塞项

### 15.1 脚手架前确认

- [x] 前后端技术栈：React 18 + Vite + TypeScript / Node.js 22 + NestJS + Prisma（2026-11-11 确认）
- [x] Git 仓库地址、默认分支、代码评审和 CI 平台（2026-11-11 确认，见 15.3）
- [x] `d:/hr` 作为唯一开发目录（2026-11-11 确认）；`e:/zhaopin` 不存在，已废弃。
- [x] 本地 MySQL、Redis 服务已启动（2026-11-11 实测）；Redis `127.0.0.1` 返回 `PONG`，MySQL 服务 `Running`，连接待凭据验证

### 15.2 不阻塞主开发线

- AI 具体模型、密钥和听记能力：先 Mock。
- 钉钉应用权限与回调域名：先 Mock。
- BOSS/猎聘真实适配器：先 fixtures + Mock。
- 插件签名和企业分发：上线前确定。
- 数据保留具体期限：先配置化。
- 招聘周期按功能需求 §4.2 的自然日差计算，同日计 1 天；修改仅限关闭前并留痕，回退保留历次关闭/周期记录；本期已关闭存量不补录、不纳入周期统计。提供在招时长列表，不做超时预警。
- 周期报表保留部门/招聘负责人/时间段/需求类型，支持用户自定义组合维度；按功能需求 §4.2，仅招聘需求 / HC 列表提供周期区间筛选与周期排序，职位列表不提供周期筛选，需求详情展示周期及相关时间。
- 邮箱附件按功能需求 §3.1 处理：多个关联招聘邮箱、手工选目标职位、格式分流、无附件不建简历、重复合并/跳过、解析失败转人工。
- 需求同步与人事修改保存在同一记录，保留 OA 引用和编辑留痕。
- Offer 按 PRD §4.2 六阶段及子状态建模；不通过/拒绝归档须保存发生阶段、结果及原因。集 A 企业淘汰/归档、集 B 候选人拒绝、集 C 放弃入职独立配置和统计，各含「其他·可填写」及说明，默认初稿见 PRD §3.2。
- 内推本期仅保留推荐人/来源标识及合并后的来源关联；不建内推门户、不判定有效推荐、不自动结算。

### 15.3 仓库与 CI 基线（已与 `AGENTS.md` 对齐）

| 项 | 约定 |
|---|---|
| 仓库 | `https://github.com/kirin170/hr.git` |
| 唯一开发目录 | `d:/hr` |
| 发布分支 | `master`（受保护，禁止直接提交或推送） |
| 开发分支 | 共享 `dev` 分支（开发前 `git switch dev && git pull --ff-only origin dev`，禁止 force-push 或改写历史） |
| 合并方式 | Pull Request：`dev` → `master`；至少 1 人评审；两项状态检查（`quality`、`secret-scan`）通过后由仓库所有者合并 |
| CI 平台 | **GitHub Actions**（仓库托管于 GitHub） |
| CI 必跑 | 类型检查、Lint、单元/接口测试、前后端构建（扩展纳入后补扩展构建）、Prisma migration 校验、密钥扫描 |
| 版本标签 | 发布使用 `v<主>.<次>.<修订>` 标签，与文档版本区分 |

CI 工作流文件位置：`.github/workflows/ci.yml`。分支保护规则在 GitHub 仓库设置中启用，要求状态检查通过后方可合并。

---

## 16. 开发启动检查清单

截至 2026-11-21 基线状态（已完成脚手架与早期主链交付）：

- [x] 前后端技术栈已确认并冻结。
- [x] 仓库与目录唯一：`d:/hr` 为唯一开发目录，PRD 历史路径已清理。
- [x] Node.js 22 与依赖安装方式统一（v22.20.0 / npm 10.9.3）。
- [x] API、Worker、Web 的目录和启动方式确定。
- [x] 本机 MySQL/Redis 服务已启动并完成隔离临时库迁移验证。
- [x] GitHub Actions CI 工作流已提交；`master` 分支保护已启用，要求 `quality`、`secret-scan` 通过及至少 1 人 PR 评审，并对管理员生效（2026-11-16）。
- [x] Prisma Schema 与已提交迁移覆盖当前核心实体（见 `backend/prisma/schema.prisma`）。
- [x] 状态机、三维权限、审计与附件生命周期模块归属明确并已交付（`ATS-004/005/007/008/009/010/012/017/022`）。
- [x] AI、钉钉 OA、邮箱 Mock 接口及部分正式适配器（钉钉组织同步、IMAP 邮箱）已落地。
- [x] `backend/.env.example` 含本地占位值且不含真实密钥。
- [x] CI 配置执行类型检查、Lint、单元/API 测试、构建、迁移与密钥扫描。
- [ ] 业务验收人及脱敏测试样本已指定（上线验收 `ATS-025` 前落实）。
