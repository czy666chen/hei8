# 路线图：界面简化 —— 奇招牌融入中八 + 开球规则并入比赛资料

> 目标版本参考：当前主线（R2.5 / v4.1.0 之后，v5.1.1 已移除中八创建页布局选项）
> 依据：用户两项诉求
> 1. 将奇招牌局融合到中八比赛里：在中八比赛开局中选奇招牌（参考追分与奇招牌的组合方式）
> 2. 将中八比赛选项页的「先开球、后续开球」放入「比赛资料」，作为选填

---

## 一、现状盘点（代码落点）

### 1.1 当前玩法入口（共 4 个，较为冗余）
| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 开始中八比赛 | `app/GameApp.tsx:206`、239（快速开始）、PlayPage 卡片 00（:634） | `chinese_eight` |
| 开始奇招牌局 | `app/GameApp.tsx:208`、PlayPage 卡片 01（:635） | 独立 `cards` 模式，经 `SetupDialog`（`initialMode==="cards"`，无计分）→ 改造为「奇招牌快抽」入口（一方/两方、各抽几张可不同、不加入玩家、不存战绩） |
| 开始追分局 | `app/GameApp.tsx:207`、240、PlayPage 卡片 02（:636） | `score` |
| 追分 + 奇招牌 | `app/GameApp.tsx:241`、PlayPage 卡片 02 次按钮（:636） | `score_cards`，是「奇招牌可组合」的既有参照实现 |

### 1.2 中八创建弹窗 `EightBallSetupDialog`（`app/GameApp.tsx:646-688`）
| 分区 | 字段 | 备注 |
| --- | --- | --- |
| 00 对局方式 | 本机计分 / 云端实时房间 | |
| 01 双方选手 | 玩家 A / 玩家 B | |
| 02 赛制与开局 | 赛制（抢 N / 自由）、抢几局、**先开球**（`firstServer: 0|1`）、**后续开球**（`serveRule: alternate|winner`） | 诉求 2 要移走的字段 |
| 03 比赛资料 | 比赛名称（title）、地点（location）、备注（note），全部可选 | 诉求 2 的落点；诉求 1 的「奇招牌」分区插入后顺延为 04 |

### 1.3 数据模型
- 中八：`src/lib/eight-ball.ts` —— `EightBallMatch`（:36-56）、`EightBallDraft`（:58-67）、`createEightBallMatch`（:88-102）、`getEffectiveEightBallRounds` 依据 `firstServerId`+`serveRule` 推导每局开球（:174-191）
- 追分卡牌：`src/lib/match.ts` —— `MatchCardState`（:79-99，含牌堆/手牌/已用/跳过/事件/牌组快照/策略）、`BilliardsMatch.cards`（:113）、卡牌操作 `drawMatchCards`/`playMatchCard`/`skipMatchCard`/`updateMatchCardSettings`（:439-535，均绑定 `BilliardsMatch` 签名）
- 追分设置弹窗的奇招牌分区（可整体镜像）：`app/GameApp.tsx:451-460`（不抽牌/共用手牌/独立手牌 + 牌组选择 + 起始手牌 + 高级设置：自动补牌、手牌上限、牌库耗尽、安全等级、排除类别、排除关键词）
- 追分局内卡片面板（可复用 UI）：`app/GameApp.tsx:548-584`（手牌标签、抽一张、使用此卡、安全跳过、补牌策略、手牌上限、耗尽重洗）

### 1.4 中八计分板页面
- `app/GameApp.tsx:726`：顶栏 + 比分卡 + 「记录本局结果」（`confirm` 确认本局） + 逐局流水。卡片面板可插在「记录本局结果」与「逐局流水」之间

### 1.5 云端实时房间（中八）
- `worker/realtime/api.ts:163-221`：direct 房间创建（body 仅含 `raceTo/serveRule/firstServer`）
- `worker/realtime/eight-ball-scoring.ts:26-35`：`RealtimeEightBallState`（无卡牌字段）
- `worker/realtime/match-room.ts`：命令路由/归档重建（:998-1060）
- `worker/realtime/match-room.integration.test.ts`：中八房间用例

