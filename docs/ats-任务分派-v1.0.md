# ATS 任务分派 v1.0（2026-11-20）

分派人：Claude Code（用户于 2026-11-20 明确授权“你来做任务分派”）。
执行方：本机编程智能体 **Codex**、**CodeBuddy**、**Trae**；Claude Code 负责统筹、交叉复核与最终验收汇总。
权威台账：`.awr/intake/work-ledger.yaml`（AWR source r43）。本文件是分派说明，任务状态、依赖与验收条件以台账为准。

---

## 1. 分派边界

- 本次只改变 **负责人（owner）** 与 **下一步（next_action）**，**不改变任何任务状态**：15 个未完成任务仍为 `planned`。
- 各智能体在依赖满足后**自行领取 AWR 会话**再执行；分派本身不构成“已完成”“已验收”。
- **批次 = 依赖顺序，不是工期承诺**，不含上线日期。用户可随时改派。
- 完成回写仍走原规则：真实报告 + `source_sha` + 验收绑定，经 AWR 完成路径写回；不得由“代码存在”推断完成。

## 2. 进度快照（分派时）

| 项 | 数量 | 说明 |
| --- | --- | --- |
| 工作项总数 | 28 | 含 2 个 INTAKE 组织任务 |
| 已完成 | 13 | INTAKE-001/002、ATS-001～009、ATS-017、ATS-026 |
| 未完成 | 15 | ATS-010～016、ATS-018～025 |
| 依赖已满足、可立即启动 | 3 | **ATS-012、ATS-010、ATS-022** |
| 依赖未满足 | 12 | 绝大多数直接或间接卡在 ATS-012 |
| 结构问题 / 来源告警 | 0 / 0 | `awr intake inspect` ok=true |

关键路径：**ATS-012 → 014 → 015 → 016 → 018/023 → 025**，另一条 **012 → 013 → 023**。
ATS-012 的代码与静态检查已落地（提交 `9a4f363`，报告 v1/v2/v3 已登记），**缺的是数据库迁移重放 + API/浏览器验收**，所以它不是“从零开发”，而是“补验收并关闭”。它是全项目解锁点，优先级最高。

## 3. 分派总表

| 任务 | 标题 | 负责人 | 批次 | 依赖 |
| --- | --- | --- | --- | --- |
| ATS-012 | 九阶段候选人主链与筛选状态机 | **Codex** | 1 | 004/007/008 ✅ |
| ATS-022 | 真实邮箱轮询、附件获取与异常恢复 | **CodeBuddy** | 1 | 008/005 ✅ |
| ATS-010 | 通用浏览器导入 API 与任务审计 | **Trae** | 1 | 004/005/008 ✅ |
| ATS-014 | 面试排期、登记表与评价协同 | Codex | 2 | 012 |
| ATS-024 | 业务设置与配置审计 | CodeBuddy | 2 | 004/007/012 |
| ATS-013 | 人才库归档、激活与万级查询 | Trae | 2 | 012 |
| ATS-015 | Offer 状态、OA 材料和背调流程 | Codex | 3 | 012/014/005 |
| ATS-016 | 待入职、确认入职与试用期闭环 | Codex | 3 | 015 |
| ATS-020 | 钉钉听记素材按权限读取 | CodeBuddy | 3 | 017/014 |
| ATS-011 | Chrome/Edge MV3 扩展与双平台适配 | Trae | 3 | 010 + 平台样本验证 |
| ATS-018 | 钉钉日历与固定事件通知正式接入 | Codex | 4 | 017/014/016 |
| ATS-019 | 钉钉 OA 需求同步与录用审批对接 | CodeBuddy | 4 | 017/007/015 |
| ATS-021 | AI 三场景正式适配与人工复核 | CodeBuddy | 4 | 008/012/014/020 |
| ATS-023 | 工作台与可下钻招聘报表 | Trae | 4 | 007/013/014/016 |
| ATS-025 | 端到端验收、性能和发布运维准备 | Claude Code（统筹） | 5 | 几乎全部 |

### 车道划分（按历史交付与文件归属，避免互相踩）

- **Codex —— 候选人主链 + 流程后端 + 钉钉日历**：已交付 ATS-006（迁移/CI）、ATS-017（组织同步），且 ATS-012 现有代码与 checkpoint 就是它写的，接续成本最低。
  主目录：`backend/src/candidates/`、`interviews/`、`offers/`、`onboarding/`、`integrations/dingtalk`（日历/通知部分）、对应前端 `src/pages/Candidates.tsx`、`Pipeline.tsx`、`CandidateDrawer.tsx`。
