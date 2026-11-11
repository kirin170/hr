# 招聘系统 PRD（开发落地版）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 编写日期 | 2026-11-10 |
| 最近修订 | 2026-11-11：合并功能需求 v1.2；新增招聘需求 OA 同步与招聘周期、人才库 1w+ 展示、邮箱附件导入 |
| 需求基线 | 2026-11-10 已确认业务事实 + 《招聘系统功能需求文档 v1.2》 |
| 适用读者 | 研发、测试、实施 |
| 需求编号规则 | FR-<模块>-<序号>；NFR-<序号>（非功能） |

---

## 1. 系统上下文与部署约束

- **部署**：阿里云、单租户（无租户维度）、自有服务器；招聘门户公网域名 + HTTPS；钉钉回调需公网可达
- **外部系统**：钉钉开放平台（唯一业务系统集成，6 类用途，见 §7）
- **浏览器插件**：Chrome/Edge Manifest V3，面向 BOSS 直聘/猎聘简历页，由 HR 主动触发当前简历导入；不属于第三方平台官方业务系统集成，不做后台批量抓取
- **存储**：业务库 RDS MySQL；附件 OSS 私有读 + 临时签名 URL（支持视频/图片/PDF/Word，含大文件）；日志 SLS 留存
- **现有资产**：原型 `TalentFlow`（`d:/hr/src`，React 18 + Vite + TS，纯前端 mock），在本原型基础上演进，需先完成数据模型重构（§3 与原型 `types.ts` 的差异见 §3.4）

---

## 2. 角色与权限矩阵

角色来源：钉钉组织架构同步；身份识别用于代填标识等场景。

### 2.1 角色 × 模块权限（✓ 可用 / ✓r 限本人相关数据 / — 不可见）

| 模块 | 招聘HR | 职位招聘负责人 | 用人经理 | 面试官 | 人事经理/主管 | HRD | 管理员 |
|---|---|---|---|---|---|---|---|
| 工作台 | ✓ | ✓ | ✓r | ✓r | — | ✓ | ✓ |
| 职位管理 | ✓ | ✓（本人职位可编辑招聘要求） | ✓r 本部门 | — | — | ✓ | ✓ |
| 候选人管理 | ✓ | ✓r 本人职位 | ✓r 本部门/参与筛选 | ✓r 参与面试 | — | ✓ | ✓ |
| 浏览器插件导入 | ✓（独立授权） | — | — | — | — | — | ✓ |
| 面试管理 | ✓ | ✓r | ✓r | ✓r | — | ✓ | ✓ |
| Offer 状态跟踪 | ✓ | ✓r | — | — | —（在钉钉OA审批） | ✓ | ✓ |
| 背调/流水材料 | ✓（独立授权） | — | — | — | — | ✓ | ✓ |
| 人才库 | ✓ | ✓ | ✓r | — | — | ✓ | ✓ |
| 报表中心 | ✓ | ✓r | ✓r 本部门 | — | — | ✓ | ✓ |
| 设置 | — | — | — | — | — | — | ✓ |

### 2.2 字段级权限（硬性规则）

| 规则 | 编号 |
|---|---|
| 系统不存薪资明细/定薪数据；仅存「OA 审批通过 / 薪资已返回」状态与谈薪结果（接受/拒绝/原因） | SEC-F1 |
| 部分招聘 HR、所有用人经理、所有面试官无权知晓薪资相关信息；同角色内按用户/用户组区分可见性 | SEC-F2 |
| 背调材料、银行流水附件：独立访问授权 + 访问日志 + 保留期限 + 到期删除 | SEC-F3 |
| 字段级权限模型支持到用户/用户组级，本期仅对敏感字段启用（背调材料、流水、联系方式） | SEC-F4 |

---

## 3. 数据模型

### 3.1 实体总览

```
User / Department（钉钉同步）
Job（职位） / JobRequisition（招聘需求 HC）
Candidate（候选人） / ResumeFile（简历附件） / CandidateIntent（个人意愿）
BrowserImportTask（浏览器插件导入任务）
DeptScreeningRecord（用人部门筛选记录）
Interview（面试） / InterviewFeedback（评价） / InterviewRegistrationForm（面试登记表） / TranscriptLink（听记链接）
OfferRecord（offer 状态跟踪） / BackgroundCheckMaterial（背调与流水材料）
ProbationRecord（试用期）
TalentPoolEntry（人才库） / ReasonOption（原因选项） / Tag（标签）
AIRun（AI 任务与结果草稿）
NotificationTask（通知） / TimelineEvent（时间线/操作记录）
MailInboxConfig（接收简历邮箱）
```

### 3.2 核心实体字段

**Job（职位）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id / code | string | code 自动生成（如 MJ000005） |
| title / departmentId / location | | |
| recruiterId | ref User | 招聘负责人（负责人唯一来源） |
| requirements | text | **招聘要求**（招聘负责人导入维护；AI 评估共同输入；空则 AI 评估不可用） |
| headcount / hiredCount | int | |
| status | enum | `active` / `closed` |
| interviewPlanId | ref | 面试方案（职位级） |
| sources | string[] | 招聘渠道字典多选 |
| isVirtual | bool | 虚拟职位标记（校招容器） |
| requisitionId | ref, nullable | 关联招聘需求；仅用于追溯，不参与招聘周期计算 |

**JobRequisition（招聘需求 / HC）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id / oaApprovalId | string | `oaApprovalId` 唯一，用于钉钉 OA 回调幂等 |
| title / departmentId / jobLevel / headcount | | 需求标题、部门、录用职级、招聘人数 |
| source | enum | 本期固定 `DINGTALK_OA` |
| status | enum | `ACTIVE`（招聘中）/ `CLOSED`（已关闭） |
| submittedAt | datetime | **需求提报时间**；OA 审批通过时间，只读，仅记录 |
| recruitmentStartDate | date | **开始招聘时间**；生成需求时必填，允许修改，不提供空白补录 |
| closedAt | datetime, nullable | **关闭时间**；仅手动关闭时由系统写入 |
| cycleDays | int, nullable | **招聘周期（天）**；关闭后计算，只读 |
| version | int | 乐观锁；关闭、回退、修改开始时间需并发保护 |
| createdAt / updatedAt | datetime | |

