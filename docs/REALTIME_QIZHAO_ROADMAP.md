# 奇招牌进中八与多人实时房间 · 修改路线图

> 版本：v1.0（草案）｜状态：待评审
> 目标：① 中八比赛设置加入「奇招牌」（参考追分界面）；② 多人实时房间内为追分 / 中八引入独立手牌制奇招牌（删共用手牌、分人手牌数、按账号可见性、操作留日志并全员通知、对局中可调手牌数且下一轮重发生效）。
> 相关文档：[REALTIME_ROOM_UX_ROADMAP.md](./REALTIME_ROOM_UX_ROADMAP.md)、[REALTIME_ROOM_FULLSCREEN_ROADMAP.md](./REALTIME_ROOM_FULLSCREEN_ROADMAP.md)、`taiqiuqizhao/ROADMAP.md`（阶段 2 P2 游客）。

---

## 1. 需求与现状

### 1.1 需求清单

| 编号 | 需求 | 现状 | 优先级 |
|------|------|------|--------|
| R0 | **中八比赛设置里加入「奇招牌」选项，参考追分界面** | 追分设置（`SetupWizard`，GameApp.tsx:458-467）已有奇招牌区块（不抽/共用手牌/独立手牌 + 牌组选择 + 手牌数 + 高级设置）；中八设置（`EightBallSetupDialog`，GameApp.tsx:653-750）**没有**任何奇招牌区块；`src/lib/eight-ball.ts` 的 `EightBallMatch` 无卡牌字段 | P0 |
| R1 | **房间内追分 / 中八的奇招牌设置只有「不抽」或「独立」两种，删除「共用手牌」** | 房间协议（`worker/realtime/api.ts` `directDraft`）完全不接受卡牌设置；前端建房间时把 `cardMode==="shared"` 也映射成 `score_cards` 上传（GameApp.tsx:390），服务端却忽略之，`score_cards` 只是标题（GameApp.tsx:1590），房间内无任何卡牌逻辑 | P0 |
| R2 | **独立手牌：两者（各选手）手牌数分开设置，可以不相同** | 本地 `MatchCardState` 只有单一 `initialHandSize`（match.ts:86）；`createMatch` 按统一 size 发牌（match.ts:207）。房间协议无手牌数字段 | P0 |
| R3 | **注册用户每人只能看到自己的手牌；选择「跳过 / 使用」会留下日志并通知所有人** | 房间广播是“全量同构”的：`broadcast()` 对所有 socket 发同一 JSON（match-room.ts:1149），`snapshot()` 无观察者概念（match-room.ts:793），当前也没有任何卡牌事件 | P0 |
| R4 | **本地临时用户（未绑定注册成员的席位，`userId === undefined`）的卡牌只有房主可见** | 席位模型已具备判定依据：`ChaseScorePlayer.userId?` / `RealtimeEightBallPlayer.userId?`（chase-scoring.ts:13-22、eight-ball-scoring.ts:6-12），但无卡牌可见性逻辑；游客（`playerType:"guest"`）为 P2 预留 | P0 |
| R5 | **对局页面可调整自己的手牌数；操作留日志并通知所有人；在下一轮对局开始时重新抽取并生效** | 本地卡牌设置 `updateMatchCardSettings` 只能调 `handLimit`（上限），不能调起始手牌数；房间无此能力 | P1 |

### 1.2 术语约定

- **成员（member）**：注册用户，`room_members` / `match_players` 中 `user_id` 非空，角色 host / player / spectator。
- **席位（seat / player）**：局内计分对象，`match_players` 中 `role='player'` 行；`userId === undefined` 即「临时席位 / 本地临时用户」（归档时 `kind:"guest"`，见 match-room.ts:891 归档分支）。
- **观察者投影（per-viewer projection）**：服务端在生成快照 / 广播时按“观察者（userId + role）”过滤卡牌内容，保证任何成员无法从 socket 载荷读到别人的手牌。
- **一轮 / 下一轮（round）**：重发手牌的边界。中八 = 每「局」（`eight_ball.round.record` 成功后）；追分 = 新增的房主命令 `card.round.start`（「开始新一轮」）。
- **手牌数生效**：`pendingHandSizes[playerId]` 是“下一轮生效”的目标值；`initialHandSizes` 是建局时的值。

