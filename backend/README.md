# Backend

## 技术栈

- NestJS + TypeScript
- Prisma + MySQL 8
- BullMQ + Redis 7
- Vitest / Supertest

## 本地运行

在仓库根目录安装前后端依赖，并复制无真实密钥的环境模板：

```powershell
npm ci
npm ci --prefix backend
Copy-Item backend/.env.example backend/.env
```

编辑 `backend/.env`，填入本机 MySQL 密码、至少 32 字节的随机 `JWT_ACCESS_SECRET`、`REFRESH_TOKEN_PEPPER` 和 `INITIAL_ADMIN_SECRET`。首次启动先创建空库 `talentflow` 并启动 MySQL、Redis，然后初始化：

```powershell
npm run db:setup
```

`db:setup` 会应用迁移并写入默认权限、`ADMIN`、`RECRUITER`、`HIRING_MANAGER` 和 `INTERVIEWER` 角色，不创建任何用户。使用配置的 `INITIAL_ADMIN_SECRET` 调用 `POST /api/v1/auth/bootstrap` 一次性创建管理员，提交成功后从运行环境移除该初始化密钥。此接口由数据库唯一标记保护，重复或并发初始化会被拒绝。示例请求体：

```json
{
  "setupToken": "${INITIAL_ADMIN_SECRET}",
  "displayName": "系统管理员",
  "identityProvider": "DINGTALK",
  "identitySubject": "已核验的钉钉用户 ID"
}
```

ATS-004 提供钉钉身份映射，不含钉钉 OAuth 授权码交换流程；正式登录接入在 ATS-017。开发时如需本地登录，显式设置 `APP_ENV=local`、`LOCAL_AUTH_ENABLED=true` 和 `LOCAL_AUTH_SECRET`。生产环境不能启用本地身份适配。默认角色不会获得候选人联系方式授权；管理员通过 `/api/v1/authz/field-grants` 按用户或用户组授予独立的读取/写入权限及有效期。

受保护 API 使用 `Authorization: Bearer <accessToken>`。访问令牌默认 15 分钟；刷新令牌通过 HttpOnly Cookie 轮换，数据库只保存其 HMAC 哈希。管理员可通过 `/api/v1/authz` 管理用户、角色、部门、用户组和字段授权，通过 `/api/v1/audit-logs` 查询或导出审计记录。

Web、API、解析 Worker 分别运行在三个终端：

```powershell
npm run dev:web
npm run dev:api
npm run dev:worker
```

API 和 Worker 使用独立进程；API 不消费解析队列。生产启动命令分别为 `npm --prefix backend run start:prod` 和 `npm --prefix backend run start:worker`。

## 数据库迁移

迁移历史保存在 `prisma/migrations`。修改 Schema 后使用 `npm run db:migrate` 创建并应用新迁移；已提交迁移不可覆盖或编辑。CI 和部署使用 `npm run db:migrate:deploy`，空数据库可用 `npm run db:setup` 重复初始化。

此前通过 `prisma db push` 建立、但没有迁移历史的数据库需要先备份并比较实际结构。只有数据库结构与 `20261113000000_initial` 完全一致时，才可登记迁移基线：

```powershell
Set-Location backend
npx prisma migrate resolve --applied 20261113000000_initial --schema prisma/schema.prisma
Set-Location ..
```

未核对的已有数据库不要直接运行 `db:setup` 或 `db:migrate:deploy`，因为首个迁移会创建全部表。

## 质量门禁

```powershell
npm run typecheck --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run test:e2e --prefix backend
npm run build:api
```

GitHub Actions 使用临时 MySQL 8 和 Redis 7 执行 Schema 校验、迁移、类型检查、Lint、单元/API 测试、前后端构建及 Gitleaks 密钥扫描。当前仓库尚未包含浏览器扩展工程。