> 招聘周期是**需求级**指标：`cycleDays = closedAt - recruitmentStartDate`（自然日，精确到日）。不按职位拆分，职位变更不影响已计算周期。同日边界与历史保留规则见 §11。

**Candidate（候选人）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id / name / phone / email | | |
| jobId | ref, nullable | null 且 poolType=UNASSIGNED → 待分配池；null 且 poolType=VIRTUAL → 虚拟职位 |
| poolType | enum | `NONE` / `UNASSIGNED` / `VIRTUAL` |
| stage | enum | 见 §4.1 |
| source | string | 业务来源（招聘网站/校招/内推/邮箱/上传/手工） |
| entryMode | string | 进入方式（邮箱自动获取/浏览器插件导入/批量上传/单个上传/手工录入/投递）——与 source 两个维度；插件导入固定 key 为 `BROWSER_EXTENSION` |
| browserImportTaskId | ref, nullable | 插件导入时关联 BrowserImportTask，用于来源追踪与失败重试 |
| intentId | ref | 个人意愿（校招投递时填写，仅简历字段） |
| tags / rating | | |
| archiveReasonId | ref, nullable | 选填 |
| lockedState | enum | `NONE` / `OPERABLE` / `INOPERABLE` |
| parsedProfileId | ref AIRun | 解析草稿确认后的结构化档案 |
| appliedAt / updatedAt | | |

**Interview（面试）**

| 字段 | 类型 | 说明 |
|---|---|---|
| candidateId / jobId / round / mode | | mode: `onsite` / `video` / `phone`（本期无内置视频面试，video 仅记链接） |
| time / location | | |
| interviewerIds | ref[] | 多人 |
| status | enum | `TO_SCHEDULE` / `FEEDBACK_PENDING` / `COMPLETED` / `CANCELLED` |
| calendarEventId | string | 钉钉日程 ID（见 §7.2） |
| cancelReason | string | 改期/取消必填 |

**InterviewFeedback（评价）**

| 字段 | 说明 |
|---|---|
| interviewId / interviewerId | |
| filledById + filledByMode | `SELF` / `PROXY`（代填） |
| proxyName / proxyAt | 代填人、代填时间（钉钉身份自动识别，写入操作记录） |
| content | 结构化评价表（按职位面试方案配置） |
| aiSuggestionRunId | ref AIRun（听记评估建议，草稿） |
| visibleToInterviewers | true（面试官可互看评价） |

**InterviewRegistrationForm（面试登记表）**：候选人面试开始前填写；字段集可配置（§9 设置）；用于 OA 审批材料。

**OfferRecord（offer 状态跟踪，一人一条，随阶段推进更新）**

| 字段 | 类型 | 说明 |
|---|---|---|
| candidateId / jobId | | |
| stage | enum | 见 §4.2 |
| oaApprovalId | string | 钉钉 OA 审批单号（人工回填为主） |
| oralResult | enum | `ACCEPTED` / `REJECTED` |
| rejectReasonId | ref | 拒绝原因（必填，独立选项集） |
| backgroundCheckStatus | enum | `PENDING` / `CONFIRMED_OK` / `CONFIRMED_FAILED` |
| materials | ref[] | 背调与流水材料（视频/图片/PDF/Word，OSS 私有读） |
| onboardDate | date | 入职时间 |
| offerSentAt | datetime | 书面 offer「已发送」节点（HR 手工标记） |

**ProbationRecord**：candidateId、converted(bool)、convertedAt。只统计是否转正。

**TalentPoolEntry**：candidateId、archivedAt、sourceStage、reasonId（选填）、reactivatedJobId（激活回流目标职位）。

**ReasonOption**：type 枚举 `ARCHIVE` / `OFFER_REJECT` / `ONBOARD_ABANDON` 三套独立选项集，分开配置、分开统计，不得混用。

**AIRun（统一 AI 服务任务）**

| 字段 | 说明 |
|---|---|
| type | `RESUME_PARSE` / `RESUME_EVAL` / `INTERVIEW_EVAL` |
| inputRefs | 附件/简历文本/听记转写/jobId（→ job.requirements） |
| output | JSON Schema 约束的结构化结果（见 §6.2） |
| status | `PENDING` / `RUNNING` / `SUCCESS` / `FAILED` |
| isDraft / confirmedBy / confirmedAt | AI 草稿标记与人工确认 |
| confidence | 字段级置信度（解析场景，低置信度标黄） |

**BrowserImportTask（浏览器插件导入任务，一次用户确认一条）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id / requestId | string | requestId 由扩展在点击时生成，唯一约束；网络重试沿用同一值，保证接口幂等 |
| operatorId | ref User | 当前授权招聘 HR；从本系统令牌识别，不信任扩展自报身份 |
| sourceSite | enum | `BOSS_ZHIPIN` / `LIEPIN`；适配器白名单 |
| sourceCandidateId | string, nullable | 平台候选人 ID（可获取时保存），不可获取则依赖附件与联系方式查重 |
| sourcePageUrl | string | 仅保留定位所需路径；入库前剥离 query/fragment 中的 token、签名等敏感参数 |
| targetJobId | ref, nullable | 用户选择职位则进入 RECOMMENDED；为空则进入 UNASSIGNED |
| pagePayload | JSON | 当前页提取的招聘字段草稿，不含聊天、Cookie、账号凭据等无关数据 |
| resumeFileId / fileHash | ref / string | 原始附件及 SHA-256；用于查重与审计 |
| status | enum | `RECEIVED` / `PARSING` / `SUCCESS` / `DUPLICATE` / `FAILED` |
| candidateId | ref, nullable | 新建或命中的候选人 |
| errorCode / errorMessage | string | `AUTH_EXPIRED` / `ADAPTER_MISMATCH` / `ATTACHMENT_UNAVAILABLE` / `PARSE_FAILED` 等 |
| createdAt / completedAt | datetime | 处理时延与审计 |

### 3.3 枚举定义（开发稳定 key，中文显示名可配）