### 1.3 现状与代码定位（实施前复核行号）

| 需求 | 真实位置 | 现状说明 |
|------|----------|----------|
| R0 | `app/GameApp.tsx:653` `EightBallSetupDialog`（无奇招牌区块）；`:788` `EightBallBoard`（无卡牌区）；`src/lib/eight-ball.ts:36` `EightBallMatch`、`:58` `EightBallDraft`（无 cards 字段） | 中八本地/云端均无奇招牌 |
| R0（可参考的追分 UI） | `app/GameApp.tsx:458-467`（奇招牌 section：`card-mode-picker`、`deck-picker`、起始手牌、`advanced-card-settings`）；`:549` `CardBoard`（手牌区：抽/用/跳/流水/撤销） | 追分本地已完整 |
| 卡牌引擎（复用候选） | `src/lib/match.ts:79-99` `MatchCardState`；`:187` `createMatch` 发牌；`:441` `updateMatchCardSettings`；`:454` `drawMatchCards`；`:485` `triggerMatchCardRefill`；`:497` `playMatchCard`；`:525` `skipMatchCard`；`:541` `undoCardAction` | 函数签名耦合 `BilliardsMatch`，需抽取为可独立操作 `MatchCardState` 的纯函数以复用于中八与房间 |
| 牌组/卡牌数据 | `src/data/cards.ts`（51 张定义）、`src/lib/official-decks.ts`（官方牌组）、`src/lib/deck.ts` `createDeck` / `CardInstance` | 房间可复用 `deck.ts` / `official-decks.ts`（纯 TS，无浏览器依赖） |
| R1/R2 | `worker/realtime/api.ts:155-241` `directDraft` + `directDraftBaseline`（不接受卡牌设置）；`:330` `loadChaseScoreState` / `:397` `loadEightBallState`（hydrate 自 `matches.snapshot_json`）；前端 GameApp.tsx:390（追分 submitCloud 只传 mode）与 :671-682（中八 submitCloud） | 建房间协议需扩展 |
| R1（房间模式） | `worker/realtime/chase-scoring.ts:24-30` `ChaseScoreState.mode:"score"|"score_cards"`；`match-room.ts:100-105` `room_game_state` CHECK（mode IN score/score_cards/eight_ball，无需改表）；`match-room.ts:1070` `chaseScoreState()` / `:1087` `eightBallState()` | 卡牌状态放进 state_json，不改表结构 |
| R3/R4 | `worker/realtime/match-room.ts:1149` `broadcast`（同构广播）；`:793` `snapshot()`；`:828` `sync()`；`:606` `fetch`（WS 携带 `X-Room-User-Id`/`X-Room-Role`）；`app/GameApp.tsx:949-958` `RealtimeSnapshot` 类型 | 需引入观察者参数并做过滤 |
| R5 | `worker/realtime/chase-scoring.ts:193` `projectChaseCommand`；`eight-ball-scoring.ts:158` `projectEightBallCommand`；`match-room.ts:547` `processCommand`（chase 优先、eightBall 兜底） | 需新增卡牌命令分发与重发钩子 |
| 归档 | `worker/realtime/match-room.ts:926` `buildArchiveSnapshot`（chase 分支 `:935`、eight 分支 `:998`）；前端导出 GameApp.tsx:805（`cards.events` 已进时间线） | 归档需带出卡牌流水 |
| 测试 | `worker/realtime/match-room.integration.test.ts`（98KB）；`src/lib/match.test.ts`；命令：`npm run test`（src/lib）、`npm run test:worker`（worker） | 需新增卡牌用例 |

---

## 2. 方案设计

### 2.0 房间卡牌数据模型（新增 `worker/realtime/room-cards.ts`）

