# 多人实时房间全屏化改造路线图

更新时间：2026-08-17

当前状态：**核心改造已完成并通过验证**（阶段 1–3 已落地；阶段 4 的 tsc 类型检查、77 项单元测试、54 项 Worker 集成测试、30 项 Playwright e2e 全部通过，其中含本改造配套新增的 `e2e/room-fullscreen.spec.ts` 3 条用例 × 桌面/移动；等待真人登录态的实时对局手工回归与前端部署）

关联文档：[ROADMAP_REMAINING_WORK.md](../ROADMAP_REMAINING_WORK.md)（R4 / v5.1.0 多人实时房间已实现并部署，本文只描述前端呈现方式的改造，不涉及后端协议与 Durable Object 逻辑）

---

## 1. 背景与目标

### 1.1 现状问题

多人实时房间（`RealtimeRoomPanel`）目前以**内嵌面板**的形式出现：

- 首页 `/`：`EmptyHome` 下方、`.home-stack` 底部渲染一个小面板（`app/GameApp.tsx` 行 1852–1855）；
- “我的”页面 `/profile`：`ProfilePage` 中与云端对局、数据管理等卡片并列渲染（行 1466）。

而普通对局（`ActiveMatchView` → `.match-page`、`EightBallBoard` → `.eight-page`）是**整页全屏**呈现，占满主内容区、带顶部 live banner、大字号计分板、移动端底部 dock。

两者体验割裂：

1. 实时房间被压缩成一个带边框的小卡片，计分区、规则按钮、成员列表全部挤在窄框里，与“和本地对局同等重要的主操作界面”地位不符；
2. 进入房间后仍然停留在首页/我的页面，用户没有“进入了一个对局”的沉浸感；
3. 房间没有独立 URL，无法直接分享“房间链接”直达对局页；
4. 观战者、房主、玩家的角色体验没有按对局页的层级组织。

### 1.2 目标

> 将多人实时房间改造成与普通对局一致的全屏页面：进入房间即全屏呈现对局界面（顶部状态栏 + 主计分区 + 底部移动端 dock），不再在页面底部内嵌一个小框。

具体目标：

- 房间创建/加入入口、房间内对局两个阶段都**全屏呈现**，视觉层级对齐 `.match-page` / `.eight-page`；
- 房间拥有独立 URL（如 `/room` 入口页、`/room/:code` 房间页），支持直接打开、刷新恢复、分享链接；
- 首页“云端实时对局”卡片、设置弹窗“云端实时房间”创建成功、“我的”页面入口，一律**跳转**到全屏房间页，不再就地内嵌；
- 后端 API、WebSocket、Durable Object、事件/权限逻辑**零改动**，纯前端呈现层改造。

---

## 2. 现状分析（代码位置）

> 以下为改造前（2026-08-16）的现状快照，作为对照基线；改造后的实际代码位置与行为见第 4 节勾选项与第 8 节实现说明。

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 实时房间面板组件 | `app/GameApp.tsx` 行 1037–1398（`RealtimeRoomPanel`） | 面板容器：入口表单（创建/加入）+ 房间码卡片 + 计分面板 + 成员管理 + 操作按钮 |
| 实时追分面板 | 行 893–939（`RealtimeChasePanel`） | 选手槽、规则按钮、转账/黑金/让杆/补录、撤销 |
| 实时中八面板 | 行 941–1035（`RealtimeEightBallPanel`） | 比分、本局录入、逐局流水、更正 |
| 首页内嵌渲染 | 行 1852–1855（`.home-stack`） | `EmptyHome` + `{user && <RealtimeRoomPanel …/>}` |
| “我的”页内嵌渲染 | 行 1466（`ProfilePage`） | `{user && <><RealtimeRoomPanel …/><CloudMatchesPanel …/></>}` |
| 页面路由状态机 | 行 1847–1867（`page`） | 仅识别 `/`、`/play`、`/decks`、`/history…`、`/profile`，**无 `/room` 路由** |
| 导航函数 | 行 1653–1657（`navigate`） | `history.pushState` + `setPath` |
| 就地进入房间 | 行 1659–1667（`enterCloudRoom`） | 目前 `setPendingRoomCode(code)` + `navigate("/")`，由首页面板消费 |
| 待进入房间码状态 | 行 1489（`pendingRoomCode`） | 一次消费机制，供面板 `useEffect` 自动进入 |
| 普通对局全屏页（参照物） | 行 613–631（`ActiveMatchView` → `.match-page.page-shell`）、行 723–729（`EightBallBoard` → `.eight-page.page-shell`） | 顶部 banner + 主区 + 移动端 `.match-dock` |
| 实时房间面板样式 | `app/globals.css` 行 258、270、124 | `.realtime-room-panel` 等面板容器/内部组件样式；`.home-stack .realtime-room-panel { margin-top: 0 }` |
| 对局页样式（参照物） | `app/globals.css` 行 204、225、241（`.match-page`/`.eight-page`/移动端 `.match-dock`） | 全屏页面布局 |
| 后端房间 API | `worker/realtime/api.ts` | `/api/realtime/rooms`、`/direct`、`/mine`、`/:code`、`/:code/join`、`/:code/connect`（WebSocket）、members/leave/complete/kick/unban/players —— **本次不改** |
| 后端集成测试 | `worker/realtime/match-room.integration.test.ts` | 已有覆盖，本次不动 |
| 端到端测试 | `e2e/core-flows.spec.ts` | 目前**没有**房间相关 e2e，可在此次补上 |