见 §4 状态机。

### 3.4 原型迁移映射（`d:/hr/src/types.ts` → 本模型）

| 原型 | 新模型 | 动作 |
|---|---|---|
| `CandidateStage`: new/screening/interview/offer/hired/rejected | §4.1 九阶段 + poolType | 重构 |
| `Candidate.jobId` 必填 | jobId nullable + poolType | 放宽 |
| `Job` | 增加 requirements / isVirtual / code / requisitionId | 扩展 |
| — | JobRequisition（OA 同步、开始/关闭时间、招聘周期） | 新增 |
| `Interview.feedback: string` | 独立 InterviewFeedback 实体（代填/互看/AI 建议） | 拆分 |
| `Approval` | 移除自建审批，改 OfferRecord + 钉钉 OA 单号 | 替换 |
| `ProbationEmployee` | ProbationRecord（只统计是否转正，删 score/checkins/goalProgress） | 简化 |
| — | ResumeFile / AIRun / BackgroundCheckMaterial / ReasonOption / TalentPoolEntry / TimelineEvent / BrowserImportTask | 新增 |

### 3.5 关键数据规则

- 候选人必须挂职位才能进入主链（待分配池/虚拟职位例外）；分配动作只选职位，recruiter 由职位带出
- 简历查重命中 → 提示合并；合并保留全部来源与附件
- 插件导入按 `requestId` 保证请求幂等；再按平台候选人 ID、附件 SHA-256、规范化手机号/邮箱查重。命中后不得直接新建候选人，由 HR 选择更新或取消
- 插件导入复用统一 AI 解析管道与草稿确认规则；`targetJobId` 为空进入待分配池，否则进入人才推荐，均写时间线
- 第三方平台密码、Cookie、会话令牌不得入库或进入日志；`sourcePageUrl` 必须脱敏，临时签名附件 URL 不得作为长期附件地址保存
- 招聘需求以 `oaApprovalId` 幂等落库；审批通过时间写 `submittedAt`，只读且不参与周期计算
- `recruitmentStartDate` 在生成需求时必填，系统不提供空白记录的事后补录；`closedAt` 仅由手动关闭动作写入
- `cycleDays` 为派生只读字段，不允许手工编辑；关闭时间早于开始时间拒绝保存
- 关闭 → 回退招聘中：清空 `closedAt` 与 `cycleDays`，时间线保留上一次关闭记录；重新关闭按最新时间重算
- 人才库不设容量上限；「1w+」是展示规则，不是数据库约束，后台分页与索引不得依赖该展示值
- 邮箱附件导入职位时，职位匹配规则未确认前不得自动挂载到具体职位，默认进入待分配池（见 §11）
- 时间线（TimelineEvent）记录所有状态流转与自动动作，可追溯、可导出（审计要求）

---

## 4. 状态机

### 4.1 候选人主状态机

```
UNASSIGNED(待分配池) ──分配职位──┐
VIRTUAL_POOL(虚拟职位) ─分配职位─┤
投递带职位 ─────────────────────┴→ RECOMMENDED(人才推荐)
  → HR_SCREENING(初筛) → DEPT_SCREENING(用人部门筛选) → INTERVIEWING(面试)
  → OFFERING(沟通offer) → PENDING_ONBOARD(待入职) → ONBOARDED(已入职)
  → PROBATION(试用期, 终态含是否转正) → ENDED(结束)
任意阶段 → ARCHIVED(已归档, 原因选填) → 可激活回流 RECOMMENDED
```

| 流转 | 条件 | 编号 |
|---|---|---|
| UNASSIGNED/VIRTUAL_POOL → RECOMMENDED | 人事分配职位（只选职位） | ST-1 |
| 面试 → 沟通offer | **人工跳转，禁止自动流转** | ST-2 |
| 沟通offer → 待入职 | 入职时间已确定 且 offerSentAt 已标记 | ST-3 |
| 待入职 → 已入职 | 人事点「确认入职」（显式动作触发自动归类） | ST-4 |
| 待入职 → 已归档 | 「放弃入职」+ 必填原因 | ST-5 |
| 背调确认有问题 → 已归档 | 终止录用 | ST-6 |
| 通用 | 显式动作 + 必填校验 + 可撤销；禁止静默改状态；自动动作写时间线 | ST-0 |

### 4.2 Offer 子状态机（挂在 OFFERING 阶段内）

```
MATERIAL_PENDING(待汇总材料) → OA_PENDING(OA审批中)
→ SALARY_RETURNED(薪资已返回·待谈薪) → NEGOTIATING(电话谈薪中)
→ ORAL_ACCEPTED(口头已接受) / ORAL_REJECTED(已拒绝, 必填原因)
ORAL_ACCEPTED → BG_IN_PROGRESS(背调与流水补充中)
→ BG_CONFIRMED(背调确认·无问题) / BG_FAILED(背调确认·有问题 → 终止录用归档)
BG_CONFIRMED → OFFER_TO_SEND(待发书面offer: 定入职时间)
→ OFFER_SENT(已发送, HR标记) → [ST-3] 进入待入职
```

- 状态由人事**手工回填**为主，不强制接 OA 回调（回调同步为可选增强）
- OA 审批被拒：OA_PENDING → ORAL_REJECTED 等价终态（归档，原因走 offer 拒绝选项集）

### 4.3 子状态

- 用人部门筛选：`PASS` / `HOLD` / `REJECT`；**任一 1 人 PASS 即推进**；HOLD 无超时出口、人工调整；PASS 时必附可约面时间（结构化，可被面试排期读取）+ 筛选原因
- 面试：`TO_SCHEDULE` / `FEEDBACK_PENDING` / `COMPLETED` / `CANCELLED`
- 面试日程（独立于候选人主状态机）：`NEEDS_ACTION` / `ACCEPTED` / `DECLINED` / `TENTATIVE`（同步钉钉 responseStatus）；DECLINED → HR 改期重新邀约

### 4.4 招聘需求状态机

