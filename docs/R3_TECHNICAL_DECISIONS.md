# R3 技术决策：Cloudflare D1 账号、数据库与云同步

> 状态：已批准，v5.0.0 正式发布验收完成
> 批准日期：2026-08-10
> 实施状态更新：2026-08-11
> 目标版本：v5.0.0
> 使用规模：最多约 15 人私下使用
> 前提：P0 已验收，v4.0.0 本地事件与快照格式保持兼容

## 0. 当前实施快照

截至 2026-08-11：

- 已完成 Worker 与现有前端的同源构建、`/api/health`、D1 binding、可观测性及 local/preview/production 三套隔离配置。
- 已建立 18 张 D1 表、2 个可重复执行的迁移，并在本地、预览和生产空库完成结构校验。
- 已完成注册、登录、当前会话、退出、修改密码和资料更新 API，以及管理员本地重置密码命令。
- D1 只保存密码和会话 HMAC 摘要；Cookie 使用 `Secure; HttpOnly; SameSite=Lax`，写接口执行严格同源 Origin 校验。
- 已完成注册/登录限流、最小化认证审计、最多 10 个会话以及修改密码撤销其他会话。
- 共 91 个自动测试通过，其中 20 个为真实 Worker+D1 集成测试；桌面和移动端 24 项 E2E、lint、构建与仓库/构建产物秘密扫描通过。
- 预览 Worker 已部署，三个真实 Secret、远程 D1 迁移、健康检查、账号、幂等迁移和 A/B 授权冒烟均已验收；冒烟账号及关联数据已清理。
- 统一业务授权、本地迁移、持久离线队列、自动补传、显式接管、账号前端、导出删除和定时清理均已完成；预览版本 `9b186551-f875-4e28-9dce-e6b9aa340f15` 已验收。
- 生产 Worker `hei8-r3-production` 已部署，三个生产 Secret 已独立配置；生产 D1 迁移、健康检查、匿名权限、错误邀请码和发布包能力冒烟均已通过。真实邀请码账号灰度与生产备份恢复演练已由产品负责人验收。球友/认领属于后续独立功能切片，不阻塞本次账号与单主写同步正式版。

主要实施入口：

- `worker/auth/api.ts`：账号 HTTP API 与 D1 事务。
- `worker/auth/core.ts`：用户名、密码、HMAC、会话令牌与 Cookie 工具。
- `worker/auth/api.integration.test.ts`：真实 Worker+D1 集成测试。
- `scripts/reset-password.mjs`：管理员密码重置命令。
- `db/schema.ts` 与 `migrations/`：D1 结构和迁移。

## 1. 最终结论

R3 采用一套小规模、低成本、容易维护的 Cloudflare 原生方案：

- 使用 Cloudflare Worker 承载静态页面和 `/api/*`。
- 使用 Cloudflare D1 免费数据库保存账号、会话和业务数据。
- 不使用 Supabase，不使用 Better Auth，不接第三方身份服务。
- 每名用户使用独立的“用户名 + 密码”。
- 密码不保存明文，D1 只保存 HMAC-SHA256 摘要。
- 不收集邮箱、不验证邮箱、不发送邮件。
- 不开放普通注册；注册必须填写固定邀请码。
- 固定邀请码永不过期、可重复使用，服务端直接与 Worker Secret 比较。
- 服务端登录会话不设置时间或不活跃过期，只在明确撤销时失效。
- 账号、对局、预设、牌组和球友数据不会因为长期不登录而自动清除。
- 游客仍可不登录完成、保存和恢复对局。
- 登录后不会自动上传本机数据，用户必须明确确认迁移。
- 所有账号数据默认私有，不提供陌生人搜索、公共排行榜或公开动态。

本方案以“15 人私下使用、免费优先、功能简单”为边界，不按金融、企业或公共开放平台注册系统设计。

## 2. 系统架构