### 1.6 持久化与测试
- `src/lib/local-storage.ts:120-121`：`isEightBallMatch` 校验（cards 可选时无需改动）
- `e2e/core-flows.spec.ts`：「奇招牌抽取、使用、安全跳过和刷新恢复」（:65-95，依赖「开始奇招牌局」按钮，将改写为快抽/中八+奇招牌流程）、「中八建局」（:37-63）、「追分 + 奇招牌」（:133）
- `app/preview-test/RealtimePreviewTest.tsx:22`：模式标签 `cards: "奇招牌局"`（历史渲染保留，标签可沿用）

---

## 二、诉求 1：奇招牌局融合进中八比赛（参考追分的组合模式）

### 2.1 设计决策（推荐方案）
- **不新增 mode**：中八 `mode` 保持 `"chinese_eight"`，`EightBallMatch` 增加可选字段 `cards?: MatchCardState`（复用 `match.ts` 类型）。展示文案按 `match.cards` 是否存在显示「中八 · 奇招牌」。
  - 理由：追分之所以有独立 `score_cards` mode，是因为追分与纯卡牌是并列玩法；中八模式本就固定，无需新 mode 字符串，`isEightBallMatch`、local-storage 校验、战绩渲染改动最小，且天然向后兼容。
  - 备选（不推荐）：新增 `mode: "chinese_eight_cards"`，与追分命名风格一致，但需改动所有 mode 判断与校验，收益低。
- **独立奇招牌：保留一个「快抽」快捷入口（用户已确认）**：
  - 进入后**直接选**：抽牌方式（**一方抽 / 两方抽**）→ 一方抽：选 A 方或 B 方 + 抽 N 张；两方抽：A 方 N1 张、B 方 N2 张，**允许双方张数不同**（各抽几张分开设置）。
  - **不加入玩家**：无玩家名、无计分、无流水，只有 A/B 两个席位（红/蓝）。
  - **战绩不保存**：不写 local-storage、不进战绩历史；对局状态仅存于组件内存，离开页面即弃（刷新即失，符合"快抽"定位）。
  - 牌组仍可选（默认「完整奇招」，可切换其余官方牌组）。
  - 旧存档（`mode==="cards"`）的渲染与导出保留兼容；旧 `SetupDialog` 的 `initialMode==="cards"` 新建流程被快抽流程取代。
- **中八云端实时房间支持奇招牌（用户已确认，本期纳入）**：见 2.6。注意 worker 目前**没有任何卡牌状态与命令**（连 `score_cards` 云端都只有模式标签），属绿地开发。

### 2.2 数据模型（`src/lib/eight-ball.ts`）
1. `EightBallMatch` 增加 `cards?: MatchCardState`（`import type { MatchCardState } from "./match"`）。
2. `EightBallDraft` 增加：`cardMode: CardMode`、`deckId?: OfficialDeckId`、`initialHandSize: number`、`cardAutoDrawPolicy?: AutoDrawPolicy`、`cardHandLimit?: number`、`cardExhaustionPolicy?: DeckExhaustionPolicy`、`cardFilter?: Partial<MatchCardFilter>`。
3. `createEightBallMatch`：`cardMode !== "none"` 时构建 `cards` 初始状态（牌组快照 + 过滤 + 起始手牌发牌），参照 `match.ts:200-248` 的初始化逻辑（`createDeck` + 过滤 + 按 `shared/independent` 发牌）。
4. **「每小局补满」钩子**：`recordEightBallRound` 确认本局后，若 `cards.autoDrawPolicy === "game"` 则按本轮补满各手牌（中八的「小局」= 每一局记录）。
5. **卡牌操作纯函数化（推荐，三方复用）**：`drawMatchCards`/`playMatchCard`/`skipMatchCard`/`updateMatchCardSettings` 目前绑定 `BilliardsMatch`。建议重构成以 `MatchCardState` 为轴心的纯函数（入参 `(cards, players)`，返回新 `cards`），使追分、中八、快抽三方复用同一套卡牌引擎；追分调用点只改签名不改变量名，行为不变。