```text
钉钉 OA 审批通过
   → ACTIVE（生成需求，submittedAt 只读；人事必填 recruitmentStartDate）
   → 手动关闭 → CLOSED（写 closedAt，计算 cycleDays）
   → 回退招聘中 → ACTIVE（清空 closedAt/cycleDays，历史保留在时间线）
```

| 流转 | 条件 | 编号 |
|---|---|---|
| OA 审批通过 → ACTIVE | `oaApprovalId` 未落库；审批通过时间有效 | REQ-1 |
| ACTIVE → CLOSED | 人事显式关闭；`closedAt >= recruitmentStartDate` | REQ-2 |
| CLOSED → ACTIVE | 显式回退；清空关闭字段并写时间线 | REQ-3 |
| 修改开始招聘时间 | 需求存在且允许编辑；重算进行中天数 | REQ-4 |
| 通用 | 周期字段只读；所有变更写时间线 | REQ-0 |

> 招聘需求审批在钉钉 OA 完成，本系统不自建审批流；OA 回调失败时支持人工触发同步，不重复生成需求。

---

## 5. 功能需求明细

### 5.1 简历入场（FR-ENT）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-ENT-1 | 邮箱自动获取：按 MailInboxConfig 轮询收信，**自动抓取邮件中的简历附件**；附件入库并触发解析，可导入相应职位，未确认职位匹配规则前默认进入待分配池 | 收信 → 附件保存 → 创建 ResumeFile → 触发 AI 解析 → 默认 UNASSIGNED；职位匹配方式见 §11 |
| FR-ENT-2 | 投递带职位（门户/内推/校招）直接创建 RECOMMENDED 候选人 | jobId 非空 |
| FR-ENT-3 | 批量上传 / 单个上传 / 手工录入 | 支持多文件；手工录入表单完整字段 |
| FR-ENT-4 | Excel 表格批量导入（独立于解析链路，一行一候选人） | 模板下载、校验报告、失败行可导出 |
| FR-ENT-5 | 待分配池 / 虚拟职位双容器列表，人事分配职位（只选职位） | 分配后 poolType=NONE、recruider 带出、写时间线 |
| FR-ENT-6 | 校招投递填个人意愿表单（简历字段，分配后不覆盖） | intentId 保存，分配不改写 |
| FR-ENT-7 | 简历查重与合并提示 | 命中提示；合并保留全部来源与附件 |
| FR-ENT-8 | 简历监控页：总量 / 进入系统 / 未进入，未进入可归因（解析失败/格式不支持/重复） | 列表含渠道、接收邮箱、接收时间、处理时延、去向 |
| FR-ENT-9 | 浏览器插件导入复用统一入场、查重、解析与分配规则，详见 FR-EXT | 与手工上传走同一解析及草稿确认链路；entryMode 标记为浏览器插件导入 |
| FR-ENT-10 | 邮箱附件简历可导入相应职位（v1.1） | 附件抓取后可选择/匹配职位；匹配规则确认前禁止自动挂载，默认待分配池；导入与查重、解析链路一致 |

### 5.2 职位与 HC（FR-JOB）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-JOB-1 | 职位/招聘需求双 Tab；职位编号自动生成 | 格式 MJ%06d |
| FR-JOB-2 | 职位 CRUD + 筛选（编号/部门/渠道/负责人/简历更新时间） | |
| FR-JOB-3 | 招聘要求字段：仅招聘负责人可编辑；为空时 AI 评估入口禁用并提示补录 | SEC 校验 + UI 提示 |
| FR-JOB-4 | HC 审批与职位发布分离；HC 满员提示关闭职位 | 提示不自动关闭 |
| FR-JOB-5 | 职位关闭不影响在流程候选人 | 仅停止新简历进入 |
| FR-JOB-6 | 虚拟职位类型（校招容器） | isVirtual=true，不出现在普通职位筛选默认集 |

#### 5.2.1 招聘需求与周期（FR-REQ，v1.1）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-REQ-1 | 钉钉 OA 招聘需求审批通过后同步生成本系统招聘需求 | 按 oaApprovalId 幂等；带出 submittedAt 只读；回调失败可人工同步且不重复生成 |
| FR-REQ-2 | 生成需求时必须填写 recruitmentStartDate | 空白不可保存；不提供事后空白补录；允许修改已有值 |
| FR-REQ-3 | 招聘需求列表展示需求提报时间、开始招聘时间、关闭时间、招聘周期 | 周期列可排序；周期区间在**招聘需求列表**筛选；需求提报时间放详情或可选列 |
| FR-REQ-4 | 手动关闭写入 closedAt 并计算 cycleDays | 关闭时间早于开始时间拒绝保存；HC 满员只提示不自动关闭 |
| FR-REQ-5 | 周期字段只读、系统计算 | `cycleDays = closedAt - recruitmentStartDate`，自然日、精确到日；不可手工编辑 |
| FR-REQ-6 | 关闭 → 招聘中回退 | 清空 closedAt/cycleDays；重新关闭按最新时间重算；历史写入时间线 |
| FR-REQ-7 | 未关闭需求显示「进行中 · 已 N 天」 | N = 当天 - 开始招聘时间；不计入周期汇总 |
| FR-REQ-8 | 需求内容优化留痕 | 生成/修改/关闭/回退/开始时间变更均写时间线；变更记录形态见 §11 |
| FR-REQ-9 | 需求与职位关联仅用于追溯 | Job.requisitionId 可空；职位变更不影响已算周期；周期不按职位拆分 |

### 5.3 候选人管理（FR-CAND）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-CAND-1 | 阶段 Tab（待分配 + 9 主链 + 已归档）实时计数；左侧职位分组树 | |
| FR-CAND-2 | 筛选（公司/职位/渠道/来源/标签/锁定/超时未处理），可保存筛选条件 | |
| FR-CAND-3 | 列表行：申请时间、职位、渠道、姓名/性别/年龄/年限、当前公司+职位、学校/学历、标签、AI 评估信号 | |
| FR-CAND-4 | 批量操作：筛选结论、转阶段、打标签、查状态 | |
| FR-CAND-5 | 初筛淘汰原因**选填** | 空值不阻断；报表单列「未填写」 |
| FR-CAND-6 | 用人部门筛选：多筛选人、三态结论、任一 PASS 即推进；PASS 附结构化可约面时间 | 时间可被 FR-INT-1 读取预填 |
| FR-CAND-7 | 候选人锁定（可操作/不可操作） | |
| FR-CAND-8 | 候选人详情：档案、时间线、附件、阶段动作、可撤销 | 撤销后状态回滚并写时间线 |

