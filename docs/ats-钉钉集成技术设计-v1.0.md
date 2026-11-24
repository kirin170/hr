# 钉钉集成技术设计 v1.0

核对日期：2026-11-18。依据《ATS 功能需求文档 v1.2》§4、§7，《ATS PRD v1.0》§7 及《ATS 技术设计与开发环境 v1.0》§7.1、§8.3。

本文件把六类钉钉用途的权限、数据边界、回调、限流和失败策略统一记录。具体应用权限与租户能力仍须在授权测试组织验证；本文及本地代码不代表已完成租户联调。

## 1. 集成边界

- 钉钉是业务系统集成；AI 模型服务供应商不纳入钉钉业务集成范围。
- 组织架构和身份（DT-2）由本地适配器负责。通知、日历、听记、OA 录用审批和 OA 招聘需求分别保留独立适配器边界，避免某个权限或 API 故障阻断 ATS 主流程。
- 生产令牌、AppSecret、回调 Token 和 AESKey 仅通过部署环境注入。不得写入源码、请求日志、同步事件、审计摘要或 API 响应。
- OAuth 用户令牌只在授权回调内存中使用；应用令牌在进程内缓存并提前 60 秒刷新。令牌失效时刷新后最多重试两次。
- 钉钉身份按 `DINGTALK userId ↔ User.id` 一对一绑定。数据库已有 `IdentityLink(provider, subject)` 与 `(provider, userId)` 唯一约束；OAuth 登录时用用户令牌获取 `unionId`，再映射到通讯录 `userId`，不以姓名或邮箱进行身份登录匹配。

## 2. 六类用途和最小授权

| 编号 | 用途 | 所需权限 / 数据 | 回调与幂等 | 限流和降级 |
|---|---|---|---|---|
| DT-1 | 工作通知卡片、OA 审批待办 | 工作通知发送；只向 PRD 指定内部人员发送，不触达候选人 | 发送记录使用本地业务事件 ID 去重；若平台提供发送结果通知，按平台事件 ID 去重 | 限频与失败重试走队列；持续失败显示 ATS 待办/状态，由 HR 人工处理；审批待办仍以钉钉 OA 为准 |
| DT-2 | 通讯录、组织架构和身份 | OAuth 应用范围 `openid corpid`；读取当前授权人 `unionId` 所需通讯录个人信息读取权限；部门与成员目录只读。仅读取姓名、工号、邮箱、部门归属与 `userId`，不读取手机号 | 订阅新增/修改/离职用户及部门新增/修改/删除事件；事件签名和 AES 解密校验后按事件 ID 幂等入队 | 串行目录 Worker，失败指数退避；授权范围不全时不做缺失数据停用；支持管理端手动全量同步和失败事件重试 |
| DT-3 | 面试日程读写、状态回读、忙闲查询 | Calendar.Event.Read/Write、参与者忙闲读取；不读取无关日程详情 | 日程本地 ID 与钉钉 eventId 关联；同步 responseStatus；若订阅日程变更，按 eventId/version 幂等 | 按用户排队及错峰；遵守 PRD 记录的每用户每日 100 个新建日程上限；超额时保留本地面试安排并提示 HR 分批创建 |
| DT-4 | 听记转写读取 | 仅对有权限的听记读取原文或转写；不使用钉钉内置智能纪要作为 AI 评估结论 | 按听记 ID 与面试轮次关联来源；不订阅不必要的录音事件；重复素材读取不得覆盖已有来源关联 | 读取超时/拒绝保留人工上传或录入通道；原文不进入日志；继续走统一 `INTERVIEW_EVAL` 输入契约 |
| DT-5 | OA 录用审批发起、查询 | OA 审批创建和只读查询；两级审批人为人事经理、人事主管；材料仅使用 PRD 规定的三项 | 若租户开放审批结果回调则校验实例 ID 并去重；回调失败由人事手工回填，不反向修改 OA 单据 | API 限流走重试队列；审批不可用时保留 ATS Offer 状态并提示人工在 OA 办理 |
| DT-6 | OA 招聘需求审批同步 | OA 审批实例与结果只读；读取审批通过结果、表单字段和提交时间 | `oaApprovalId` 唯一约束、事务和事件 ID 共同保证幂等；支持授权管理员按审批单号人工补同步 | 失败不阻断 ATS；持续失败展示待同步状态并人工重试；不在 ATS 自建审批流，也不回写 OA 原单 |

