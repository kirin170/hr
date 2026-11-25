# TalentFlow 浏览器导入扩展（ATS-011 第一阶段）

**当前只交付平台无关部分。BOSS 直聘与猎聘适配器未交付。**

## 已交付

| 能力 | 位置 |
| --- | --- |
| MV3 骨架、最小权限 | `manifest.json`（只申请 `storage` + `activeTab`） |
| 短期系统令牌授权 / 续期 / 撤销 | `src/api.js` |
| 用户主动点击才导入 | `src/popup.js` → `src/background.js` |
| 对接 ATS-010 导入 API（multipart、requestId 幂等、任务查询） | `src/api.js` |
| 标准错误码 → 用户反馈与下一步动作 | `src/errors.js` |
| 适配器接口契约、独立开关、版本、灰度、回滚 | `src/adapters/registry.js` |
| 本地夹具页与自测 | `test/` |

## 明确未交付

- **BOSS 直聘适配器**、**猎聘适配器**：缺脱敏页面样本，`manifest.json` 也**没有预先申请这两个站点的域名权限**。
- **企业分发方案**：Chrome 商店私有发布 / 企业策略强制安装 / 开发者模式加载尚未确定，`host_permissions` 与更新通道要按最终方案调整。
- **真实浏览器加载运行**：本轮验证工具不支持加载未打包扩展，未在 Chrome/Edge 中实际装载运行过。

注册表里目前只有 `fixture.local` 一个**测试夹具**适配器，`resolve()` 对真实平台一律返回 `null`，调用方必须显式提示"该站点尚未支持"，**不得回落到猜测页面结构**。

## 安全边界

- 只持有 TalentFlow 的短期系统令牌，放在 `chrome.storage.session`，浏览器关闭即失效；不写 `storage.local`、不写 `localStorage`。
- 不读取 `document.cookie`，不使用 `chrome.cookies`，不保存任何招聘网站账号信息。
- 附件由扩展自己取字节后 multipart 上传（`credentials: 'omit'`），**不把 URL 交给服务端下载**。
- 来源页面只上报协议 + 主机，路径与查询串不出扩展。
- 内容脚本加载本身不创建任务；`background.js` 不监听 `tabs.onUpdated` / `onActivated` / 导航事件。

以上边界由 `test/boundaries.test.mjs` 逐条断言，改动破坏边界会让测试失败。

## 授权方式

在 TalentFlow「管理后台 → 接入配置 → 导入令牌」签发短期令牌，粘贴进扩展 popup。
系统令牌默认 30 分钟有效且**没有 refresh 端点**：过期后需重新签发；持有登录会话时可用 `renew()` 续期。
撤销会先清本地，再在提供登录会话时调用服务端吊销本人全部令牌。

## 自测

```bash
node --test "extension/test/*.test.mjs"
```

接口层端到端（需要隔离库上的 API 与本地夹具页）：

```bash
node extension/test/serve-fixture.mjs
node extension/test/e2e-api.mjs
```

`e2e-api.mjs` 用扩展自己的 `api.js` 打真实后端，覆盖签发令牌、拉职位、取附件字节、
建任务、同 requestId 幂等重放、任务查询、URL 脱敏、错误码反馈、吊销后立即失效。

## 装载方式（开发用）

Chrome / Edge → 扩展程序 → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。
`host_permissions` 与内容脚本目前指向本地 `127.0.0.1:3100`（API）与 `127.0.0.1:4174`（夹具页），
接真实环境前必须按分发方案改配置。