### 5.4 面试管理（FR-INT）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-INT-1 | 面试创建：多轮多人、预读筛选通过时的可约面时间 | |
| FR-INT-2 | 钉钉日历排期（§7.2）：创建日程邀请面试官；创建≠占用；接受后占用；DECLINED 提示 HR 改期 | 同步 responseStatus 展示 |
| FR-INT-3 | 忙闲冲突只提示（获取用户忙闲接口），不自动避让 | 提示不阻断 |
| FR-INT-4 | 改期/取消必填原因，通知全部相关方（内部钉钉） | |
| FR-INT-5 | 评价提醒：面试结束半小时自动提醒面试官（钉钉）；人事可催促 | 定时任务 |
| FR-INT-6 | 代填写：人事代填带 `PROXY` 标识 + 代填人 + 代填时间（钉钉身份自动识别），写操作记录 | |
| FR-INT-7 | 面试官可互看评价（同职位/同候选人面试记录） | |
| FR-INT-8 | 听记链接：按轮次存 URL，不覆盖；触发 INTERVIEW_EVAL AI 任务 | |
| FR-INT-9 | 面试评价通过/不通过**不自动流转**（ST-2） | 无任何自动转阶段逻辑 |
| FR-INT-10 | 面试登记表：候选人面试前填写；字段可配置 | |
| FR-INT-11 | 面试列表三段分组（今天/明天及以后/昨天及以前）+ 筛选 + 导出 | |

### 5.5 Offer 跟踪（FR-OFR）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-OFR-1 | Offer 阶段状态跟踪（§4.2 全链），人事手工回填 | 每次变更写时间线 |
| FR-OFR-2 | OA 审批发起辅助：材料 3 项（简历信息、面试登记表信息、录用职级）；无「面试评级」；AI 建议不进审批单 | 材料组装预览 |
| FR-OFR-3 | oaApprovalId 回填与状态展示（手工为主，回调可选） | |
| FR-OFR-4 | 口头拒绝必填原因（OFFER_REJECT 选项集） | |
| FR-OFR-5 | 背调与流水材料上传（视频/图片/PDF/Word）、私有读、独立授权（SEC-F3） | 签名 URL 有效期；访问日志 |
| FR-OFR-6 | 背调确认二态：无问题 → 定入职时间；有问题 → 终止录用归档 | |
| FR-OFR-7 | 书面 offer「已发送」标记（只记节点与时间，不生成不发送文件） | 预留扩展点（接口占位） |
| FR-OFR-8 | 不存薪资明细：仅「薪资已返回」状态与谈薪结果 | 库表无薪资字段 |

### 5.6 待入职/已入职/试用期（FR-ONB）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-ONB-1 | 进入待入职双条件：onboardDate 已填 且 offerSentAt 已标 | |
| FR-ONB-2 | 保温提醒：定时提醒人事跟进（钉钉），不触达候选人；入职时间改期后提醒基准更新 | |
| FR-ONB-3 | 确认入职 → 自动归类已入职；回写 job.hiredCount | 显式动作 |
| FR-ONB-4 | 放弃入职必填原因（ONBOARD_ABANDON 选项集）→ 归档 | |
| FR-ONB-5 | 试用期：记录是否转正 + 转正时间；不做考勤/薪酬/绩效 | |
| FR-ONB-6 | 不采集入职信息、无花名册/薪资/社保档案 | 无相关表单与接口 |

### 5.7 人才库（FR-POOL）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-POOL-1 | 归档候选人自动入池；可检索、标签 | |
| FR-POOL-2 | 归档原因分析报表（含「未填写」档） | |
| FR-POOL-3 | 激活回流：选择目标职位 → 回到 RECOMMENDED，保留历史时间线 | |
| FR-POOL-4 | **不设人才库容量上限**（v1.1 取消原 10000 人上限） | 后端与 UI 均不得再以 10000 人作为阻断条件 |
| FR-POOL-5 | 总量展示规则：达到 1 万及以上统一显示「1w+」，不显示实际总量 | 阈值与适用范围（人才库 / 候选人阶段 Tab / 报表）见 §11；后端仍需分页与索引 |
| FR-POOL-6 | 不做基于容量的实时总数据量呈现 | 避免全表 count；列表按筛选分页查询 |

### 5.8 内推（FR-REF）

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-REF-1 | 内推门户：职位同步、员工分享链接、候选人免登录投递 | 投递带职位直入流程 |
| FR-REF-2 | 内推标识 + 推荐人关联 | |
| FR-REF-3 | 推荐人查进度（脱敏口径） | |
| FR-REF-4 | 奖励：本期仅记录推荐与结果，不自动结算（有效推荐定义待确认） | |

### 5.9 通知（FR-NTF）——本期内置事件清单

| 编号 | 事件 | 触达 | 时机 |
|---|---|---|---|
| FR-NTF-1 | 面试日程邀请/改期/取消 | 面试官（钉钉） | 日程创建/变更 |
| FR-NTF-2 | 面试开始提醒 | 面试官 | 面试前（如提前 1h，可配） |
| FR-NTF-3 | 填写评价提醒 | 面试官 | 面试结束后 30 分钟 |
| FR-NTF-4 | 评价催促 | 面试官 | 人事手动触发 |
| FR-NTF-5 | 长时间未处理简历提醒 | 候选人 owner/招聘负责人 | 超时可配 |
| FR-NTF-6 | 保温提醒 | 人事 | 待入职期间周期性，基准=onboardDate |
| FR-NTF-7 | OA 审批待办 | 人事经理/人事主管 | 钉钉原生待办 |
| FR-NTF-8 | 招聘需求审批待办（v1.1） | 需求审批人 | 钉钉 OA 原生待办；本系统只接收审批结果 |
| FR-NTF-9 | 候选人侧触达：**一律不做**（无邮件/短信申请） | — | — |