```text
浏览器
  ├─ React 静态页面
  ├─ 游客 localStorage
  └─ 同源 /api/* + HttpOnly Session Cookie
        ↓
Cloudflare Worker
  ├─ 固定邀请码校验
  ├─ HMAC-SHA256 用户名密码认证
  ├─ 会话创建与恢复
  ├─ 业务授权
  ├─ 本地迁移与幂等同步 API
  └─ D1 binding
        ↓
Cloudflare D1
  ├─ users / sessions / profiles
  ├─ contacts / presets / decks
  ├─ matches / players / events
  └─ claims / audit / sync receipts
```

v5 正式入口由同一个 Cloudflare Worker 同时提供页面和 API。这样可以使用 `Secure; HttpOnly; SameSite=Lax` Cookie，不需要把长期会话令牌放入 `localStorage`，也没有跨站 Cookie 和 CORS 复杂度。

现有 Vercel 静态构建继续保留，职责为：

- 无账号版本预览。
- Cloudflare 故障时的游客模式回滚入口。
- 不连接 D1，不提供账号与同步功能。

## 3. 免费额度评估

截至 2026-08-10，Cloudflare Free 主要限制为：

| 项目 | 免费额度/限制 | 15 人使用判断 |
| --- | --- | --- |
| Worker 动态请求 | 100,000 次/天 | 充足；平均每人约 6,666 次/天 |
| Worker CPU | 10 ms/次请求 | HMAC-SHA256 很轻，预计可稳定满足 |
| D1 行读取 | 5,000,000 行/天 | 充足；所有高频查询必须建索引 |
| D1 行写入 | 100,000 行/天 | 充足；事件与同步回执仍需控制写放大 |
| D1 单库大小 | 500 MB | 预计可保存数年私用数据，需监控快照体积 |
| D1 账户总存储 | 5 GB | 当前只使用一个生产库，充足 |
| D1 Time Travel | 7 天 | 作为免费灾难恢复窗口 |

容量控制规则：

- D1 使用量达到免费额度 70% 时提示管理员。
- 单库达到 350 MB 时停止保存非必要调试与过期同步记录。
- 单库达到 425 MB 时导出旧对局归档，并评估第二个 D1 数据库或 Workers Paid。
- 不为了保持免费降低数据一致性或移除必要索引。

## 4. 固定邀请码

### 4.1 存储方式

固定邀请码使用 Cloudflare Worker Secret：

```text
REGISTRATION_INVITE_CODE
```

生产邀请码已由产品负责人指定。具体明文只通过 Cloudflare Secret 的交互式输入设置，不在本文、源码或 Git 中重复记录。设置命令：

```powershell
npx wrangler secret put REGISTRATION_INVITE_CODE
```

规则：

- 永不过期。
- 不限制成功注册次数。
- 不写入 D1。
- 不做哈希或加密后比对。
- Worker 直接比较 `env.REGISTRATION_INVITE_CODE === submittedCode`。
- 不写入源码、Git、前端构建、普通 `vars` 或日志。
- 本地开发值放在被 Git 忽略的 `.dev.vars`，不得复用生产邀请码。
- 管理员更新 Worker Secret 后，旧邀请码立即失效。

### 4.2 注册边界

- 只开放 `POST /api/auth/register`。
- 服务端必须校验邀请码，前端显示或隐藏注册按钮不属于安全控制。
- 邀请码错误时只返回“邀请码无效”。
- 注册审计只记录成功/失败、时间和请求 ID，不记录邀请码正文。

## 5. 用户名与密码

### 5.1 用户名

- 规范化为小写后唯一，登录不区分大小写。
- 长度 4–24 个字符。
- 只允许 ASCII 字母、数字和下划线。
- 禁止 `admin`、`root`、`system`、`support` 等保留名称。
- 用户名首版不可修改。
- 昵称与用户名分离，昵称可以修改且不影响历史关联。

### 5.2 密码输入

- 每名用户设置自己的密码。
- 长度 6–64 个字符。
- 界面不要求邮箱、手机号或安全问题。
- 密码正文只存在于当前注册/登录请求内。
- 密码、摘要和完整会话令牌不得进入日志、错误信息或审计详情。