### 2.3 设置弹窗（`EightBallSetupDialog`）
1. 在 03 之前插入分区 **03 奇招牌**（整体镜像 `SetupDialog:451-460`）：
   - 不抽牌 / 共用手牌 / 独立手牌 三段选择
   - 牌组选择（4 个官方牌组）+ 起始手牌数
   - 高级设置：自动补牌策略、手牌上限、牌库耗尽策略、最高安全等级、排除类别、排除关键词
2. 原「03 比赛资料」顺延为 04；分区序号 00/01/02 不变。
3. 底部确认时把卡牌配置并入 `EightBallDraft`；`valid` 校验在启用奇招牌时要求牌组与手牌数合法（参照追分）。
4. 若 `hostMode === "cloud"` 且 `cardMode !== "none"`：禁用/提示（见 2.6）。

### 2.4 中八局内卡片面板（`app/GameApp.tsx:726` eight-page）
1. 在「记录本局结果」与「逐局流水」之间插入卡片区，复用 `ScoreBoard` 的卡牌 UI（:548-584）：手牌标签（共用手牌/独立手牌按玩家）、抽一张、使用此卡、安全跳过、补牌策略/手牌上限/耗尽策略调整、确认重洗。
2. 顶栏标题在 `match.cards` 存在时显示「中八 · 奇招牌」；「规则与牌组快照」行加入牌组名与版本（参照 :624）。
3. 「确认本局」后自动触发 `game` 策略补牌（2.2-4）。

### 2.5 入口收拢
1. 首页 welcome-actions（:206-208）：三个主按钮改为「开始中八比赛 / 开始追分局 / 奇招牌快抽」——第三个由原「开始奇招牌局」改造为快抽入口（图标可保留 ◇）。
2. 玩法页 `PlayPage`（:634-636）：卡片 01「奇招卡牌局」改为「奇招牌快抽」卡片，副标题「一方或双方抽牌 · 不存战绩」；中八卡片（00）增加次按钮「同时加入奇招牌」（镜像追分卡片 :636 的交互），直接打开中八设置并预选奇招牌。
3. 快速开始 quick-grid（:239-242）：中八卡片描述改为「抢 N / 自由局 · 可选奇招牌 · 逐局流水」；「追分 + 奇招牌」保留（参照实现）；「奇招牌快抽」并入 quick-grid 或保留在玩法页。
4. 快抽弹窗与轻量对局（新组件，如 `QuickDrawDialog` / `QuickDrawBoard`）：
   - 弹窗：牌组（默认完整奇招）+ 一方抽/两方抽 + 各自张数（一方抽时先选 A/B 方；两方抽时 A、B 张数独立，允许不同，均 1–10 张）。
   - 轻量对局：两列手牌（A/B）+ 抽一张 / 使用此卡 / 安全跳过 / 补牌策略（可简化，默认手动），不显示计分与流水。
   - 状态：组件内 `useState`，**不写 storage、不进 history**；提供「结束并丢弃」。
5. `SetupDialog`：删除 `initialMode === "cards"` 的专用新建路径（标题/无计分分支），`scoreEnabled` 恒为 true；旧存档渲染不删。
6. 首页/历史文案中 `mode === "cards"` 的显示分支保留（兼容旧数据）。

### 2.6 云端实时房间支持中八奇招牌（本期纳入，绿地开发）
> 现状核实：worker 实时端**尚无任何卡牌状态与命令**——`chase-scoring.ts` 的 `ChaseScoreState` 只有 `mode: "score" | "score_cards"` 标签，无 `cards` 字段；`match-room.ts` 也无卡牌命令路由。即「追分 + 奇招牌」云端房间目前只显示标签，卡牌能力在云端并不存在。因此中八云端奇招牌需从零移植客户端 `match.ts` 的卡牌引擎，工作量按绿地估算。