规则实现为「事件 → 固定规则 → 钉钉渠道」的内置清单，本期不做可配置规则引擎；允许用户级关闭低优先级通知。

### 5.10 报表（FR-RPT）

| 编号 | 报表 | 要点 |
|---|---|---|
| FR-RPT-1 | 招聘漏斗 | 各阶段数量/转化率，可下钻 |
| FR-RPT-2 | 渠道质量 | 按 source 维度 |
| FR-RPT-3 | 招聘周期/效率 | 口径已定义：`关闭时间 - 开始招聘时间`，自然日、精确到日；需求提报时间仅记录；页面必须标注 |
| FR-RPT-4 | 三类原因分析 | ARCHIVE（含未填写）/ OFFER_REJECT / ONBOARD_ABANDON 独立统计 |
| FR-RPT-5 | 试用期转正率 | |
| FR-RPT-6 | 职位 360 | 进展、HC 详情 |
| FR-RPT-7 | 所有指标可下钻到明细 | 候选人指标下钻候选人，招聘周期下钻招聘需求；不可下钻的指标不得上线 |
| FR-RPT-8 | 招聘周期按需求级聚合（v1.1） | 按部门/招聘负责人/时间段等聚合，**不按职位拆分**；输出平均/中位数/最长/最短；未关闭需求不计入汇总 |
| FR-RPT-9 | 报表数量展示规则（v1.1 待确认） | 是否与人才库一致使用「1w+」见 §11；未确认前报表保留精确值 |

### 5.11 工作台（FR-DSH）

待办卡片聚合：待分配简历数、待筛选、待安排面试、待评价（含代填）、背调待确认、待发书面 offer、待确认入职；今日指标；重要事项分类通知 + 全部已读。数字随权限与筛选变化。

### 5.12 浏览器插件导入（FR-EXT）

**链路**

```
BOSS/猎聘内容脚本（识别当前页 + 用户点击）
→ 扩展 Service Worker（本系统鉴权、上传、结果通知）
→ 招聘系统 Browser Import API（创建 BrowserImportTask）
→ OSS 私有附件 + 查重 + 统一 AI 解析
→ HR 确认草稿 → 指定职位 RECOMMENDED / 未指定 UNASSIGNED
```

**接口契约**

| 接口 | 约束 |
|---|---|
| `POST /api/imports/browser-extension` | HTTPS + 本系统短期令牌；`Idempotency-Key=requestId`；multipart 提交 sourceSite、sourceCandidateId?、脱敏 sourcePageUrl、targetJobId?、pagePayload、附件；返回 `202 { taskId, status }` |
| `GET /api/imports/browser-extension/{taskId}` | 仅任务所有者可查；返回状态、候选人 ID、查重结果及标准化 errorCode |
| 附件传输 | 优先由扩展将当前用户有权访问的文件字节直传本系统；不得把第三方 Cookie 交给后端代取，不持久化临时签名 URL |

| 编号 | 需求 | 验收要点 |
|---|---|---|
| FR-EXT-1 | Chrome/Edge MV3 扩展与本系统授权绑定 | 使用本系统短期令牌/刷新机制；扩展不采集第三方平台密码、Cookie、会话令牌 |
| FR-EXT-2 | 平台适配器与页面识别 | BOSS/猎聘分别实现适配器；Content Script 处理 SPA 路由与 DOM 变化；仅白名单域名注入 |
| FR-EXT-3 | 用户显式触发 | 打开页面仅提示可导入；点击并确认目标职位/待分配池后才上传；页面打开不得自动创建任务 |
| FR-EXT-4 | 页面字段提取 | 提取招聘所需字段到 pagePayload；字段缺失允许用户补充；不得读取聊天等无关内容 |
| FR-EXT-5 | 附件获取与上传 | 支持 PDF/Word/图片；附件不可用返回 ATTACHMENT_UNAVAILABLE，允许重试或转手工上传 |
| FR-EXT-6 | 幂等与查重 | 同一 requestId 重试不产生重复任务；平台 ID/文件哈希/联系方式命中时进入 DUPLICATE，不直接新建 |
| FR-EXT-7 | 入库与阶段 | 新候选人经统一解析和 HR 确认后入库；有 targetJobId → RECOMMENDED，无则 UNASSIGNED |
| FR-EXT-8 | 结果反馈 | 插件展示成功、重复、解析中、解析失败、附件不可用、登录失效、适配器失效；失败可安全重试 |
| FR-EXT-9 | 权限与审计 | 仅授权招聘 HR；记录操作人、平台、脱敏 URL、文件哈希、目标职位、时间与结果；日志不得含第三方凭据 |
| FR-EXT-10 | 安全边界 | 不静默导入、不遍历列表、不后台批量采集、不绕过验证码或访问限制；命中限制即停止并提示人工处理 |
| FR-EXT-11 | 适配器运维 | 适配器可独立启停、灰度与回滚；平台页面改版只影响对应适配器，不影响通用导入 API |

---

## 6. AI 服务需求（统一 AI 服务）

### 6.1 架构

一个模型底座 + 三套模板；鉴权、脱敏、日志、AI 草稿标记、人工确认、失败降级逻辑**三场景共用一套**。模型服务封装为**可替换的一层**（换模型不影响主流程）。模型选型优先钉钉/通义体系（需验证：JSON 结构化输出、多模态图片直读、钉钉 AI 听记 27 项开放能力在贵司版本可用性与智能模板自定义）——遗留#1。

### 6.2 三场景输入输出契约

| 场景 | 输入 | 输出（JSON Schema 约束） |
|---|---|---|
| RESUME_PARSE | 附件文本/图片 | 结构化档案草稿：姓名/电话/邮箱/学历/学校/工作经历[]/技能[]；字段级 confidence |
| RESUME_EVAL | 简历文本 + job.requirements | { verdict: 符合/不符合, score: 1–5, rationale: string, missingPoints: string[] } |
| INTERVIEW_EVAL | 听记转写（原文/摘要）+ 面试情况（轮次/职位/评价上下文）+ job.requirements | { suggestion: 建议录用/不建议/待定, rationale: string, evidence: [{quote, sourceRef}] }——evidence 可点回原文 |