### 2.1 关键既有机制（改造时必须保留）

- `enterRoom(code)`（行 1075–1089）：进入房间**只恢复同一 matchId/roomCode，绝不新建云端对局、不分配第二个房间**；
- `initialRoomCode` 一次性消费（行 1091–1099）：每个导航只消费一次，`onConsumedInitialRoomCode` 立即清空；
- WebSocket 生命周期（行 1106–1202）：按 `activeCode` 建连、断线指数退避、`online` 事件重连、卸载时关闭 —— 应整体搬进新的全屏房间页（或抽成 hook），不能丢；
- 角色/权限：`self?.role` 决定 `isHost` / `canWrite`；观战者只读（现有面板/计分组件已按 `writable` 处理）。

---

## 3. 目标形态

### 3.1 路由设计（推荐方案）

| 路径 | 页面 | 内容 |
| --- | --- | --- |
| `/room` | `RealtimeRoomEntryPage`（全屏入口页） | 创建房间（选择本人未结束云端对局）+ 输入房间码加入；顶部与 `/play` 一致的 page title 风格 |
| `/room/:code` | `RealtimeRoomPage`（全屏房间对局页） | 房间码卡片 + 连接状态 + 追分/中八计分面板 + 成员管理 + 结束/离开/刷新；布局对齐 `.match-page` |
| `/` | 首页 | 移除内嵌 `RealtimeRoomPanel`；“云端实时对局”卡片改为跳转 `/room/:code` |
| `/profile` | 我的 | 移除内嵌 `RealtimeRoomPanel`；新增“进入实时房间”按钮跳转 `/room`（云端对局/恢复等卡片保留） |

备选方案（不推荐）：不引入 `/room/:code`，仅把面板改为 `/` 下的全屏视图。缺点是无法用 URL 直达/分享房间、刷新后无法恢复到房间页，故不采用。

### 3.2 房间对局页布局（对齐 `.match-page`）

```
┌─────────────────────────────────────────────┐
│ app-header（品牌 + 主导航，与普通对局一致）        │
├─────────────────────────────────────────────┤
│ .room-page.page-shell                        │
│  ├─ .room-topbar（对齐 .match-banner）        │
│  │    live 状态（对局进行中）· 房间码 · 连接状态   │
│  │    操作：复制房间码 / 本局信息 / 结束/离开      │
│  ├─ .room-info（对齐 .match-info，可折叠）      │
│  │    成员与角色 · 版本与事件数 · 当前操作者       │
│  ├─ RealtimeChasePanel / RealtimeEightBallPanel│
│  │    （组件不变，容器宽度放开为全屏）             │
│  └─ 移动端 .room-dock（对齐 .match-dock）       │
│       记分 / 房间信息 / 更多                      │
└─────────────────────────────────────────────┘
```

### 3.3 组件拆分建议