实际应用权限以钉钉开发者后台当前应用配置为准。不同接口可能要求单独的通讯录、日历、审批、听记或消息权限；上线前按能力逐项申请并做最小权限审查，不因某一功能方便而申请无关通讯录字段或全量写权限。

## 3. DT-2 授权登录与身份映射

1. `GET /api/v1/auth/dingtalk/login` 生成 256-bit 随机 `state`，写入 5 分钟、HttpOnly、SameSite=Lax Cookie，再跳转钉钉 OAuth 授权页。
2. 授权回调接受标准 `authCode` 字段，并兼容 `code`；Cookie 与 query state 以恒定时间比较。状态不匹配、授权取消、缺少字段或配置企业不匹配均拒绝登录。
3. 后端以授权码换用户访问令牌，校验响应 `corpId` 与 `DINGTALK_CORP_ID` 完全一致；用户令牌只用于取当前用户 `unionId`，然后使用应用令牌解析企业通讯录 `userId`。
4. 只接受已经通过 ATS 身份映射的 `userId`。工号只用于组织同步时查找已有唯一员工记录，不作为 OAuth 登录凭据。缺少映射时拒绝登录，不按姓名或邮箱自动登录其他账号。
5. 成功后沿用现有 15 分钟访问 JWT 和刷新令牌轮换机制；刷新令牌仅放入 HttpOnly、Secure（非 local）Cookie，数据库保存哈希。回调跳转到配置好的前端地址并附带 `dingtalk_login=success` 标志；前端随后调用 `/api/v1/auth/refresh` 换取访问 JWT、清理地址栏标志，并在后续请求收到 401 时以单个并发刷新请求恢复会话。访问令牌不放进 URL。

组织同步以 `DINGTALK_<corpId摘要>_<deptId>` 作为本地部门唯一编码。用户的 `userId` 关联 `IdentityLink.subject`。精确工号匹配可把钉钉身份绑定到已有唯一员工记录；若工号、邮箱或一对一映射冲突，事件失败并进入管理员处理，不猜测合并。新建钉钉用户不自动分配角色。部门多归属保存于 `user_departments`，兼容现有 `User.departmentId` 主部门字段；服务端授权范围由全部有效部门及有效子部门计算。

收到离职事件后，将用户设为 `INACTIVE`、清空部门归属、撤销刷新会话、移除角色/用户组成员和用户级敏感字段授权。再次出现在组织通讯录时只恢复 ACTIVE，不自动恢复角色或敏感权限，须由管理员按岗位重新授权。转岗或兼任更新全量部门成员关系，后续请求立即按新部门范围授权。

## 4. 事件回调与异步处理