### 5.3 HMAC-SHA256 摘要

Worker 使用原生 Web Crypto 计算：

```text
password_digest = HMAC-SHA256(
  PASSWORD_HMAC_KEY,
  "password-v1\0" + normalized_username + "\0" + password
)
```

其中：

- `PASSWORD_HMAC_KEY` 是独立的 Cloudflare Worker Secret。
- D1 只保存固定编码的 `password_digest` 和 `password_version = 1`。
- 注册时计算一次摘要并保存。
- 登录时重新计算摘要并使用定时安全比较。
- 用户名加入 HMAC 消息，避免不同用户的相同密码得到相同摘要。
- HMAC 使用 Cloudflare 原生 `crypto.subtle`，不引入密码哈希第三方依赖。

已接受的安全权衡：HMAC-SHA256 是快速摘要，不像 `scrypt` 或 Argon2 那样专门抵抗密码暴力破解。如果 D1 与 `PASSWORD_HMAC_KEY` 同时泄露，弱密码可能被离线猜测。产品负责人已基于“最多约 15 人私下使用、不涉及钱财、免费和简单优先”接受此权衡。

`PASSWORD_HMAC_KEY` 更换后，旧密码摘要无法继续验证。首版处理方式是管理员为用户重置密码，不实现多版本密钥轮换。

## 6. 注册、登录和密码管理

### 6.1 注册流程

1. 校验请求方法、同源 Origin、内容类型和请求体大小。
2. 规范化用户名并校验格式、长度、保留词。
3. 直接比较提交的邀请码与 `REGISTRATION_INVITE_CODE`。
4. 检查规范化用户名是否已存在。
5. 使用 `PASSWORD_HMAC_KEY` 计算密码摘要。
6. 在 D1 batch 中创建 `users`、`profiles` 和注册审计记录。
7. 创建会话，设置 HttpOnly Cookie。
8. 返回用户 ID、用户名、昵称和会话状态，不返回密码摘要。

### 6.2 登录流程

1. 规范化用户名。
2. 通过唯一索引读取用户。
3. 使用提交的用户名和密码重新计算 HMAC-SHA256。
4. 定时安全比较摘要。
5. 成功后创建新会话并设置 Cookie。
6. 失败统一返回“用户名或密码错误”。

### 6.3 修改密码

- 已登录用户输入当前密码和新密码。
- 当前密码验证成功后保存新 HMAC 摘要。
- 修改成功后撤销该用户其他全部会话。
- 当前设备获得一枚新会话 Cookie。

### 6.4 忘记密码

由于不收集邮箱，首版不提供自助找回：

1. 用户线下联系管理员。
2. 管理员使用本地管理命令为指定用户名设置新密码。
3. Worker/管理脚本计算新的 HMAC 摘要并更新 D1。
4. 同时撤销该用户全部旧会话。
5. 审计记录只写“管理员重置密码”，不保存新密码。

固定注册邀请码不能用于重置已有账号密码。

## 7. 会话

### 7.1 会话令牌

- 登录成功后生成至少 32 字节安全随机令牌。
- 浏览器通过 `Secure; HttpOnly; SameSite=Lax; Path=/` Cookie 保存原始令牌。
- D1 不保存原始令牌，只保存 HMAC-SHA256 会话摘要。
- 会话摘要使用独立的 `SESSION_HMAC_KEY` Worker Secret。
- 服务端收到 Cookie 后计算摘要，并通过唯一索引查询会话。

### 7.2 生命周期

- 服务端会话不设置固定到期时间，也不因长期不活跃自动失效。
- Cookie 设置为持久 Cookie，并使用浏览器允许的长期 `Max-Age`。
- 浏览器或用户仍可能主动清除 Cookie；此时只需要重新登录，D1 数据不会受影响。
- 退出登录立即删除当前会话。
- 修改密码、管理员重置密码或删除账号时撤销该用户全部会话。
- 每个用户最多保留 10 个有效会话，超出时删除最旧会话。