- **CodeBuddy —— 入场/配置/集成/AI**：已交付 ATS-005/007/008/009，熟悉入场与附件链路。
  主目录：`backend/src/intake/`、`storage/`、`admin|settings/`、`ai/`、`integrations/dingtalk`（OA/听记部分）、前端简历入场/待分配池/监控/设置页。
- **Trae —— 扩展 API/插件 + 人才库 + 报表前端**：新加入，先给契约清晰、可独立验证的 ATS-010 作为首个任务。
  主目录：`backend/src/extension-import/`（新模块）、`pool/`、`reports|dashboard/`、`extension/`（新目录）、前端人才库与报表页。
- **Claude Code —— 统筹**：分派与改派、跨任务冲突仲裁、报告与 `source_sha` 复核、ATS-025 追溯矩阵与上线清单。**业务验收由用户指定验收人完成，智能体不代替。**

## 4. 第 1 批启动指令（可直接粘给对应智能体）

### → Codex：ATS-012（P0，关键路径）

```text
在 D:\hr 执行 ATS-012（九阶段候选人主链与筛选状态机）的收尾验收。
先 git switch dev && git pull --ff-only origin dev，再 awr status / awr work show ATS-012 读权威下一步。
你之前已完成代码与静态检查（提交 9a4f363，报告 docs/verification/ats012-candidate-flow-report-v3.json，
其 source_sha=dc8524e，working_tree_dirty=true）。本次不重写实现，只补真实验证：
1) 建临时 MySQL 库（如 talentflow_ats012），重放全部 Prisma 迁移，重点 20261118120000_ats012_candidate_state；不得改动本地 talentflow 库。
2) 跑状态机/权限/批量动作 API 校验：允许与拒绝分支、锁定、撤销、乐观并发、部门筛选 PASS/HOLD/REJECT 与任一 PASS 推进、面试结论不自动进 Offer。
3) 前端浏览器人工走查：待分配+九阶段+归档、职位树、权限内计数、保存筛选、分页、批量动作、时间线。
4) 明确 OFFERING/PENDING_ONBOARD 归档分支中留给 ATS-015 的边界，写进报告 limitations。
5) 出具新报告（真实 source_sha、command、scope、checks[].criteria 绑定三条验收），登记 evidence 后再按 AWR 完成路径回写状态。
6) 完成后通知：ATS-009 需复跑后端 typecheck/build；ATS-013/014/024 依赖本任务解锁。
临时库校验后删除。提交走 dev，不碰 master。
```

### → CodeBuddy：ATS-022

```text
在 D:\hr 执行 ATS-022（真实邮箱轮询、附件获取与异常恢复）。
先 git switch dev && git pull --ff-only origin dev，再 awr work show ATS-022 读验收条件。
范围：多招聘邮箱关联与轮询、仅带简历附件的邮件建档、PDF/Word/图片走统一 AI 解析而 Excel 走独立表格导入、
断点恢复不重复建档、重复附件查重合并/跳过、解析失败转人工、附件先进待分配池由 HR 手工选职位（不自动匹配）。
复用你在 ATS-005/008 已交付的存储与入场链路，不要另起一套。
前置：测试邮箱与访问凭据需用户提供。凭据未到位时，先用本地 IMAP + 脱敏样本完成契约与正常/重复/异常路径验证，
并在报告中把“真实邮箱验收”显式记为待补——不得据此判定任务完成。
验证用临时 MySQL 库，用完删除；报告写 docs/verification/，提交走 dev。
```

### → Trae：ATS-010

```text
在 D:\hr 执行 ATS-010（通用浏览器导入 API 与任务审计）。这是后端契约任务，不依赖任何第三方招聘页面。
先 git switch dev && git pull --ff-only origin dev，再 awr work show ATS-010 与 awr context 读上下文。
第一步先冻结契约再写实现：POST 导入返回 202 任务、短期系统令牌校验、任务所有者查询、requestId 幂等；
平台 ID + 附件哈希 + 联系方式查重命中进 DUPLICATE 待人工选择；URL 脱敏、附件字节上传、
禁止持久化第三方凭据、附件不可用等标准错误码，全部要有契约用例与脱敏 fixtures。
复用 ATS-004 权限、ATS-005 附件存储、ATS-008 入场与解析确认链路，不新建平行入口。
新模块放 backend/src/extension-import/，尽量不改他人正在改的 candidates/interviews 目录；
需要动 schema.prisma 时先在 dev 上同步并告知，迁移不要与他人同时提交。
验证用临时 MySQL 库，用完删除；报告写 docs/verification/，提交走 dev。
```

## 5. 三方并行协作规则