- 本地回调：`POST /api/v1/dingtalk/events`；钉钉回调配置的 URL 必须为公网 HTTPS。订阅用户 `user_add_org`、`user_modify_org`、`user_leave_org`，以及部门 `org_dept_create`、`org_dept_modify`、`org_dept_remove`。事件 ID 可按数组批量传入；回调适配器为每个 userId/deptId 建立独立幂等队列项。
- 回调校验 `signature`、`timestamp`、`nonce`、`encrypt`；签名按 Token 与三项参数排序拼接后计算 SHA-1，并以恒定时间比较；密文按钉钉 AES-256-CBC 协议解密，同时校验尾部 ownerKey。当前企业内部应用事件订阅默认以 `DINGTALK_CLIENT_ID`（AppKey）作为 ownerKey；仅当实际回调配置明确要求其他值时，才设置 `DINGTALK_CALLBACK_OWNER_KEY` 覆盖。URL 验证 challenge 原样加密返回。
- 事件接收端只校验、保存最小事件元数据并异步入 BullMQ；不在 HTTP 回调内调用钉钉目录 API。消息体不落库。事件 ID 缺失时对脱敏前的规范化事件输入计算摘要作为幂等键。
- Worker 先标记 `PROCESSING`，成功后写 `PROCESSED`；重试中写 `QUEUED`；超过最大次数写 `FAILED` 和不含令牌/个人资料的错误码。队列配置默认 5 次指数退避、1 秒基准延迟、目录并发 1。队列/数据库写入短暂故障时，未完成的 `RECEIVED` 记录由后台 Outbox 轮询补投。
- 离职、转岗和部门移除均写审计记录。未知事件类型不改数据并正常确认，避免平台对不支持事件无限重投；签名、AES 或企业标识错误拒绝处理。
- 管理端接口：`POST /api/v1/admin/organization/dingtalk/sync` 触发同步；请求体可传 `{"departmentId": 123}`，从该部门及其下级部门同步；省略时使用 `DINGTALK_SYNC_ROOT_DEPARTMENT_ID`，默认值为企业根部门 `1`。指定子部门同步只更新该子树，不停用范围外的部门或用户。`GET /api/v1/admin/organization/dingtalk/events` 查看状态；`POST /api/v1/admin/organization/dingtalk/events/:id/retry` 重试失败项。均要求 `organization:sync`。
- `DINGTALK_SYNC_DEACTIVATE_MISSING=false` 默认关闭“全量列表中未出现即停用”。只有测试证明应用能读取完整通讯录后才可启用，防止通讯录权限范围不足造成批量误停用。明确的离职/删除事件不受此开关影响。

## 5. 通用限流、重试与错误处理

| 错误 | 自动处理 | 业务结果 |
|---|---|---|
| 网络超时、HTTP 429/5xx、平台限流码 | 指数退避；仍失败则进入 BullMQ 重试/失败状态 | 不丢任务；提供人工重试 |
| 应用令牌过期/无效 | 清除进程缓存，重新取令牌后有限重试 | 反复失败时标记同步失败，不暴露令牌 |
| 权限不足、无效字段、企业不匹配 | 不自动重试；记录脱敏错误码 | 管理员修权限/映射后人工重试 |
| 身份、工号、邮箱唯一约束冲突 | 不自动合并，不自动换绑 | 保持数据安全并进入管理员处理 |
| DT-3 单用户日程额度 | 创建前由本地排期队列计数和限速 | 提示拆批，保留本地排期 |
| DT-5/DT-6 回调不可用 | OA 状态与 ATS 状态分离；按实例/审批单号人工补查 | 不阻断主业务；保持幂等 |

通用 API 客户端限制单请求超时 8 秒，仅对可重试的限流、网络和服务端错误退避；永久 4xx 不做无效重试。每类适配器应对钉钉不可用做故障隔离，ATS 候选人主链不等待通知、日历、听记或 OA API 完成。

## 6. 当前实现与待验证项

- 已在本地实现 OAuth 授权码登录、企业 ID 校验、`unionId → userId` 映射、加密回调、用户/部门全量与事件增量同步、离职权限撤销、多部门归属、BullMQ 失败重试和管理端人工重试接口。
- 已在本地实现 DT-4 听记素材读取（ATS-020）：听记链接解析、按操作者钉钉身份读取原文/摘要、按轮次追加留存、`INTERVIEW_EVAL` 统一素材交付、越权与失败降级，详见 §7。真实租户的听记读取能力仍未验证。
- 当前未注入钉钉测试企业的 AppKey/AppSecret、corpId、回调 Token/AESKey；未执行租户联调、权限审批或真实回调验证。不得将本地测试报告写成租户验收证据。
- 租户验证顺序：先配置最小权限并做 OAuth 与当前用户映射；再用脱敏组织样例验证全量部门树、多部门用户、重复回调、转岗、离职、无效签名、接口限流、超时、失败重试与手工恢复；最后分别验证 DT-1、DT-3、DT-4、DT-5、DT-6 的权限和对应业务降级。
- 钉钉开放平台官方文档复核记录（2026-11-18）：
  - OAuth 2.0 用户授权与授权码换取用户访问凭证：`POST /v1.0/oauth2/userAccessToken`；`GET /v1.0/contact/users/me` 用用户访问令牌取得 unionId。
  - 企业内部应用 accessToken：`POST /v1.0/oauth2/accessToken`，请求体为 `appKey`、`appSecret`，响应字段为 `accessToken`、`expireIn`；当前客户端按内部应用专用接口实现并缓存令牌。
  - 通讯录：`topapi/v2/department/listsub` 递归读取部门；`topapi/v2/user/list` 按 `dept_id` 和 `next_cursor` 分页，`contain_access_limit=true` 纳入通讯录中受访问限制的用户。
  - 当前企业内部应用的 HTTP 事件推送可配置用户和部门变更事件；批量回调中的 userId/deptId 是数组。当前开发者后台事件订阅的 HTTP 回调 ownerKey 使用对应应用 AppKey；旧版回调模式若配置契约不同，再显式覆盖 `DINGTALK_CALLBACK_OWNER_KEY`。
  - 官方页面检索入口：OAuth 2.0 授权与获取用户访问凭证、获取企业内部应用 accessToken、获取部门用户详情、事件订阅回调加解密（open.dingtalk.com）。API 字段、权限、配额和事件名仍需在授权测试组织中复核。