| 新组件 / Hook | 职责 | 来源 |
| --- | --- | --- |
| `useRealtimeRoom`（自定义 hook） | WebSocket 生命周期、快照合并、`enterRoom`/`createRoom`/`joinRoom`/`leaveRoom`/`completeRoom`/成员管理/`sendCommand`、连接状态与消息状态 | 从 `RealtimeRoomPanel` 行 1038–1395 的逻辑中抽取，供两个页面复用 |
| `RealtimeRoomEntryPage` | `/room` 全屏入口：创建 + 加入表单（复用现有 `.room-entry-grid` 结构，放大为页面级） | 由 `RealtimeRoomPanel` 的 `!snapshot` 分支改造 |
| `RealtimeRoomPage` | `/room/:code` 全屏房间：挂载时按 URL code 进入房间（复用 `initialRoomCode` 一次性消费语义）；渲染房间码卡片、计分面板、成员管理、操作按钮 | 由 `RealtimeRoomPanel` 的 `snapshot` 分支改造 |
| `RealtimeChasePanel` / `RealtimeEightBallPanel` | **保持不变**，仅父容器从窄面板变为全屏页 | 行 893–1035 |

---

## 4. 实施步骤

按顺序推进，每步可独立验证。

### 阶段 1：路由与页面骨架

- [x] 在 `GameApp` 的 `page` 状态机（现位于行 1853–1882）新增分支：
  - `path === "/room"` 或 `path.startsWith("/room/")` → 渲染全屏房间页；未登录显示全屏登录引导（行 1862–1870）；
  - 房间码从 URL 解析（`path.slice("/room/".length)`），非法格式由 `enterRoom` 内校验并就地提示“房间码无效”，不回退 `/room`（与原计划“非法则回退 `/room` 并提示”略有差异，见第 8 节）；
  - 保持 `popstate` 监听（行 1508–1525）不变，浏览器前进/返回自动生效。
- [x] 房间逻辑未抽成独立 `useRealtimeRoom` hook：保留 `RealtimeRoomPanel` 组件并直接在全屏路由中渲染（与原计划的 hook 抽取不同，见第 8 节）。
- [x] 未新建 `RealtimeRoomEntryPage`/`RealtimeRoomPage` 两个页面组件：`RealtimeRoomPanel` 一个组件同时承担全屏入口（`roomCode` 为空 → 创建/加入表单）与全屏房间对局（`roomCode` 非空 → 房间内容）两种形态（见第 8 节）。
- [x] 旧 `RealtimeRoomPanel` 出口按“直接替换”处理：原首页/“我的”页内嵌位置已删除，组件本体保留并作为全屏房间页渲染。

### 阶段 2：入口收敛与路由跳转

- [x] 改造 `enterCloudRoom`（行 1666–1673）：改为 `navigate(`/room/${code}`)` 并关闭创建弹窗；不再有 `setPendingRoomCode`。
- [x] 首页（行 220–243）：删除内嵌 `<RealtimeRoomPanel …/>`；`EmptyHome` 的“云端实时对局”卡片点击 → `onEnterCloudRoom(roomCode)` → `enterCloudRoom` → `/room/:code`；快速入口“多人实时房间” → `/room`。
- [x] 设置弹窗（行 1890–1891，`SetupDialog` / `EightBallSetupDialog` 的 `onCloudRoomCreated`）：直接传 `enterCloudRoom`，创建成功即跳转 `/room/:code`（语义从“就地进入”改为“跳转全屏房间页”）。
- [x] “我的”页面（行 1474）：移除内嵌 `RealtimeRoomPanel`，替换为“进入实时房间”入口卡片 → `/room`；`ProfilePage` 的 `initialRoomCode` 参数已移除。
- [x] 移除 `pendingRoomCode` 状态（原行 1489）及所有消费点，确认无残留引用（grep 验证）。
- [x] 未登录访问 `/room` / `/room/:code`：全屏页内显示登录引导与“前往登录”按钮（→ `/profile`，行 1863–1868）；登录后需手动再进入，未做自动续接（与原计划“登录后自动继续原动作”略有差异）。

### 阶段 3：全屏视觉与移动端

- [x] `app/globals.css` 新增页面级样式（行 225、241）：
  - `.room-page`（对齐 `.match-page`）、`.room-topbar`（对齐 `.match-banner`，含 live 状态/房间码/连接状态/操作按钮）；
  - `.room-dock`（移动端固定底栏，复用 `.match-dock` 实现并带 `env(safe-area-inset-bottom)`）；
  - 未实现 `.room-info` 可折叠信息区：房间码/版本/事件数/连接状态在 `.room-topbar` 与 `.room-code-card` 展示，成员与角色在 `.room-members` 区块（见第 8 节）。