### 6.3 责任边界（三场景统一，写死）

| 编号 | 规则 |
|---|---|
| AI-1 | 产出均为草稿（isDraft），标注 AI 生成；人工确认或编辑后方可参考 |
| AI-2 | 不进入 OA 审批结论、不自动流转、不替代录用决策 |
| AI-3 | 可解释（必须输出依据/缺失项）、可关闭（职位/系统级开关）、可人工复核 |
| AI-4 | 失败降级：解析失败→人工录入；评估失败→人工判断；不阻断主流程 |
| AI-5 | 无职位或 job.requirements 为空 → 评估类任务不可发起，提示补录 |
| AI-6 | 解析结果默认 HR 确认后转正式档案（高置信度直接落库为可选优化，遗留#5） |
| AI-7 | 听记只取转写素材；不使用钉钉听记内置智能纪要作为评估输出 |
| AI-8 | 偏见风险：评估输出须含依据与缺失项；匹配分仅作参考信号展示 |

### 6.4 解析管道

```
上传(PDF/Word/图片) → 文本提取（PDF/Word 抽文本；图片走多模态直读）
→ LLM 结构化解析（Schema 约束，低温度）→ 字段校验（电话格式/日期范围）
→ 低置信度字段标黄 → 草稿表单（HR 确认/修改）→ 转正式档案
失败 → 人工录入兜底；批量上传走异步队列（先入池为「解析中」，完成后回填）
```

本期解析范围：PDF / Word / 图片；Excel 走 FR-ENT-4 表格导入，不进此管道。

---

## 7. 钉钉集成需求

### 7.1 集成清单（6 类）

| 编号 | 类型 | 用途 |
|---|---|---|
| DT-1 | 消息通知/审批待办 | 工作通知卡片（FR-NTF 清单）、OA 审批待办 |
| DT-2 | 组织架构与身份 | 通讯录同步（User/Department）；userId 映射；填写人身份识别（代填标识） |
| DT-3 | 日历读写 | 面试日程创建/修改（attendees=面试官）、responseStatus 回读、忙闲查询（冲突提示） |
| DT-4 | 听记读取 | 凭权限取回转写原文/摘要 → INTERVIEW_EVAL 素材 |
| DT-5 | OA 录用审批 | 发起审批（材料 3 项）、审批人两级（人事经理→人事主管）、结果回填（手工为主，回调可选增强） |
| DT-6 | OA 招聘需求审批同步（v1.1） | 审批通过后按 oaApprovalId 幂等生成招聘需求，带出 submittedAt；不自建需求审批流 |

### 7.2 技术要点

- 需申请权限：通讯录只读、日历读写（Calendar.Event.Write/Read）、用户忙闲、听记读取、OA 审批发起与查询（含招聘需求审批实例与结果）、工作通知；具体 API 以开放平台最新文档为准，开发前出《钉钉集成技术设计》细化（含回调事件、错误处理、限流——注意每用户每天限建 100 个日程，校招批量排期需规避）
- 回调地址公网可达；审批状态同步失败不阻塞业务（录用审批由人事手工回填兜底，招聘需求支持人工触发同步）
- 招聘需求回调必须按 oaApprovalId 幂等；同一审批单重复回调不得生成多条需求，需求状态变更不得反向修改 OA 审批单
- `dingtalk userId ↔ 系统User` 一对一映射，通讯录变更（离职/转岗）需有同步策略

---

## 8. 非功能需求

| 编号 | 需求 |
|---|---|
| NFR-1 | 附件一律 OSS 私有读 + 临时签名 URL（明确有效期），禁止公开可读链接；含大文件（视频流水） |
| NFR-2 | 附件与结构化数据分别设生命周期删除策略（保留期限配置化，遗留：具体期限待业务定） |
| NFR-3 | 候选人数据访问日志留存（谁在何时看了哪份简历/附件），可导出，满足等保审计 |
| NFR-4 | 敏感材料（背调/流水）独立授权 + 访问日志 + 到期删除（SEC-F3） |
| NFR-5 | 候选人授权：语音听记、流水等个人敏感信息的采集需授权依据与范围说明 |
| NFR-6 | 操作记录（TimelineEvent）全量留存，可导出 |
| NFR-7 | 大列表性能：候选人/人才库列表分页与筛选承载万级数据；**不设 10000 容量上限**，不得以全表 count 支撑「总量」展示 |
| NFR-8 | 单租户：无租户维度；权限按「部门 × 角色 × 数据范围」三层 + 字段级 |
| NFR-9 | 插件权限最小化：host_permissions 仅含 BOSS/猎聘必要域名及本系统 API 域名，不申请「所有网站」；权限变更需重新评审 |
| NFR-10 | 插件与本系统通信全量 HTTPS；本系统令牌加密存储并支持过期、撤销；第三方凭据不得进入扩展存储、业务库或日志 |
| NFR-11 | 插件导入附件复用 OSS 私有读、生命周期与访问日志策略；上传限制（大小/类型）配置化，超限明确报错 |
| NFR-12 | 平台适配器版本化，支持灰度、远程停用与回滚；页面改版导致失败时不得阻断邮箱、手工上传等其他入场通道 |
| NFR-13 | 招聘需求 OA 同步幂等：`oaApprovalId` 唯一约束 + 事务写入；重复回调、并发回调不得产生重复需求 |
| NFR-14 | 「1w+」仅影响展示层，不改变查询、分页、权限与统计计算；阈值配置化 |

---

## 9. 设置项范围（本期）