## 8. 数据权威来源

| 数据状态 | 权威来源 | 设备角色 |
| --- | --- | --- |
| 未登录游客数据 | 当前设备 localStorage | 唯一副本，继续支持离线保存与恢复 |
| 登录但未迁移的旧数据 | 当前设备 localStorage | 用户确认前绝不上传 |
| 正在迁移的数据 | 本地备份 + 迁移清单 | 服务端校验前不得标记完成 |
| 已同步资料、预设、牌组和完成对局 | D1 | 本机是缓存和待同步队列 |
| 进行中的账号对局 | 持有写入租约的主设备事件日志 | D1 保存已确认事件和租约 |
| 已完成对局 | D1 不可变事件和快照 | 授权设备只读，纠错追加新事件 |

## 9. D1 数据模型

### 9.1 账号与会话

| 表 | 关键字段与职责 |
| --- | --- |
| `users` | `id`、`normalized_username`、`display_username`、`password_digest`、`password_version`、状态和时间戳 |
| `sessions` | `id`、`user_id`、`token_digest`、创建、最后使用和撤销时间；无时间到期字段 |
| `profiles` | `user_id`、公开用户编号、昵称、头像和删除状态 |
| `auth_audit_events` | 用户、动作、请求 ID、时间和最小元数据；仅追加 |

约束与索引：

- `users(normalized_username)` 唯一。
- `profiles(public_code)` 唯一。
- `sessions(token_digest)` 唯一。
- `sessions(user_id, revoked_at, last_used_at)`。
- 所有用户外键使用稳定 UUID，不使用用户名或昵称。

### 9.2 球友、预设与牌组

| 表 | 关键字段与职责 |
| --- | --- |
| `player_contacts` | 所有者、联系人、状态、来源和最近共同对局时间 |
| `player_invites` | 添加球友令牌摘要、创建人、使用和撤销时间 |
| `score_presets` | 所有者、名称、规则 JSON、版本和软删除时间 |
| `decks` | 所有者、名称、可见性和当前版本 |
| `deck_versions` | 不可变牌组快照、版本号、校验和与创建时间 |
| `deck_cards` | 牌组版本、卡牌定义/实例、顺序和数量 |

### 9.3 对局、事件与同步

| 表 | 关键字段与职责 |
| --- | --- |
| `devices` | 用户、设备 ID、名称、最后在线时间和撤销状态 |
| `matches` | 房主、模式、状态、隐私、版本、主设备租约、起止时间和快照校验和 |
| `match_players` | 稳定参与位、对局、可空用户 ID、昵称快照、加入/离场时间 |
| `score_events` | 事件 ID、操作 ID、序号、分数变化、更正关系和发生时间 |
| `card_events` | 事件 ID、操作 ID、序号、卡实例快照和关联计分事件 |
| `match_audit_events` | 对局、操作者、动作、原因和前后版本摘要；仅追加 |
| `match_claims` | 临时参与位、申请用户、房主审核和状态 |
| `sync_receipts` | 用户、设备、操作 ID、确认结果和接收时间 |

关键索引：

- `player_contacts(owner_user_id, last_played_at desc)`。
- `match_players(user_id, match_id)`。
- `matches(owner_user_id, ended_at desc)`。
- `score_events(match_id, sequence_no)` 唯一。
- `card_events(match_id, sequence_no)` 唯一。
- `sync_receipts(user_id, operation_id)` 唯一。
- `match_claims(claimant_user_id, status, created_at)`。

## 10. Worker 授权模型

D1 没有 Postgres RLS，因此 Worker 是唯一数据库入口：

- 浏览器永远不能获得 D1 API Token。
- 浏览器不能直接查询或修改 D1。
- 用户 ID 必须从会话推导，忽略客户端提交的 `actor_user_id`。
- 所有 SQL 使用准备语句和绑定参数。
- 每次读取都在 SQL 条件中限制所有者或已绑定参与者。
- 每次写入都检查资源所有权、版本、对局状态和主设备租约。