1. **创建入口**（`worker/realtime/api.ts:163-221`）：direct 房间创建 body 增加卡牌配置（`cardMode/deckId/initialHandSize/cardAutoDrawPolicy/cardHandLimit/cardExhaustionPolicy/cardFilter`），`chinese_eight` 分支解析、校验（参照客户端 `MatchDraft` 校验）并存入初始状态。
2. **状态模型**（`worker/realtime/eight-ball-scoring.ts:26-35`）：`RealtimeEightBallState` 增加 `cards` 字段（JSON 化的 `MatchCardState`：牌堆/手牌/已用/跳过/事件/牌组快照/策略）。
3. **卡牌命令投影**：新增 `card.draw` / `card.play` / `card.skip` / `card.reshuffle` / `card.settings` 命令，投影函数把客户端 `match.ts` 的抽/用/跳/重洗/设置逻辑移植为服务端确定性实现（不可用 `Math.random` 的加密随机用 `secureRandomIndex` 等价物，参照追分计分命令的投影模式）。
4. **命令路由**（`worker/realtime/match-room.ts`）：`eightBall` 分支路由卡牌命令，快照（:824）与归档重建（:998-1060）携带 `cards`。
5. **前端云端面板**（`app/GameApp.tsx` `RealtimeEightBallPanel` ~:1018 区域）：对齐本机中八卡片面板；「确认本局」同样触发 `game` 策略补牌（经服务端命令）。
6. **顺带建议（低增量）**：同一套卡牌状态/命令可同时让 `score_cards` 云端房间获得卡牌能力（模式字符串已存在，仅缺状态与命令），避免将来两套实现。
7. **测试**：`match-room.integration.test.ts` 补中八云端卡牌用例（抽/用/跳/重洗/每局补牌、幂等、权限 403、归档重建带 cards）。

### 2.7 战绩与导出
1. 中八战绩详情/打印/SVG/JSON（:702-718、:762-775）：有 `cards` 时并入卡牌事件（参照追分 unified timeline :738）；导出标题带「· 奇招牌」标记。
2. 中八导出 JSON 自动包含 `match.cards`（随 match 序列化，无需额外处理）。

---

## 三、诉求 2：先开球 / 后续开球移入「比赛资料」并作为选填

### 3.1 设计决策（推荐方案）
- **UI 层面选填 + 数据默认值兜底**：表单上两个字段从「02 赛制与开局」移到「比赛资料」区并标注「选填」；**不填写即采用默认**——先开球默认「玩家 A」（names[0]），后续开球默认「轮流开球（alternate）」。
- **schema 不变**：`EightBallDraft.firstServer` / `serveRule` 与 `EightBallMatch.firstServerId` / `serveRule` 保持必填（由默认值兜底），**零迁移成本**、云端创建接口（`api.ts`）不用改。
  - 备选（不推荐）：draft 字段改为可选、`createEightBallMatch` 落默认值。多一层「是否显式选择」的记录才能做到「导出里没选就不显示」，复杂度收益不成比例；第一版导出总是显示默认值即可。

### 3.2 改动清单
1. `EightBallSetupDialog`（`app/GameApp.tsx:687`）：
   - 「02 赛制与开局」移除「先开球」「后续开球」两个 select，只留「赛制 / 抢几局」。
   - 「比赛资料」区（顺延编号）新增两行：`先开球`（玩家 A / 玩家 B，标注选填）、`后续开球`（轮流开球 / 胜者开球，标注选填）。
   - 提交 `onStart` 时仍传 `firstServer`、`serveRule`（值为默认或用户选择），`submitCloud` body（:667-674）不变。
2. 战绩导出（`printEightBall` :710、`exportEightBallImage` :717）：meta 行追加「先开球：X · 后续开球：轮流/胜者」。
3. 文案：「02 赛制与开局」小标题简化为「赛制」；「比赛资料」小标题保持「全部可选，将进入战绩导出」。
4. 测试：更新 e2e 中八建局用例（:37-63）断言表单结构；无逻辑变化。

---

## 四、影响面与风险