```
RoomCardMode      = "none" | "independent"          // 房间内删去 "shared"
RoomCardInstance  = { instanceId; definitionId; displayNumber; title; effect; safetyNote? }   // 复用 CardInstance 形状，可 JSON 序列化
RoomCardEvent     = { id; type: "draw"|"play"|"skip"|"hand_size"|"redeal";
                      playerId; card?; size?; occurredAt }
RoomCardState = {
  mode: "independent";
  deckId; deckSnapshot: { id; version; name; definitionIds; cardCount };
  remaining: RoomCardInstance[]; used: RoomCardInstance[]; skipped: RoomCardInstance[];
  hands: Record<playerId, RoomCardInstance[]>;        // 按席位（playerId）
  initialHandSizes: Record<playerId, number>;         // R2：建局时每人手牌数（可不相同）
  pendingHandSizes: Record<playerId, number>;         // R5：下一轮生效的目标手牌数
  events: RoomCardEvent[];                            // 公开流水（谁抽/用/跳/调数）
  filter?: { excludedCategories; maxSafetyLevel; excludedKeywords };   // 与本地对齐，V1 可选
}
```

- 挂在 `ChaseScoreState.cards?` 与 `RealtimeEightBallState.cards?` 上；`room_game_state.mode` 与 CHECK 约束不变，卡牌全部在 `state_json` 内。
- 纯函数模块 `room-cards.ts`：`initRoomCards(draft)`（按 `deckId` + 每人 `handSizes` 发牌）、`draw`、`play`、`skip`、`setHandSize`（只写 `pendingHandSizes`）、`redeal`（按 `pendingHandSizes` 重新抽取、重置 `initialHandSizes=pendingHandSizes`）。牌库抽取复用 `src/lib/deck.ts` 的 `createDeck`/`secureRandomIndex` 与 `src/lib/official-decks.ts` 的牌组定义（纯 TS，可在 Worker 中直接 import）。

### 2.1 R0：中八设置加入奇招牌（本地，先做，风险最小）

**目标**：`EightBallSetupDialog` 增加与追分一致的奇招牌区块；本地中八开局即可抽牌。

**改动点**：

| 文件 | 改动 |
|------|------|
| `src/lib/match.ts` | 把卡牌操作（`createMatch` 发牌部分、`drawMatchCards`、`playMatchCard`、`skipMatchCard`、`triggerMatchCardRefill`、`undoCardAction`、`updateMatchCardSettings`）重构为**可脱离 `BilliardsMatch` 操作 `MatchCardState`** 的纯函数（内部签名改为 `{ match, cards }` 或直接 `cards`），对外保留原包装函数，保证本地追分行为与 `match.test.ts` 不回归 |
| `src/lib/eight-ball.ts` | `EightBallDraft` 增加 `cardMode?/deckId?/handSizes?`；`EightBallMatch` 增加可选 `cards?: MatchCardState`（复用抽取后的引擎）；`recordEightBallRound` 成功后调用 `redeal`（对齐 R5“下一轮重发”） |
| `app/GameApp.tsx` | ① `EightBallSetupDialog` 在「03 比赛资料」后新增「奇招牌」section，**整体复制追分区块结构**（GameApp.tsx:458-467）：本地模式保留 不抽/共用手牌/独立手牌；独立手牌时显示**两位选手分开的手牌数输入**（R2 语义在本地同步落地）；云端模式只显示 不抽/独立（R1）。② `EightBallBoard`（:788）在计分板下方渲染 `CardBoard`（引擎抽取后 `CardBoard` 只需 `match.cards` 即可复用） |

**边界**：本地中八按追分界面原样提供「共用手牌」；「删除共用手牌」只约束云端房间设置（R1）。

### 2.2 R1/R2：房间协议扩展（不抽/独立、删共用手牌、分人手牌数）

**目标**：`/api/realtime/rooms/direct` 接受卡牌设置并落库，房间初始化时发牌。

**改动点**：

