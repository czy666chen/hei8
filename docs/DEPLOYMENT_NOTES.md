# 部署注意事项（Cloudflare Workers + D1）

> 本文档基于 2026-08-16 生产部署（`taiqiu-qizhao-cards`，v5.1.2 云端直创建 + 房主踢人）的实际操作整理。
> 目标是让下一次部署（无论预览还是生产）可以按清单执行，并避开已踩过的坑。

## 1. 环境与资源现状

| 环境 | Worker 名称 | D1 数据库 | 状态 |
| --- | --- | --- | --- |
| production | `taiqiu-qizhao-cards` | `hei8-r3-production-v2`（2026-08-16 起） | 在用 |
| preview | `hei8-r3-preview` | `hei8-r3-preview` | 已删除（2026-08-16） |
| local | `hei8-r3-local` | 本地模拟（`--local`） | 不在云端 |

- Worker 配置在 `wrangler.jsonc`，生产环境使用 `env.production` 段。
- 生产 secrets：`PASSWORD_HMAC_KEY`、`SESSION_HMAC_KEY`、`REGISTRATION_INVITE_CODE`，通过 `wrangler secret list --env production` 查看。
- D1 迁移目录：`migrations/`，由 wrangler 按文件名数字前缀顺序应用。

## 2. 部署前置检查（每次部署必做）

```bash
# 1. 登录状态与权限（需要 workers:write、d1:write）
npx wrangler whoami

# 2. 生产 secrets 必须存在（缺一个会导致 auth 接口 500）
npx wrangler secret list --env production

# 3. 确认当前线上版本
npx wrangler deployments list --env production

# 4. 检查待应用迁移
npx wrangler d1 migrations list DB --remote --env production
```

> ⚠️ secrets 只在首次部署前需要 `wrangler secret put`；后续 `wrangler deploy` **不会清除**已有 secrets，不要重复设置。
> 若 secrets 内容变更（尤其 `PASSWORD_HMAC_KEY`），所有已注册用户将无法登录，必须视为破坏性操作。

## 3. 构建与部署

```bash
# 生产
npm run build:production        # vinext build，产物到 dist/client
npx wrangler deploy --env production

# 预览（如日后重建 preview 环境）
npm run build:preview
npx wrangler deploy --env preview
```

- 部署成功标志：输出 `Deployed taiqiu-qizhao-cards` 与 `Current Version ID`。
- `wrangler deploy` 会同时上传 `dist/client` 静态资源并更新 Durable Object 迁移标签。
- 自定义域名/路由在 Cloudflare 控制台配置，与 Worker 部署相互独立。

## 4. D1 迁移——最容易踩的坑

### 4.1 核心事实：D1 无法关闭外键检查

- D1 的外键约束由**触发器**实现，`PRAGMA foreign_keys=OFF` **无效**（实测同一请求内执行后仍为 ON）。
- 因此任何涉及 `DROP TABLE` 被引用父表的重建型迁移（如 `0005` 重建 `users` 表），在**有真实数据**的库上必然失败：
  `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_TRIGGER [code: 7500]`。
- 空库（如全新 preview、刚创建的新库）不受影响，可以正常执行此类迁移。

### 4.2 迁移失败的判定

```bash
npm run db:migrate:production   # 脚本内硬编码旧库名，见下方注意事项
# 推荐直接用绑定名：
npx wrangler d1 migrations apply DB --remote --env production
```

- 若报 `FOREIGN KEY constraint failed` 且迁移列表停在某个重建表（如 `0005`），不要反复重试——先判断库里是否有真实数据。
- 生产库从 `0004` 直接跳到 `0006` 的场景，就是这种「旧库有数据 + 新迁移重建父表」的经典冲突。

### 4.3 迁移脚本注意

- `package.json` 的 `db:migrate:production` 硬编码了旧库名 `hei8-r3-production`：
  `wrangler d1 migrations apply hei8-r3-production --remote --env production`
- 库名切换后该脚本会报 `Couldn't find a D1 DB with the name or binding`。**优先使用绑定名 `DB`**（`wrangler.jsonc` 中 `env.production.d1_databases[0].binding` 固定为 `DB`），这样换库无需改脚本。

## 5. 换库方案：复制数据库（数据不变 + 迁移成功）

当旧库有数据且无法原地迁移时，用「新库 + 全量迁移 + 数据导入」替代原地迁移：