## 7. DT-4 听记素材读取（ATS-020）

### 7.1 能力现状（2026-11-23 复核）

- 钉钉开放平台当前未向企业内部应用提供听记（AI 听记）读取的 REST 接口。官方对外通道是「AI 听记 · 连接你的 AI 工具」中的 CLI（dws）与 MCP/内置连接器；组织内使用需管理员开通权限，并由成员扫码授权，读取范围受授权人本人可见范围限制。
- 因此 ATS 后端不能仅凭 AppKey/AppSecret 读取任意听记。实现以「按操作者身份读取 + 显式能力探测」为前提：未开通时保留人工录入通道，不伪造素材，也不把内置智能纪要当评估结论。

### 7.2 本地实现

- 链接解析：只接受 `shanji.dingtalk.com` 的听记地址（如 `/app/transcribes/<id>`）或 16–64 位十六进制听记 ID；外部域名不解析、不回源，避免 SSRF。
- 读取：按当前操作者的 `DINGTALK userId` 调用部署环境注入的听记网关，由网关在租户侧按人授权。
  - `GET {DINGTALK_MINUTES_GATEWAY_URL}/v1/minutes/capability`
  - `POST {DINGTALK_MINUTES_GATEWAY_URL}/v1/minutes/transcripts`，请求体 `{ minutesId, operatorUserId }`，响应 `{ minutesId, title, summary, originalText, segments[] }`
  - 单请求 8 秒超时；429/5xx/网络错误重试一次；401/403 与权限错误码立即判为越权，不重试。
- 错误与降级：ATS 数据范围越权按 404 处理；钉钉侧越权返回 403 并记录 `interview.transcript.material_denied` / `material_failed`（仅错误码）；租户未开通返回 503 并提示人工录入；原文、摘要与令牌不进入日志、审计摘要或错误信息。
- 留存：素材写入 `interview_transcript_materials`，按「链接 + 内容哈希」唯一，重复读取不新增、不覆盖既有来源关联；链接表只补齐 `minutesId/source`，不改写 URL；听记链接仍按轮次追加。
- 交付：`INTERVIEW_EVAL` 输入契约 `interview-eval.v1` 只保存素材引用（`materialId`、`sourceRef`、哈希、长度、分段数）与面试上下文、职位招聘要求、本轮评价；`boundaries` 写死「内置智能纪要不得作为结论、AI 输出为草稿、需人工确认」。职位无招聘要求时不发起评估（AI-5）。

### 7.3 待验证项

- 2026-11-24 在授权测试组织的开放平台后台核实：`Minutes.Content.Read` 已开通（无需审批），但该权限只关联「查询/创建 DingTalkA1 小助理分析」两个接口，官方文档写明入参为 `agentId` 与 `openFileId`，不接受听记 uuid，读不到 AI 听记的摘要与逐字稿。
- 授权测试组织是否具备听记读取能力、所需权限点与审批路径。
- 网关（或等价服务端通道）的正式实现、限流与配额。
- 真实听记的摘要/原文质量、分段时间轴字段与长文本上限。
