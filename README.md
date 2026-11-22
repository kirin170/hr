# TalentFlow ATS

TalentFlow 招聘管理系统是一套持续开发中的招聘管理系统。仓库同时包含已接入后端的 ATS 能力和早期 UI 原型；当前不能把整套界面视为已交付的招聘业务系统。

系统正式全称为 **TalentFlow 招聘管理系统**；界面显示 **TalentFlow**，配中文副标题“招聘管理系统”；技术文档及仓库说明使用 **TalentFlow ATS**。

## 当前实现范围

| 模块 | 数据来源与现状 |
|---|---|
| 候选人列表、详情、新建与阶段流转 | 已接入后端 API 与 MySQL，写入后端时间线与审计。`ATS-012` 已将前端迁移至待分配 + 九阶段主链 + 归档、职位树、保存筛选、批量动作、锁定、撤销与部门筛选 `PASS/HOLD/REJECT`，后端与大部分走查已通过，待最终收尾关闭。 |
| 职位、HC 与招聘需求 | 页面已接入职位和需求 API；职位编号（`MJ%06d`）、虚拟职位、关闭、Mock OA 需求同步及需求级招聘周期由后端处理。Mock OA 不是钉钉正式集成。 |
| 身份、权限与钉钉组织同步 | 支持本地开发登录、钉钉 OAuth 登录、角色、部门范围、敏感字段独立授权与审计日志导出；`ATS-017` 已完成授权租户全量组织同步初验，增量同步与回调联调待后续补验。 |
| 简历入场、校招门户与附件存储 | `ATS-005/008/009/010/022` 已交付：私有附件存储与到期清理、上传/手工/Excel 批量导入/待分配池/查重合并/入场监控 UI、来源台账、公开校招投递门户 `/campus`、通用浏览器导入 API 及真实 IMAP 多邮箱轮询（AI 解析仍为 Mock Provider）。 |
| 工作台、面试、部门协同、报表和试用期页面 | 主要使用 `src/data.ts` 的演示数据，在当前页面会话内变更；刷新页面会恢复演示初始值，不写入数据库。 |

浏览器 `localStorage` 仅用于开发访问令牌（键名 `talentflow.accessToken`），不再用于保存候选人或其他业务数据。设置页的“重置演示数据”只重置前端演示状态，不删除后端记录。

## 尚未交付的业务能力

- 人才库归档/激活闭环与万级查询（`ATS-013`）。
- 面试排期、登记表与评价协同（`ATS-014`）、Offer 六阶段与背调（`ATS-015`）、待入职/确认入职与试用期闭环（`ATS-016`）。
- Chrome/Edge MV3 浏览器扩展与 BOSS/猎聘双平台适配（`ATS-011`）。
- 钉钉日历与固定事件通知（`ATS-018`）、钉钉 OA 正式对接（`ATS-019`）、钉钉听记读取（`ATS-020`）及 AI 三场景正式模型接入（`ATS-021`）。
- 可用于业务决策的真实工作台、可下钻招聘报表（`ATS-023`）与统一管理后台（`ATS-024`）。

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

Web 默认地址为 `http://localhost:4173`，API 默认监听 `http://localhost:3000`。API 与 Worker 是两个独立进程；队列相关功能与定时邮箱轮询需要 Worker（解析队列另需 Redis）。

## 质量检查

```powershell
npm run typecheck --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run test:e2e --prefix backend
npm run build:api
npm run build
```

文档索引与冲突裁决规则见 [文档中心](docs/README.md)；已实现接口、权限点与错误码见 [API 契约与错误码参考](docs/ats-API契约与错误码参考-v1.0.md)；任务实时状态与验收证据以 `.awr/intake/work-ledger.yaml` 和 `docs/verification/` 为准。完整需求边界见 [功能需求文档](docs/ats-功能需求文档-v1.2.md)、[PRD](docs/ats-PRD-v1.0.md) 与[实施路线图](docs/ats-项目目标与实施路线图-v1.0.md)。