```bash
# 1. 导出旧库数据（仅数据，不含 schema）
npx wrangler d1 export hei8-r3-production --remote --no-schema --output prod-data.sql -y

# 2. 创建新库
npx wrangler d1 create hei8-r3-production-v2

# 3. 修改 wrangler.jsonc：env.production.d1_databases[0] 的 database_name / database_id 指向新库
#    （改前先备份：Copy-Item wrangler.jsonc wrangler.jsonc.bak-YYYYMMDD）

# 4. 空库跑全量迁移（0000–0006 全绿，0005 重建 users 表在空库无 FK 问题）
npx wrangler d1 migrations apply DB --remote --env production

# 5. 处理导出文件（见 5.1）后导入数据
npx wrangler d1 execute hei8-r3-production-v2 --remote --file prod-data-ordered.sql

# 6. 验证新旧库数据一致（见 5.2），再部署 Worker
```

### 5.1 导出文件的处理（必须）

1. **删除 `d1_migrations` 的 INSERT**：新库迁移后已有自己的迁移记录，导入旧记录会冲突。
   正则替换：`(?m)^INSERT INTO "d1_migrations".*$\n` → 空。
2. **删除 `sqlite_sequence` 的 INSERT**：D1 内部表，迁移自行维护。
3. **按外键依赖顺序重排 INSERT**：D1 忽略文件头 `PRAGMA defer_foreign_keys=TRUE;`，
   若父表行晚于子表行导入，会报 `SQLITE_CONSTRAINT_FOREIGNKEY` 且整个库回滚。
   正确顺序（以当前 schema 为例）：
   `users → auth_audit_events → devices → profiles → sessions → score_presets → decks → deck_versions → matches → match_players → realtime_rooms → sync_receipts`
   （`matches` 引用 `users`/`devices`；`match_players`/`realtime_rooms` 引用 `matches`；`sync_receipts` 引用 `users`/`devices`。）

### 5.2 导入后一致性验证

```bash
npx wrangler d1 execute hei8-r3-production-v2 --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM matches) AS matches, (SELECT COUNT(*) FROM match_players) AS mp, (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM profiles) AS profiles, (SELECT COUNT(*) FROM realtime_rooms) AS rooms;"
```
与旧库逐表 COUNT 对比，必须完全一致。另抽查 schema 关键点：
- `PRAGMA table_info(match_players)` 应含 `kicked_at`、`kicked_by_user_id`；
- `users` 的 `users_username_format_ck` 应为 `between 3 and 24`（0005 目标）。

## 6. 部署后验证

```bash
# 健康检查
curl https://<worker>.<subdomain>.workers.dev/api/health   # 期望 {"status":"ok","database":"ok"}

# 无 Cookie 访问业务接口，期望 401（说明 auth 中间件在工作）
curl -i https://<worker>.<subdomain>.workers.dev/api/history
```

> ⚠️ 部分网络环境（如某些公司/家庭网络）会拦截对 `*.workers.dev` 的 443 连接
> （DNS 正常解析、TCP 握手超时、curl 报 `HTTP 000` / `Could not connect`）。
> 这**不代表部署失败**，请在能访问 workers.dev 的网络下验证，或通过 Cloudflare 控制台确认版本已上线。

## 7. 回滚方案

- **代码回滚**：`npx wrangler rollback --env production` 回退到上一个部署版本。
- **数据库回滚**：保留旧库 `hei8-r3-production`（未删除）；把 `wrangler.jsonc` 的
  `database_name`/`database_id` 改回旧库后重新 `wrangler deploy`。
- 部署前务必备份 `wrangler.jsonc`（`Copy-Item wrangler.jsonc wrangler.jsonc.bak-YYYYMMDD`）。

## 8. Worker 清理

- 删除 Worker 不可恢复：`npx wrangler delete --name <name>`（交互确认，非交互环境自动确认）。
- 删除前用 API 确认目标（列出全部 Worker）：
  ```powershell
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts" -Headers @{ Authorization = "Bearer <OAUTH_TOKEN>" }
  $r.result | Select-Object id
  ```
- 注意：`wrangler.jsonc` 中 `env.local` 的 Worker 名 `hei8-r3-local` 只是本地配置，云端不存在，无需删除。

## 9. 变更记录（2026-08-16）

- 生产部署 v5.1.2 特性（云端直创建房间、房主踢人/解除限制/移除临时选手）。
- 生产 D1 由 `hei8-r3-production` 切换到 `hei8-r3-production-v2`（原因：0005 迁移在有数据旧库上受外键触发器阻塞；方案：新库全量迁移 + 重排数据导入，数据逐表验证一致）。
- 删除预览 Worker `hei8-r3-preview`。