- [x] 保留并复用现有 `.realtime-score-board`、`.realtime-eight-board`、`.room-members`、`.room-actions` 等内部组件样式，并新增 `.room-entry-grid`、`.room-code-card`、`.room-kicked` 页面级样式；移除 `.realtime-room-panel` 容器样式（原行 258、270）与 `.home-stack .realtime-room-panel` 覆盖（原行 124），grep 验证无残留。
- [x] 全屏页内按角色组织信息层级：房主看到成员管理/设角色/踢人/结束；玩家看到计分入口；观战者只读提示（复用 `readonly-hint`），与现状权限逻辑一一对应。
- [x] 桌面端 max-width 与 `.page-shell` 对齐（`min(1180px, calc(100% - 44px))`），移动端对齐 `min(100% - 28px, 720px)`，不破坏现有响应式断点。

### 阶段 4：测试与验收

- [ ] 手工回归以下路径（详见第 5 节验收清单）——需真人登录态双设备实测，自动化无法覆盖，待做。
- [x] 新增 `e2e/room-fullscreen.spec.ts`（3 条用例 × 桌面/移动）：首页不再内嵌面板且提供 `/room` 入口；`/room` 对游客显示登录引导并可跳转 `/profile`；`/room/:code` 直达全屏房间页外壳。因 e2e 静态环境无法登录/访问 Worker API，未做“创建房间 → 记录一笔 → 离开”的登录链路；服务端行为由 `worker/realtime/match-room.integration.test.ts`（24 条）覆盖，真人链路待手工回归。
- [x] 更新 `ROADMAP_REMAINING_WORK.md` R4.9 进度与本文档状态（2026-08-17）。

---

## 5. 测试与验收清单

### 5.1 功能验收

- [x] 首页不再出现内嵌房间小面板；“云端实时对局”卡片点击后进入全屏 `/room/:code`（e2e 用例 1 + 代码核对）。
- [x] 设置弹窗选择“云端实时房间”并确认后，直接进入全屏房间页并显示房间码（`onCloudRoomCreated` → `enterCloudRoom` → `/room/:code`，房间码展示于 `.room-topbar` 与 `.room-code-card`）。
- [x] “我的”页面不再内嵌面板，提供进入 `/room` 的入口卡片。
- [x] `/room` 可创建房间、可输入房间码加入；加入后默认观战者、房主可提升为玩家（创建/加入/提权/降级/踢人逻辑保留，服务端行为由 Worker 集成测试覆盖）。
- [x] 直接打开 `/room/:code`（新开标签、刷新、从分享链接进入）自动进入房间，恢复同一对局且不重复创建（URL 房间码一次性消费 + `enterRoom` 只恢复同一 matchId/roomCode 的语义）。
- [x] 非法房间码给出与现状一致的错误提示（格式校验在 `enterRoom` 内提示“房间码无效”；房间不存在/已被移出由 `/api/realtime/rooms/:code` 错误透传）。
- [ ] 结束对局后跳转回 `/`（或战绩页），WebSocket 关闭无泄漏——**实现差异**：当前结束后停留在房间页显示“已结束”只读态（“结束对局”按钮消失），由成员点“← 返回”回 `/`，未自动跳转（见第 8 节）。待手工回归确认。
- [x] 离开房间/返回按钮回到 `/`（“← 返回” → `/`；`leaveRoom` 后回 `/room` 入口页）；再次进入同一房间码仍恢复同一对局（服务端幂等，Worker 集成测试覆盖）。

### 5.2 实时性回归（复用 R4 既有能力）

以下均为真人双设备实测项，自动化无法覆盖，**待手工回归**；其中服务端行为已由 `worker/realtime/match-room.integration.test.ts` 覆盖（重连补事件、角色收敛、踢人 4004、幂等、容量等）。

- [ ] 两台设备进入同一房间，快照与事件顺序一致。
- [ ] 断线重连（切网、刷新、后台恢复）后自动补齐事件。
- [ ] 观战者提升为玩家后无需刷新即可写入；降级后立即只读。
- [ ] 房主踢人后，被踢者停留在全屏页但只读并显示原因，不再重连（客户端行 1172–1180 逻辑保留）。
- [ ] 操作幂等：同一 `operation_id` 重复提交不重复计分。

### 5.3 样式验收