| 文件 | 改动 |
|------|------|
| `worker/realtime/api.ts` | ① `directDraft`：可选字段 `cardMode: "none"|"independent"`（默认 none）、`deckId`、`handSizes?: number[]`；**拒绝 `"shared"`（400，提示“房间内仅支持不抽或独立手牌”）**；`handSizes.length === players.length`、每项 0–10 整数；`deckId` 必须是 `OFFICIAL_DECKS` 之一；V1 可不收高级设置（自动补牌/耗尽策略等默认 `manual/stop`）。② `directDraftBaseline`：把卡牌设置写入基线 JSON（chase 与 eight 分支都加 `cards` 段）。③ `loadChaseScoreState` / `loadEightBallState`：从基线 `snapshot_json` hydrate `cards` 并初始化 `RoomCardState` |
| `worker/realtime/match-room.ts` | `initialize`：`persistChaseScoreState` / `persistEightBallState` 时已含 `cards`，无需改表 |
| `app/GameApp.tsx` | ① 追分 `submitCloud`（:390）：payload 增加 `cardMode`（cloud 下不再可能为 shared）、`deckId`、`handSizes`（按 `validPlayers` 顺序）。② 中八 `submitCloud`（:671）：同上传卡牌设置。③ `SetupWizard` 奇招牌区块：`hostMode==="cloud"` 时隐藏「共用手牌」按钮；`cardMode==="independent"` 时把「每人起始手牌」改成**每人一个输入框**（含中八两选手） |

### 2.3 R3：可见性模型（服务端按观察者投影，安全关键）

**原则**：卡牌内容**只在服务端做过滤**；客户端收到的 `snapshot` / `sync` / 事件广播都是“对当前观察者可见”的投影，任何成员无法从 WebSocket 载荷窃读他人手牌。

**投影规则（观察者 = 连接成员，携带 `X-Room-User-Id` / `X-Room-Role`）**：

| 观察者 | 自己的手牌 | 其他注册席位手牌 | 临时席位（`userId===undefined`）手牌 | 卡牌事件详情 |
|--------|-----------|------------------|--------------------------------------|--------------|
| 房主 host | 完整 | 完整 | **完整（R4：临时用户卡牌仅房主可见）** | 全部 |
| 注册玩家 player | 完整 | 仅数量（不显示卡面，V1 建议；严格版可完全隐藏） | 无 | 仅本人 draw/play/skip 的卡名 + 全员公开事件（hand_size/redeal） |
| 观战 spectator | 无卡牌区 | 无 | 无 | 仅公开事件（hand_size/redeal） |

**改动点**：

| 文件 | 改动 |
|------|------|
| `worker/realtime/match-room.ts` | ① `snapshot(after, observer?)`、`sync(after, observer?)`：增加观察者参数（userId+role），对 `chaseScore.cards` / `eightBall.cards` 与 `events` 中 `card.*` 事件做投影过滤；`fetch`（:606）把 `X-Room-User-Id` 传入。② `broadcast` 改造为按 socket 投影：新增 `broadcastViewer(build)`，遍历 socket 附件（已有 userId/role，见 `ConnectionAttachment`）分别发送；保留原 `broadcast` 用于非敏感事件（member.*、score.*、eight_ball.*）。③ `processCommand` 后对 `card.*` 事件：标题等细节只进“可见者”的 socket |
| `app/GameApp.tsx` | `RealtimeSnapshot`（:949-958）增加 `chaseScore.cards` / `eightBall.cards`（观察者投影后）；卡牌面板只渲染快照中给到的内容，不做本地推断 |

### 2.4 R5：对局中调整手牌数 + 下一轮重发

**命令**（经 `processCommand` 分发到 `room-cards.ts` 投影，事件写入 `room_events` 并广播）：

