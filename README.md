# TalentFlow ATS

TalentFlow 是一套持续开发中的招聘管理系统。仓库同时包含已接入后端的 ATS 能力和早期 UI 原型；当前不能把整套界面视为已交付的招聘业务系统。

## 当前实现范围

| 模块 | 数据来源与现状 |
|---|---|
| 候选人列表、详情、新建与阶段更新 | 已调用后端 API，数据保存在 MySQL；候选人阶段更新进入后端时间线/审计。页面仍沿用原型的六阶段枚举，九阶段主链待 ATS-012。 |
| 职位、HC 与招聘需求 | 页面已接入职位和需求 API；职位编号、关闭、Mock OA 需求同步及需求级招聘周期由后端处理。Mock OA 不是钉钉正式集成。 |
| 身份与权限 | 支持钉钉 OAuth 登录、角色、部门范围和敏感字段授权；登录需配置企业应用与回调。开发环境可按[本地运行手册](docs/ats-本地开发运行手册.md)启用本地身份适配。 |
| 简历入场与 AI 解析 | 后端已有入场和 Mock 解析基础模块；完整入场界面、邮箱轮询、Excel 批量导入、浏览器扩展及正式模型尚未交付。 |
| 工作台、面试、部门协同、报表和试用期页面 | 主要使用 `src/data.ts` 的演示数据，在当前页面会话内变更；刷新页面会恢复演示初始值，不写入数据库。 |

浏览器 `localStorage` 仅用于开发访问令牌（键名 `talentflow.accessToken`），不再用于保存候选人或其他业务数据。设置页的“重置演示数据”只重置前端演示状态，不删除后端记录。

## 尚未交付的业务能力

- 候选人九阶段状态机、人才库归档/激活及万级查询。
- 钉钉正式登录、组织同步、日历、通知、听记和 OA 审批/需求同步。
- 正式邮箱接入、浏览器扩展、AI 服务商接入以及完整的解析人工确认流程。
- 可用于业务决策的工作台、招聘报表、面试协作、Offer 与入职闭环。

原型里的待办审批按钮不是 ATS 自建审批能力，也不代表钉钉 OA 审批已连接。试用期页面中的评分、目标进度、打卡和绩效意见仅为展示数据；正式范围收敛为记录是否转正及转正时间，不建设试用期绩效/考勤系统。原型数据不应作为真实招聘数据或业务决策依据；迁移范围按后续对应任务和 PRD 确认。

## 本地开发

开发环境以 Windows 原生服务为准，不使用 Docker。需要 Node.js 22、MySQL 8 和 Redis 7。安装依赖、环境变量、空库初始化、开发登录和服务启动步骤见[本地开发运行手册](docs/ats-本地开发运行手册.md)。

根目录常用命令：

```powershell
npm run dev:web
npm run dev:api
npm run dev:worker
npm run build
npm run db:validate
```

Web 默认地址为 `http://localhost:4173`，API 默认监听 `http://localhost:3000`。API 与 Worker 是两个独立进程；队列相关功能需要 Redis。

## 质量检查

```powershell
npm run typecheck --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run test:e2e --prefix backend
npm run build:api
npm run build
```

项目进度、已完成任务和验收记录以路线图与 `docs/verification/` 中的报告为准。完整需求边界见 [功能需求文档](docs/ats-功能需求文档-v1.2.md)、[PRD](docs/ats-PRD-v1.0.md) 与[实施路线图](docs/ats-项目目标与实施路线图-v1.0.md)。