| 资源 | 所有者/房主 | 已绑定参赛账号 | 其他登录用户 |
| --- | --- | --- | --- |
| 资料 | 读写自己 | 只读公开字段 | 仅凭精确公开编号或邀请读取公开字段 |
| 球友关系 | 读写自己的一侧 | 只读与自己相关状态 | 无权限 |
| 私有预设/牌组 | 完整读写 | 无，除非显式分享 | 无权限 |
| 对局 | 读；持租约时写 | 只读已授权对局 | 无权限 |
| 对局事件 | 房主仅追加 | 只读已授权事件 | 无权限 |
| 战绩认领 | 审核自己房间申请 | 创建/撤销自己的申请 | 无权限 |

默认隐私：

- 战绩私有，仅房主和已绑定参赛账号可读。
- 球友列表仅本人可读。
- 自定义牌组私有，分享必须显式开启。
- 邮箱不存在，也不存在可公开的联系方式。

## 11. 本地迁移与离线同步

### 11.1 迁移

1. 用户登录后显示本机对局、预设和牌组数量。
2. 用户明确选择是否上传以及上传哪些类型。
3. 迁移前生成完整 JSON 备份和校验和。
4. 每个资源使用原有稳定 ID 或生成一次后持久化的新 UUID。
5. 上传携带 `operation_id`，重复请求返回同一结果。
6. 服务端返回数量和校验和摘要。
7. 客户端校验成功后才写入迁移完成标记。
8. 失败、取消或断网始终保留旧数据和备份。

### 11.2 离线队列

- 本地持久化队列按资源和 `sequence_no` 排序。
- 恢复网络后按顺序批量提交。
- 服务端以 `(user_id, operation_id)` 唯一约束保证幂等。
- 客户端只删除服务端已确认的队列项。
- 失败项保留并指数退避，允许用户手动重试。

### 11.3 单主写设备

- 进行中对局只有持有有效租约的主设备可以提交事件。
- 其他设备只读云端已确认状态。
- 租约到期后可由房主在另一设备接管。
- 缺号、乱序或旧版本写入被拒绝。
- 无法自动解决的冲突展示本机/云端差异，由房主选择版本。
- 未选版本保留为恢复快照，不静默删除。

## 12. 删除、导出与保留

- 账号和用户内容不会因为 30 天或更长时间未登录而删除。
- 用户资料、预设、牌组、对局、玩家关系和历史事件默认永久保留，直到用户或管理员明确删除。
- 用户可导出一份 JSON，包含资料、预设、牌组、本人拥有的对局和事件。
- 删除账号时立即撤销全部会话。
- 本人独有资料、预设和牌组删除。
- 多人共享对局为其他参与者保留，但解除被删除账号的用户关联并显示“已删除玩家”。
- `sync_receipts` 保留 30 天后清理。
- 账号与对局审计保留 180 天后清理。
- D1 Free Time Travel 提供 7 天恢复窗口。
- 正式数据库每月额外导出一次加密逻辑备份，保留最近 3 份。

`sync_receipts`、审计和 Time Travel 的期限只针对运行记录与备份历史，不会删除用户的账号、对局或其他业务数据。

## 13. 实施流程

### 阶段 1：Cloudflare 同源运行时与 D1 骨架（预览验收完成）

1. [x] 配置 Worker Static Assets、`/api/*` 优先路由和 D1 binding。
2. [x] 建立 local、preview、production 三套隔离配置。
3. [x] 建立可重复执行的 Drizzle/D1 migrations。
4. [x] 配置 preview 的真实 `REGISTRATION_INVITE_CODE`、`PASSWORD_HMAC_KEY`、`SESSION_HMAC_KEY` Secrets。
5. [x] 生产发布前单独配置 production 的三个真实 Secret。
6. [x] 增加仓库和构建产物秘密扫描。

验收状态：本地游客页面和 `/api/health` 同源可用；三套 D1 结构已校验；秘密扫描通过。预览与生产 Worker、各自真实 Secret、远程迁移与自动化 API 冒烟均已完成。