| 命令 | payload | 权限 | 事件 kind（广播可见性） | 效果 |
|------|---------|------|--------------------------|------|
| `card.draw` | `{ playerId, count=1 }` | 房主；或该席位的注册玩家本人 | `card.drawn`（卡名仅本人+房主可见；全员收到“谁抽牌”提示，可选） | 从 `remaining` 抽入 `hands[playerId]` |
| `card.play` | `{ playerId, instanceId, linkedScore? }` | 房主；或本人 | `card.played`（**全员可见卡名 + 通知**，R3） | 移入 `used`；可选关联计分事件（对齐本地 `playMatchCard`） |
| `card.skip` | `{ playerId, instanceId }` | 房主；或本人 | `card.skipped`（**全员可见卡名 + 通知**，R3） | 移入 `skipped`；自动补抽 1 张（对齐本地 `skipMatchCard`） |
| `card.hand_size.set` | `{ playerId, size }` | 房主（任意席位）；注册玩家仅本人席位 | `card.hand_size_changed`（**全员可见 + 通知**，R5） | 写 `pendingHandSizes[playerId]`；**不立即改手牌** |
| `card.round.start` | `{}` | 房主（追分用） | `card.round_redealt`（全员可见 + 通知） | 按 `pendingHandSizes` 重发所有手牌，重置 `initialHandSizes` |

**“下一轮对局开始”钩子**：
- **中八**：`projectEightBallCommand` 中 `eight_ball.round.record` 成功投影后，调用 `redeal(state.cards)`，即每记完一局自动重发（对齐本地 R0 的 `recordEightBallRound` 钩子）。
- **追分**：无自然局边界，V1 采用房主显式「开始新一轮」按钮（`card.round.start`）；面板上提示“重发将按各自设定的手牌数重新抽取”。

**前端**：`RealtimeCardPanel`（新增组件）在追分/中八房间卡牌启用时渲染——本人手牌区（抽/用/跳）、手牌数调整器（数字输入 + 确认，提交 `card.hand_size.set`）、公开流水（`cards.events`，含 `hand_size`/`redeal` 记录）、房主视图额外包含全部席位手牌与「开始新一轮」按钮；事件到达时**弹窗通知**全员（“XX 使用了「卡名」”“XX 将手牌数调整为 N”）。

#### 弹窗通知（全员通知的交互形态）

**形态**：事件到达时在屏幕右上角（或顶部居中）弹出浮层提示，**数秒后自动消失**；与底部状态条（现有 `setStatus`，GameApp.tsx:1777，2.6 秒自动清空）区分开，不阻塞任何操作。

| 项 | 约定 |
|----|------|
| 触发事件 | `card.played` / `card.skipped` / `card.hand_size_changed` / `card.round_redealt` → 全员弹窗；`card.drawn` → 弹窗提示“XX 抽了一张牌”（不含卡名） |
| 文案 | “XX 使用了「卡名」”“XX 安全跳过了「卡名」”“XX 将手牌数调整为 N 张”“新一轮开始，手牌已按设定重发” |
| 展示 | 右上角浮层（`.room-notification`），深浅色随主题，可点击立即关闭 |
| 自动消失 | 默认约 **3–4 秒** 后自动淡出消失（CSS 过渡 + `setTimeout` 清理，组件卸载/房间切换时一并清除） |
| 多条并存 | 多条通知堆叠展示或排队依次弹出（上限 3 条，超出丢弃最旧），不打断计分操作 |
| 实现位置 | `RealtimeRoomPanel` 内新增 `NotificationPopup` 组件（维护 `notifications` state），在 WS 事件监听里对 `card.*` 事件 push 弹窗 |
| 复用 | 本地中八/追分对局的卡牌提示可沿用同一弹窗组件（替换 `CardBoard` 中散落的 `toast(...)` 文案，可选，不阻塞） |

### 2.5 归档 / 导出兼容

- `match-room.ts` `buildArchiveSnapshot`：chase 分支（:935）与 eight 分支（:998）在返回对象中追加 `cards`（含 `hands/used/skipped/initialHandSizes/pendingHandSizes/events`）与 `cardEvents`（由 `room_events` 中 `card.*` 按时间顺序映射，供历史战绩时间线展示，对齐本地导出 GameApp.tsx:805）。
- `loadChaseScoreState` / `loadEightBallState` 的 hydrate 需容忍旧基线无 `cards` 字段（缺省为 `undefined`），保证存量房间/对局兼容。
- 无需新增 D1 表或迁移（卡牌全部在 `state_json`）；`room_game_state` CHECK 不变。

---

## 3. 实施路线

### 阶段 1：卡牌引擎抽取 + 本地中八奇招牌（R0，预计 1–2 天）

