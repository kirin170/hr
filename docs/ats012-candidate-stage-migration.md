# ATS-012 候选人阶段迁移映射与状态转换矩阵

本文把 ATS-012 的九阶段口径落到现有 Candidate 枚举和 UI 原型上，供后端阶段动作、筛选计数与详情页共用。

## 阶段边界

九个主链阶段为 `RECOMMENDED`、`HR_SCREENING`、`DEPT_SCREENING`、`INTERVIEWING`、`OFFERING`、`PENDING_ONBOARD`、`ONBOARDED`、`PROBATION`、`ENDED`。`UNASSIGNED` 与 `VIRTUAL_POOL` 是进入主链前的池状态，不计入九阶段；`ARCHIVED` 是归档终态，也单独显示。

阶段计数、列表与动作均以数据库 Candidate.stage 为准，并与当前用户的 `candidate:read` 数据范围取交集。职位筛选只允许使用当前用户有权访问的职位。任何状态变更都必须由具名动作发起，在同一事务里写入候选人状态与时间线。

## 六阶段原型映射

原型六阶段是 UI 投影，不作为新的持久化枚举。迁移保留候选人 ID、职位、来源、附件、标签与既有时间线；不根据原型显示值推测更细的业务事实。

| 原型阶段 | 规范阶段 | 映射规则 |
|---|---|---|
| `new` | `UNASSIGNED` / `VIRTUAL_POOL` / `RECOMMENDED` | 没有职位时按 poolType 归入待分配或虚拟池；关联虚拟职位时为虚拟池；关联正式职位时为人才推荐。 |
| `screening` | `HR_SCREENING` 或 `DEPT_SCREENING` | 已有数据库阶段时原样保留；只有旧 UI 值时按 HR 初筛处理，不推断用人部门已筛选。 |
| `interview` | `INTERVIEWING` | 保留面试主阶段，不推断面试结论或自动推进 Offer。 |
| `offer` | `OFFERING` | 只映射至沟通 Offer，不推断书面 Offer 已发送、已接受或可入职。 |
| `hired` | `ONBOARDED` | 旧 UI 动作写入已入职；已有 `PROBATION` 数据继续原样保留，不能从旧 UI 投影覆盖。 |
| `rejected` | `ARCHIVED` | 归档原因保持原值或空值，不从旧标签推测原因集。 |

## 转换矩阵

| 当前状态 | 显式动作 | 目标状态 | 必要条件与结果 |
|---|---|---|---|
| `UNASSIGNED` / `VIRTUAL_POOL` | 分配职位 | `RECOMMENDED` | 目标职位必须存在、未关闭、非虚拟且在操作者数据范围内；职位负责人由职位带出。 |
| `RECOMMENDED` | 开始初筛 | `HR_SCREENING` | 仅需阶段操作权限；动作和时间线显式记录。 |
| `HR_SCREENING` | 初筛通过 | `DEPT_SCREENING` | 初筛原因可空；初筛淘汰可归档且原因可空；不满足权限或锁定时拒绝。 |
| `DEPT_SCREENING` | 记录部门筛选 `PASS` / `HOLD` / `REJECT` | `INTERVIEWING` / 保持 `DEPT_SCREENING` | 每位筛选人分别留记录。`PASS` 必须填写筛选原因并带一个或多个结构化可约时间段；任一有效 `PASS` 即推进。`HOLD` 与 `REJECT` 不单独推进，后续仍可由其他筛选人给出 `PASS`。 |
| `INTERVIEWING` | 人工推进 Offer | `OFFERING` | 面试评价不触发阶段更新；必须由人事显式操作。 |
| `OFFERING` | 确认书面 Offer | `PENDING_ONBOARD` | 仅在持久化 Offer 子状态为 `WRITTEN_OFFER + ACCEPTED`、已记录发送时间及入职日期后允许；Offer 子状态契约由 ATS-015 补齐，在事实缺失时一律拒绝。 |
| `PENDING_ONBOARD` | 确认入职 | `ONBOARDED` | 人事显式确认；同时写入状态与时间线。 |
| `ONBOARDED` | 开始试用期 | `PROBATION` | 人事显式操作；试用期只记录是否转正及时间。 |
| `PROBATION` | 结束试用期 | `ENDED` | 人事显式操作；不创建绩效、考勤或薪酬数据。 |
| 任意非归档状态 | 一般归档 | `ARCHIVED` | 一般原因选填并保存；`OFFERING` 与 `PENDING_ONBOARD` 暂时拒绝通用归档，等 ATS-015 接入 Offer/入职事实与原因集校验后再开放，以免绕过必填原因。 |
| `ARCHIVED` | 激活回流 | `RECOMMENDED` | 由 ATS-013 的人才库激活动作承接；本任务不开放通用阶段接口绕过激活记录。 |

## 并发、锁定与撤销

- 阶段动作使用当前阶段作为乐观并发条件；同一候选人并发提交时，仅一项可以生效，失败者返回冲突。
- `INOPERABLE` 候选人拒绝阶段、筛选与职位分配；有权限的操作者仍可显式解锁或改为 `OPERABLE`，避免无法恢复。
- 撤销只回滚最近一次有效阶段动作，要求当前阶段仍等于该动作的目标阶段；写入补偿时间线，不删除历史事件。若动作由部门 `PASS` 触发，撤销同时撤销对应筛选记录，避免仍存在有效 PASS 却停留在部门筛选。
- 所有列表、阶段计数、职位筛选树、已保存筛选与批量动作服务端执行权限范围；批量操作按候选人返回逐项结果，不因一条越权记录泄露其他记录。

## 仍由后续任务补齐的事实来源

ATS-012 先落实主阶段契约和筛选事实。Offer 六阶段及书面 Offer 接受/发送/入职日期的权威持久化由 ATS-015 提供；人才库激活与高容量查询由 ATS-013 提供。ATS-012 不会用客户端提交的布尔值代替这些持久化事实。