### 阶段 2：轻量账号闭环（后端完成）

1. [x] 实现用户名规范化和 HMAC-SHA256 工具。
2. [x] 实现固定邀请码注册。
3. [x] 实现登录、会话恢复和退出。
4. [x] 实现修改密码和管理员重置密码命令。
5. [x] 实现资料、昵称和公开编号。
6. [x] 添加注册、登录、会话、密码、资料、限流和跨账号场景测试。

验收状态：已通过本地真实 Worker+D1 集成测试。错误邀请码无法注册；正确邀请码可注册不同账号；D1 不含明文密码和原始会话令牌；更改昵称不影响用户 ID 或公开编号。

### 阶段 3：业务表与授权（本地后端完成）

1. [x] 建立球友、预设、牌组、对局、事件、认领和同步表。
2. [x] 建立统一 `requireSession`、`requireMatchRead`、`requireMatchWriteLease` 授权函数。
3. [x] 使用账号 A、账号 B 和匿名用户覆盖现有业务 API 的读取、修改、枚举和 ID 猜测越权路径。
4. [x] 为用户历史、球友、对局详情和同步查询验证索引使用情况。

验收状态：本地 Worker+D1 授权集成测试与预览远程冒烟通过；未授权读取和修改失败，参与者只读，所有用户身份由服务端会话推导。对局创建和计分事件写入已覆盖 `operation_id` 幂等、`expected_version` 条件更新、主写租约和追加式事件约束。

### 阶段 4：本地迁移

1. [x] 抽离当前 `localStorage` 访问为版本化存储适配器。
2. [x] 实现迁移预览、用户确认、本机备份和校验和。
3. [x] 实现账号分域稳定 ID、幂等批量上传和服务端校验。
4. [x] 覆盖成功、断网、重复提交、部分失败和取消测试。

验收：任何迁移失败都不会覆盖或删除原始本地数据。

### 阶段 5：离线同步与单主写（完成）

1. [x] 建立持久化操作队列。
2. [x] 实现对局主设备租约和显式接管。
3. [x] 实现按序同步、幂等确认、指数退避和手动重试。
4. [x] 实现冲突停止、只读恢复和强制刷新提示；不自动合并多设备离线修改。

验收：断网、刷新、重复请求、乱序请求和设备接管不会丢失或重复事件。

### 阶段 6：球友、邀请与认领

1. 实现添加球友邀请链接和二维码。
2. 实现注册玩家和临时玩家混合组局。
3. 实现临时参与位战绩认领及房主审核。
4. 保留不可变认领审计。

验收：错误账号不能认领他人战绩；取消球友不删除历史对局。

### 阶段 7：导出、删除和发布验收（生产自动化验收完成，待人工收口）

1. [x] 实现 JSON 数据导出和密码确认账号删除。
2. [x] 实现已撤销会话、同步回执和审计定时清理。
3. [x] 完成生产备份恢复演练（产品负责人已验收）。
4. [x] 运行单元测试、授权集成测试、桌面 E2E 和移动端 E2E。
5. [x] 部署并验收预览候选；[x] 部署生产候选并完成自动化冒烟；[x] 使用真实邀请码进行内部账号灰度。

验收：路线图 R3 验收标准全部通过，且完成一次账号删除、D1 恢复和离线冲突演练。

## 14. 明确不做

- Supabase、Postgres RLS 或第三方 Auth 服务。
- 邮箱、邮箱验证、邮件找回密码。
- 公开注册或一次性注册邀请码系统。
- `scrypt`、Argon2、bcrypt 等慢密码哈希。
- 明文密码存储。
- 浏览器直接访问 D1。
- 浏览器 `localStorage` 保存长期登录令牌。
- 进行中对局实时多人共同编辑。
- 陌生人模糊搜索、公共排行榜、公开动态和评论。

## 15. 官方资料依据

- [Cloudflare D1 概览](https://developers.cloudflare.com/d1/)
- [Cloudflare D1 免费与付费额度](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 平台限制](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers 价格](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