**目标**：追分本地零回归；中八本地可用奇招牌；为房间复用铺路。

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 1.1 | 抽取 `MatchCardState` 纯函数（draw/play/skip/refill/redeal/setSize/undo），保留原 `BilliardsMatch` 包装 | `src/lib/match.ts` | `npm run test` 全绿（`match.test.ts`、`deck.test.ts` 不回归） |
| 1.2 | `EightBallDraft`/`EightBallMatch` 增加 `cards?`；`recordEightBallRound` 后重发 | `src/lib/eight-ball.ts` | 新增 `eight-ball` 卡牌单测（发牌、用牌、跳牌、每局重发） |
| 1.3 | `EightBallSetupDialog` 新增奇招牌区块（复制追分结构；独立手牌分人设置） | `app/GameApp.tsx` | 中八设置可配奇招牌；确认页展示牌组/模式/手牌数 |
| 1.4 | `EightBallBoard` 渲染卡牌区（复用 `CardBoard`）；本地中八战绩导出含卡牌流水 | `app/GameApp.tsx` | 中八对局可抽/用/跳牌；导出 JSON 含 `cards` |

### 阶段 2：房间服务端（R1/R2/R3/R4/R5 的服务端半边，预计 2–3 天）

**目标**：房间协议 + 卡牌状态机 + 可见性 + 重发钩子，全部有集成测试。

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 2.1 | 新建 `room-cards.ts`：类型 + 纯函数（init/draw/play/skip/setHandSize/redeal），复用 deck/official-decks | `worker/realtime/room-cards.ts`（新） | 单元测试覆盖发牌越界、牌库耗尽、重发 |
| 2.2 | `directDraft` 接受 `cardMode/deckId/handSizes`，拒绝 `"shared"`；基线落库；`load*State` hydrate cards | `worker/realtime/api.ts` | 建房间返回快照含 `cards`；`shared` 报 400 |
| 2.3 | `processCommand` 分发 `card.*` 命令；`ChaseScoreState`/`RealtimeEightBallState` 挂 `cards?`；round.record 后中八自动重发 | `worker/realtime/chase-scoring.ts`、`eight-ball-scoring.ts`、`match-room.ts` | 集成测试：draw/play/skip/setSize/round.start 全链路 |
| 2.4 | 观察者投影：`snapshot/sync/fetch` 带观察者；`broadcastViewer`；`card.*` 事件按可见性投递 | `worker/realtime/match-room.ts` | 集成测试断言：玩家 A 的快照不含 B 的卡面；临时席位卡面只出现在房主快照；`card.played/skipped/hand_size_changed` 全员可见 |
| 2.5 | `buildArchiveSnapshot` 输出 `cards` + `cardEvents`；旧基线无 `cards` 兼容 | `worker/realtime/match-room.ts` | 归档后 `matches.snapshot_json` 含卡牌流水；存量房间回归通过 |

### 阶段 3：房间与设置前端（R1–R5 前端半边，预计 2–3 天）

**目标**：设置页 + 房间面板完整可用。

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 3.1 | 追分/中八 `submitCloud` 上传卡牌设置；`SetupWizard` 云端隐藏「共用手牌」；独立手牌每人一个手牌数输入 | `app/GameApp.tsx` | 云端创建追分/中八房间带独立手牌；无 shared 入口 |
| 3.2 | `RealtimeSnapshot` 类型扩展 `cards`（观察者投影）；房间标题/信息展示牌组 | `app/GameApp.tsx` | 房间页显示「奇招牌 · XX牌组 · 每人 N 张」 |
| 3.3 | 新增 `RealtimeCardPanel`：本人手牌（抽/用/跳）、房主全席位视图、手牌数调整（`card.hand_size.set`）、「开始新一轮」（追分）、公开流水 | `app/GameApp.tsx` | 注册玩家只见自己手牌；临时席位卡面仅房主可见；跳过/使用/调数均有 toast 通知 |
| 3.4 | 事件监听：`card.*` 到达即 toast + 刷新投影（走现有 snapshot/event 机制） | `app/GameApp.tsx` | 全员实时收到通知与流水更新 |
| 3.5 | 房间内观战者视图：无卡牌区、仅公开事件 | `app/GameApp.tsx` | 观战者无手牌泄漏 |