| 影响面 | 内容 | 风险 |
| --- | --- | --- |
| 测试 | `e2e/core-flows.spec.ts` 奇招牌局用例（:65-95）改写为「快抽」与「中八 + 奇招牌」两条流程；中八建局用例（:37-63）断言表单 | 中 |
| 数据兼容 | 旧 `cards` 存档与旧中八存档（无 cards 字段）继续可读/可导出 | 低 |
| 持久化/迁移 | `local-storage.ts`、`local-migration.ts`、`cloud-sync.ts`：cards 为可选 JSON 字段，校验与备份天然兼容；快抽不落盘，无迁移面 | 低 |
| 追分模型 | 卡牌操作重构为以 `MatchCardState` 为轴的纯函数，追分调用点只改签名、行为不变（有 `match.test.ts` 兜底） | 中 |
| 云端 | **绿地开发**：worker 现无任何卡牌状态/命令（`score_cards` 云端仅标签）；中八云端奇招牌 = 状态 + 命令投影 + 路由 + 归档重建 + 集成测试；顺带解锁 `score_cards` 云端卡牌 | 中高 |
| 单测 | `eight-ball.test.ts` 补 cards 初始化 / 每局补牌 / 用牌跳过用例；`match.test.ts` 回归保护纯函数化重构 | 低 |

---

## 五、里程碑划分

### M1 —— 诉求 2（独立小步，约 0.5～1 人日）
- 中八设置弹窗：先开球 / 后续开球移入比赛资料（选填 + 默认值兜底）
- 战绩导出 meta 追加开球规则
- e2e 中八建局用例更新

### M2 —— 诉求 1 本机（约 3～5 人日）
- 卡牌引擎纯函数化重构（`match.ts`：`draw/play/skip/updateMatchCardSettings` 改为以 `MatchCardState` 为轴），`match.test.ts` 回归
- `eight-ball.ts`：`cards` 字段 + draft 扩展 + 建局初始化 + 「确认本局」game 策略补牌
- `EightBallSetupDialog`：新增 03 奇招牌分区（镜像追分）
- 中八计分板：卡片面板（抽/用/跳/补牌/重洗）+ 顶栏「中八 · 奇招牌」标识
- 快抽入口：`QuickDrawDialog`（一方/两方、各抽几张可不同）+ 轻量对局（A/B 席位、无玩家、不存战绩）
- 入口收拢：首页 / 玩法页 / 快速开始；`SetupDialog` 移除纯 cards 新建路径
- 本机战绩导出并入卡牌事件（unified timeline，参照 :738）
- 单测（eight-ball.test.ts）+ e2e（快抽、中八 + 奇招牌流程）更新

### M3 —— 中八云端奇招牌（绿地，约 3～5 人日；可与 M2 并行开发）
- 前置：M2 的卡牌引擎纯函数（服务端移植同一套规则，保证本机/云端结果一致）
- `api.ts`：direct 创建解析卡牌配置并校验
- `eight-ball-scoring.ts`：`RealtimeEightBallState.cards` + `card.draw/play/skip/reshuffle/settings` 命令投影
- `match-room.ts`：命令路由、快照、归档重建携带 cards
- 前端 `RealtimeEightBallPanel` 卡片面板（本机面板同款交互）+ 确认本局触发补牌
- 顺带：`score_cards` 云端房间接入同一套卡牌状态/命令（低增量）
- `match-room.integration.test.ts` 云端卡牌用例

---

## 六、验收标准

1. 首页与玩法页的独立「奇招牌局」入口替换为「奇招牌快抽」：进入直接选一方抽 / 两方抽，各抽几张可分别设置（允许不同）；不加入玩家（无姓名/计分/流水）；结束即弃，**战绩历史无任何记录**、local-storage 无新增键。
2. 中八设置可勾选奇招牌：不抽牌 / 共用手牌 / 独立手牌 + 牌组 + 起始手牌 + 高级设置，交互与追分一致；中八卡片有「同时加入奇招牌」快捷入口。
3. 中八局内可抽牌、使用、安全跳过、调整补牌策略；「每小局补满」在确认本局后自动生效；本机战绩导出包含卡牌事件。
4. 旧「奇招牌局」战绩（mode === "cards"）仍可查看与导出。
5. 中八设置页「赛制与开局」只含赛制/抢几局；先开球、后续开球位于「比赛资料」且可不填（默认玩家 A 先开、轮流开球）。
6. 中八云端实时房间支持抽/用/跳/补牌/重洗，多端同步一致，归档重建保留卡牌状态；`score_cards` 云端房间获得同样卡牌能力（顺带项）。
7. `npm run test`、`npm run test:worker`、`npm run lint`、桌面与移动 E2E 全部通过。