| 分类 | 配置项 |
|---|---|
| 组织 | 用户/部门（钉钉同步）、角色、用户组 |
| 职位 | 职位字段、职能类型、级别、虚拟职位分配规则（保留配置位，本期不启用自动分配）、招聘要求维护入口 |
| 招聘需求 | 需求字段、OA 审批表单字段映射、招聘周期展示阈值（1w+）、开始/关闭时间编辑规则（待确认项先留配置位） |
| 候选人 | 字段管理（含个人意愿/意向岗位字段）、标准简历、申请表与**面试登记表**、重复候选人管理 |
| 面试 | 轮次、评价表/评价选项、面试方案（职位级）、结果规则 |
| 原因选项 | 三套独立选项集：归档原因 / offer 拒绝原因 / 放弃入职原因（含「未填写」档处理） |
| 分类 | 标签管理 |
| 渠道 | 接收简历邮箱配置、渠道字典（账号级后台抓取相关配置二期） |
| 浏览器插件 | 平台适配器开关与版本、域名白名单、默认入库位置、附件大小上限、可导入角色/用户组、令牌撤销 |
| 通知 | 内置事件清单的开关（用户级可关低优先级） |
| AI | 模型服务参数（可替换封装）、开关（职位级/系统级）、解析字段 Schema、置信度阈值 |
| 安全 | 访问控制、隐私协议、候选人授权、数据保留期限、操作记录导出 |

配置区分「默认开箱可用」与「后台高级可配」两层。

---

## 10. 开发顺序建议

1. **数据模型重构**：按 §3 重构 `types.ts` 与 store（含枚举、状态机骨架、时间线、BrowserImportTask、JobRequisition）
2. **入场链路与招聘需求**：上传/手工录入 + 解析管道（AI-RESUME_PARSE）+ 待分配池/虚拟职位 + 分配动作 + 通用 Browser Import API；招聘需求先以 Mock 审批回调打通创建、开始时间、关闭与周期计算
3. **主链阶段**：候选人管理 9 Tab + 初筛/用人部门筛选（三态/任一通过即推进）+ 状态机流转与撤销
4. **浏览器插件**：MV3 骨架与本系统授权 + BOSS/猎聘适配器 + 附件上传 + 查重反馈 + 审计日志；先灰度单平台，再扩第二平台
5. **面试**：面试 CRUD + 评价（代填/互看/催填）+ 钉钉日历集成（DT-3）
6. **Offer 与入职**：OfferRecord 状态跟踪 + 背调材料 + 待入职/确认/放弃 + 试用期
7. **钉钉其余集成**：通知（DT-1）、组织架构（DT-2）、OA 录用审批（DT-5）、OA 招聘需求同步（DT-6）、听记（DT-4）+ AI 评估两场景
8. **人才库/内推门户/报表/工作台/设置**

---

## 11. 遗留待确认（不阻塞 1–3 步开发）

| # | 事项 | 影响 |
|---|---|---|
| 1 | AI 模型选型与钉钉听记能力验证 | §6.1 封装层内部；接口契约已定 |
| 2 | Offer 状态中文命名 | 显示层，枚举 key 已定 |
| 3 | 三套原因选项集初始值 | 配置数据，先按默认初稿 |
| 4 | 内推有效推荐定义 | FR-REF-4 仅记录 |
| 5 | 解析高置信度直接落库 | AI-6 默认人工确认 |
| 6 | 其他报表指标口径（漏斗转化、渠道归因等；招聘周期口径已定义） | FR-RPT 上线前固化 |
| 7 | 数据保留期限具体值 | NFR-2 配置化，先留默认 |
| 8 | BOSS/猎聘页面结构、附件访问方式、平台服务条款及官方合作渠道评估 | 适配器开发前验证；不阻塞通用 Browser Import API 与数据模型 |
| 9 | 插件企业分发、浏览器白名单、签名、灰度与升级策略 | 上线前确定；开发期使用受控测试包 |

### 11.1 v1.2 新增待确认（来自功能需求 7.2 / 7.3）

下表为合并 v1.2 时尚未确认的业务口径。**已给出开发期默认处理，默认值不等于最终业务结论。**

| 编号 | 事项 | 开发期默认处理 | 阻塞范围 |
|---|---|---|---|
| Q1 | 人事优化招聘需求内容的记录形态 | 按编辑留痕实现：记录操作人、时间、变更前后，不新建需求副本 | 不阻塞模型；FR-REQ-8 验收前确认 |
| Q2 | 「1w+」适用范围与阈值 | 仅人才库总量使用；阈值 ≥10000；候选人阶段 Tab 与报表暂保留精确值 | 仅展示层，不阻塞 |
| Q3 | 邮箱附件简历「导入相应职位」的匹配方式 | **默认不自动匹配职位，进入待分配池**；由人事手工选择职位 | 阻塞 FR-ENT-10；不阻塞邮箱抓取 FR-ENT-1 |
| Q4 | 自然日边界（同日关闭 0 天或 1 天、是否含首尾） | 按日期差计算，同日关闭为 0 天 | 不阻塞模型；周期验收前确认 |
| Q5 | 开始招聘时间是否仅关闭前可改 | 默认仅 ACTIVE 状态可改；CLOSED 需先回退再改，变更写时间线 | 不阻塞模型；验收前确认 |
| Q6 | 回退后的历史周期是否保留 | 时间线保留每次关闭记录；业务表只保留当前周期 | 不阻塞 |
| Q7 | 已关闭存量需求是否补录时间 | 本期不做批量补录；存量记录周期显示「未记录」 | 不阻塞；上线数据准备前确认 |
| Q8 | 报表聚合维度、未关闭需求是否单独出列表 | 默认按部门/招聘负责人/时间段聚合；未关闭需求仅展示「进行中 · 已 N 天」，不单独出预警列表 | 不阻塞；报表开发前确认 |
| Q9 | 报表数量是否也按「1w+」脱敏 | 默认报表保留精确值；阈值配置化 | 不阻塞 |
| Q10 | 人才库后台是否仍需容量/查询阈值 | 不设业务容量上限；保留分页、索引与慢查询保护 | 不阻塞 |
| Q11 | 邮箱附件格式范围、异常处理、抓取邮箱范围 | 格式按 PDF/Word/图片；无附件或解析失败进入简历监控并可人工处理；抓取范围暂按已配置接收邮箱 | 不阻塞抓取骨架；上线前确认邮箱白名单 |
| Q12 | 招聘周期区间筛选放在职位还是招聘需求列表 | 暂放招聘需求列表；职位列表不提供 | 仅 UI 位置；不阻塞 |