1. **分支**：一律 `dev`。开工前 `git switch dev && git pull --ff-only origin dev`；小步提交，禁止 force-push 与改写共享历史；`master` 只由用户经 PR + 两项状态检查合并。
2. **文件边界**：按第 3 节车道写代码。跨车道改动先在台账 `next_action` 或提交信息里说明。
3. **迁移串行**：`backend/prisma/schema.prisma` 与新迁移是冲突热点——**同一时间只允许一个智能体新增迁移**，其余先 `pull --ff-only` 再开工。历史教训：ATS-009 的后端 typecheck/build 曾被并发的 ATS-012 改动阻断。
4. **数据库**：验证一律用临时库 `talentflow_<task>`，校验后删除；**不得改动本地 `talentflow` 库**。
5. **AWR 会话**：执行前 `awr session start --work <KEY> --agent <Codex|CodeBuddy|Trae> --provider generic --model <model> --claim --ttl-ms 3600000 --expected-revision <rev>`；中断用 `session checkpoint` 记录真实进度（checkpoint 不等于完成）；换智能体接手用 `session resume`/`handoff`，不要复用他人会话 ID。
6. **完成判定**：报告必须含真实 `source_sha`、`command`、`scope`、`checks[].criteria` 与验收条目绑定；`working_tree_dirty` 要如实记录。缺环境、缺凭据的部分写成显式未验证，不得用静态审查冒充接口验收。
7. **范围红线**（全项目通用）：不存薪资明细；不自建审批流；AI 结果一律人工确认后转正式（高置信度也不例外）；邮箱附件不自动匹配职位；报表真实计数，只有人才库总量 ≥10000 才显示 1w+。
8. **台账写法**：`.awr/intake/work-ledger.yaml` 里**不要使用 YAML 块标量**（`key: |-` / `|` / `>`）。AWR 0.7.0 的写入器遇到块标量会对**整个文件**报 `MutationUnsupported: quoted scalar marker mismatch`，导致 `work edit` / `work progress` / `work complete` 全部写不进去，完成流程退化成"提案创建→批准→又要求提案"的死循环，状态只能手工改。多行文本写成双引号标量、用 `\n` 转义换行（内容等价），或写成单行。2026-11-20 已把仅有的两处块标量（`ats-delivery.summary`、`INTAKE-002.summary`）按此归一化，写回恢复正常。

## 6. 需要用户提供的前置条件（阻塞真实验收，不阻塞开工）

| 前置 | 影响任务 | 说明 |
| --- | --- | --- |
| 可用的测试 MySQL 实例 | 012 及后续全部 | 目前无本地测试库，是 ATS-012 无法关闭的直接原因 |
| 招聘测试邮箱 + 访问凭据 | 022、024 集成层 | 多邮箱关联与真实轮询验收 |
| 钉钉授权测试企业（日历/OA/听记权限） | 018、019、020 | ATS-017 只完成组织同步，其余用途尚未实测 |
| AI provider 凭据与配额（钉钉/通义 + 兜底） | 021 | 需确认可用模型与切换细则 |
| BOSS/猎聘脱敏页面样本与企业分发方案 | 011 | 未通过验证的平台保持显式未交付 |
| 性能阈值、业务验收人、发布排期 | 025 | 无实测不得宣称达标；业务验收不由智能体代替 |

## 7. 已知风险与待办

- **ATS-012 报告基线过期**：v1/v2/v3 均记录 `source_sha=dc8524e` 且 `working_tree_dirty=true`，当前 HEAD 已前进；收尾必须出具绑定新 SHA 的报告，不能沿用旧报告宣称完成。
- **ATS-009 遗留**：后端 typecheck/build 需在 012 落地后复跑；`/campus` 与来源记录页缺浏览器人工走查。
- **ATS-008 遗留**：`backend/dist`、`backend/.tmp-ats008-dist` 需手动清理；上传/Excel/待分配池/监控缺登录态下的走查。
- **ATS-017 边界**：绑定身份 OAuth 闭环、增量变更、转岗/离职权限、HTTPS 回调幂等与失败重试仍未实测，018/019/020 开工时需一并补验。
- **Trae 首次接入**：ATS-010 完成后由 Claude Code 复核契约与权限分支，再放行 013/011。
- **历史证据**：13 个已完成项在本次查询中为 `completion_not_checked`（未指定 source SHA），既不是失败也不是重新验收；需要复核时用 `awr intake inspect --source-sha <SHA>`，不得用当前 HEAD 补造旧证据。

---

变更记录：v1.0（2026-11-20）首次分派，覆盖 15 个未完成任务；台账同步更新 owner 与 next_action，状态保持 planned。