### 阶段 4：回归、安全与上线（预计 1 天）

| # | 任务 | 验收 |
|---|------|------|
| 4.1 | `npm run test:all`（src/lib + worker 集成）全绿；`npm run lint` 通过 | 无回归 |
| 4.2 | 手工安全核对：登录两个账号开房间，抓 WebSocket 载荷确认 B 的载荷里无 A 的卡名/效果；游客/临时席位同理 | 无泄漏 |
| 4.3 | 存量兼容：旧 `score_cards` 房间、旧 `matches.snapshot_json`（无 cards）可正常打开/归档 | 兼容通过 |
| 4.4 | e2e 冒烟（Playwright）：建中八房间→设独立手牌→抽牌→调手牌数→记一局→验证重发 | 流程闭环 |
| 4.5 | 更新 `ROADMAP_REMAINING_WORK.md` / 版本说明 | 文档同步 |

---

## 4. 测试计划

- **单元（`npm run test`）**：`room-cards.ts` 纯函数（init/draw/play/skip/setHandSize/redeal 边界）；`src/lib/eight-ball` 卡牌（发牌、每局重发）；match.ts 抽取后回归。
- **集成（`npm run test:worker`）**：`match-room.integration.test.ts` 新增——① 建房间带 cards（chase 与 eight 各一）；② `shared` 拒绝；③ 手牌数可不同；④ 观察者投影（host/player/spectator 三档、临时席位仅房主）；⑤ `card.played/skipped/hand_size_changed` 全员可见；⑥ 中八记局后自动重发；⑦ 追分 `card.round.start` 重发；⑧ 归档含卡牌流水。
- **e2e（`npm run test:e2e`，可选）**：设置页→房间→抽牌→调手牌数→下一轮生效 冒烟。

## 5. 风险与开放问题

| 项 | 说明 | 建议 |
|----|------|------|
| 追分“一轮”边界 | 追分无自然局，需人工定义重发时机 | V1 用房主显式 `card.round.start`；后续可加“每 N 分钟/每轮自动重发” |
| 他人手牌“仅数量” vs “完全隐藏” | R3 只要求“看不到手牌”，数量是否可见未定义 | 默认显示数量（交互友好）；严格模式可整体隐藏，列为可配置 |
| `draw` 事件的告知粒度 | R3 只要求 play/skip 通知全员；抽牌是否通知未定义 | 全员收到“XX 抽了一张牌”（不含卡名），卡名仅本人+房主 |
| 游客（P2 guest 成员） | 当前房间成员全是注册用户，临时席位由房主代操作；真正游客加入后其“本人视图”需按 P2 游客模型扩展 | 投影函数按 `playerType` 预留分支，本期不实现 |
| 服务端 import `src/lib` | Worker 需 import `deck.ts`/`official-decks.ts`（纯 TS），确认 wrangler 打包路径与 `tsconfig` 无冲突 | 阶段 2 开始时先做最小 import 冒烟 |
| 手牌数与牌库容量 | 手牌数上限需结合牌组张数（避免发牌越界） | 沿用本地 `Math.floor(remaining / 人数)` 收敛逻辑；`setHandSize` 同样收敛并在日志中注明实际值 |
| 撤销 | 本地有 `undoCardAction`；房间 V1 是否支持撤销卡牌动作 | 建议 V1 不做（append-only 事件流可后续加 `card.undo`），列入 P2 |

## 6. 参考

- 本地卡牌引擎：`src/lib/match.ts`、`src/lib/deck.ts`、`src/lib/official-decks.ts`、`src/data/cards.ts`
- 房间状态机：`worker/realtime/match-room.ts`、`worker/realtime/chase-scoring.ts`、`worker/realtime/eight-ball-scoring.ts`、`worker/realtime/api.ts`
- 前端：`app/GameApp.tsx`（设置：408-489/653-750；CardBoard：549-594；实时面板：969-1133；房间：1135-1591）