- [x] 桌面与移动端（竖屏优先）下，房间页视觉层级与 `ActiveMatchView`/`EightBallBoard` 一致（`.room-page`/`.room-topbar`/`.room-dock`；e2e 桌面/移动两个项目均通过）。
- [x] 移动端底部 dock 出现且不与系统导航重叠（`.room-dock` 使用 `env(safe-area-inset-bottom)`）。
- [x] 观战者视图隐藏所有可写操作入口，只读提示可见（`writable`/`canWrite` 门控 + `readonly-hint`）。
- [x] 全站无残留的 `.realtime-room-panel` 引用（grep 验证：仅剩 e2e 断言其不存在与本路线图文档提及）。

---

## 6. 风险与注意事项

1. **`initialRoomCode` 一次性消费语义**：新页面必须在挂载时消费 URL 房间码且只消费一次（复用行 1091–1099 的 effect 模式）；避免因 React 严格模式双执行导致重复进入。可考虑“URL 房间码 → 组件内部 `enteredCodeRef`”去重。
2. **`pendingRoomCode` 移除的连锁影响**：`ProfilePage` 的 `initialRoomCode` 参数、`enterCloudRoom` 签名、设置弹窗的 `onCloudRoomCreated` 回调都要同步清理，防止死代码与误用。
3. **组件抽取范围**：`RealtimeRoomPanel` 有大量闭包与 ref（`snapshotRef`、`kickedRef`、`socketRef`），抽取 hook 时保持依赖数组不变，避免改变重连/清理时序；建议抽取后先跑现有 `npm run test` 与本地预览回归，再继续样式阶段。
4. **不改变后端**：路由全屏化是纯前端呈现改造；`/api/realtime/rooms/*`、DO、WebSocket 协议保持原样，可显著降低回归面。
5. **分享链接语义**：`/room/:code` 直达依赖登录态；未登录用户打开链接应被引导登录而不是报错，登录后仍能进入同一房间。
6. **返回栈**：从 `/room/:code` 结束/离开后 `navigate("/")`；若用户直接关闭标签页，重新打开 `/room/:code` 应恢复到同一房间（服务端状态仍在，现有机制已保证）。
7. **移动端空间**：全屏后追分规则按钮与中八录入表单会占据更多纵向空间，可复用现有 `.match-dock` 的“记分”滚动定位能力（`scrollIntoView`），不必重新设计交互。

---

## 7. 明确不做（本次范围外）

- 不改后端 API、Durable Object、事件协议、权限模型（`worker/` 全部不动）。
- 不新增聊天、语音、观战大厅等新功能。
- 不改变“创建房间必须先有本人未结束云端对局”的业务规则（与现状一致）。
- 不重做 `RealtimeChasePanel` / `RealtimeEightBallPanel` 的内部交互，只调整容器与页面层级。

---

## 8. 实现说明（与计划的差异，2026-08-17）

落地实现与第 3 节“推荐方案”的差异如下，均为简化而非功能缺失：

1. **未抽取 `useRealtimeRoom` hook、未新建 `RealtimeRoomEntryPage`/`RealtimeRoomPage` 两个页面组件**。实际做法是保留原 `RealtimeRoomPanel` 组件，由 `GameApp` 的 `/room` 路由直接渲染：`roomCode` 为空时呈现全屏创建/加入入口，非空时呈现全屏房间对局页。两种形态共用同一组状态与副作用（WebSocket 生命周期、快照合并、进入/创建/加入/离开/结束、成员管理），行为与拆分方案等价，改动面更小。
2. **未实现 `.room-info` 可折叠信息区**。房间码、版本、事件数、连接状态直接展示在 `.room-topbar` 与 `.room-code-card`；成员与角色在 `.room-members` 区块，功能无缺失。
3. **非法房间码不回退 `/room`**：格式校验在 `enterRoom` 内完成并就地提示“房间码无效”，不再导航回退（原计划为“非法则回退 `/room` 并提示”）。
4. **结束对局后不自动跳转 `/`**：`completeRoom` 成功后房间页刷新为“已结束”只读态（topbar“结束对局”按钮消失），由成员点“← 返回”回首页（原计划为“结束对局后跳转回 `/`”）。
5. **e2e 未覆盖登录链路**：`e2e/room-fullscreen.spec.ts` 覆盖首页入口、游客登录引导、`/room/:code` 直达外壳三条 UI 链路；“创建房间 → 记录一笔 → 离开”的登录链路依赖 Worker API 与登录态，由 Worker 集成测试覆盖服务端行为，真人链路待手工回归。
6. **未登录用户进入 `/room/:code` 后不做自动续接**：显示登录引导，登录后需手动再进入该房间（原计划为“登录后自动继续原动作”）。
