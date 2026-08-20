# 实时房间体验三项修改路线（房主昵称 / 认领席位选中 / 局内临时玩家改名）

> 版本：v1.0（草案）｜状态：待评审
> 目标：基于 3 个已确认需求（①开房时房主昵称默认为第一个玩家的名字；②认领席位时加分所选位置改为认领人的名字（即当前选中的人物）；③局内支持修改非注册用户的名字），给出可执行的修改路线。
> 相关文档：[P1_REALTIME_NICKNAME.md](./P1_REALTIME_NICKNAME.md)、[REALTIME_ROOM_FULLSCREEN_ROADMAP.md](./REALTIME_ROOM_FULLSCREEN_ROADMAP.md)、`taiqiuqizhao/ROADMAP.md`（阶段 2 P2 游客）。

---

## 1. 需求与现状

### 1.1 三项需求

| 编号 | 需求 | 现状 | 建议优先级 |
|------|------|------|-----------|
| R1 | 开启房间时，**房主昵称默认取第一个玩家的名字**（而非注册昵称） | 开房时房主成员的 `nickname` 固定写 `session.user.nickname`（注册昵称），成员列表显示「张伟」而不是草稿第一位「玩家 A」 | P0 |
| R2 | **认领席位时，加分所选位置改为认领人的名字，即当前选中的人物** | 「认领席位」按钮固定绑定**首个**未认领空席位（`GameApp.tsx:1403`）；计分板 `selectedId`（加分所选位置）不跟随被认领席位 | P0 |
| R3 | **局内支持修改非注册用户（未绑定注册成员的临时席位）的名字** | 实时房间内无任何改名入口；本机中八已支持局内改名（`src/lib/eight-ball.ts:140`），实时房间缺失 | P1 |

### 1.2 术语约定

- **成员（member）**：注册用户，`room_members` / `match_players` 中 `user_id` 非空，角色 host / player / spectator。
- **席位（seat / player）**：局内计分对象，`match_players` 中 `role='player'`（或 host 行），`user_id` 为空时即「临时席位 / 非注册用户」（归档时 `kind: "guest"`，见 `match-room.ts:891`）。
- **加分所选位置**：追分计分板 `RealtimeChasePanel` 中 `selectedId` 高亮的选手位，`score.apply` 的 `playerId` 取它（`GameApp.tsx:948`）。
- **非注册用户**：当前架构下指**未绑定注册成员的席位**（`player.userId === undefined`），与 ROADMAP P2 的 guest 概念对齐。

**产品模型（产品已确认，本节为权威口径）**：

- **临时席位（`userId` 为空的席位）＝ 分配给没有账号的朋友**。房主开房后，没账号的朋友入座这些临时席位；R3 支持房主在局内把席位名改成朋友的真实名字。
- **房主（开房人，注册用户）＝ 第一位玩家的身份**：开房时房主昵称默认为第一个玩家的名字（R1），房主在房间成员列表中即以该名字出现（与其线下对局中的身份一致），而非账号注册昵称。
- **认领席位（R2）＝ 把【有账号】的朋友（注册成员）绑定到席位**：绑定后该席位显示其注册昵称，加分所选位置即认领人。
- 三个需求覆盖三类对象，互不冲突：**房主本人（R1）→ 有账号的朋友（R2 认领）→ 没账号的朋友（R3 临时席位改名）**。

### 1.3 代码定位清单（现状核对，实施前复核行号）

| 需求 | 真实位置 | 现状说明 |
|------|----------|----------|
| R1 | `worker/realtime/api.ts:398` `createRoom`（`421`/`426` 复用路径、`457`/`463` 新开路径）、`471` `createDirectRoom`（`485` host 对象、`489` ensureHostPlayer、`536-539` D1 host 行 INSERT） | 房主成员昵称全部硬编码为 `session.user.nickname` |
| R1 | `worker/realtime/api.ts:381` `ensureHostPlayer`；`match-room.ts:118` `initialize`（host 成员写入） | 昵称参数需换成第一位玩家名；复用房间时 `ensureHostPlayer` 只 UPDATE role 不改昵称（`386-387`） |
| R1 | `worker/realtime/api.ts:290` `loadChaseScoreState`（`players[].nickname`）、`357` `loadEightBallState`（`rows.results[0].nickname_snapshot`）；`app/GameApp.tsx:273`（草稿默认名「玩家 A / 玩家 B」） | 第一位玩家名 = `chaseScore.players[0].nickname` / `eightBall.players[0].nickname` / `draft.players[0].name` |
| R2 | `app/GameApp.tsx:1401` `claimSeatForMember`（`1403-1404` 取首个空席位）、`1410` claim 请求（URL 已带 `seat.id`，服务端本就支持指定席位）；`948` `selectedId` 与 `score.apply` | 认领固定命中第一个空席位；加分选中项不跟随 |
| R2 | `worker/realtime/api.ts:828` claim 路由（`842` 调 `claimSeat`）；`match-room.ts:361` `claimSeat`（`383` displayName 快照、`389-399` 更新席位昵称+userId、`player.claimed` 事件） | 服务端无改动需求：claim 已支持任意 `playerId`，事件已回传 `payload.playerId` |
| R3 | `match-room.ts:361` `claimSeat`（可整体复制的模式：权限校验 → displayName 校验 → 席位 nickname 更新 → 事件 → 广播）、`705` `appendEvent`、`1012/1019` chase 状态读写、`1029/1036` eightBall 状态读写 | 需要新增 `renameSeat` 命令 + `player.renamed` 事件 |
| R3 | `worker/realtime/api.ts:830-867` claim 处理器（host 校验 + DO 调用 + D1 `nickname_snapshot` 收敛）、`983-990` players 路由表 | 需要新增改名端点，沿用该收敛模式 |
| R3 | `match-room.ts:868` `buildArchiveSnapshot`（chase `890`、eight `949`：`name` 优先取基线 `stored.name`） | 归档名优先取草稿基线名；改名后若不同步基线，归档仍显示旧名（与 P1 已知限制一致，见 P1 文档 §6.1） |
| R3 | `app/GameApp.tsx:948`（追分选手位）、`1003-1009`（中八选手卡）、`855-894`（`RealtimeMember` / `RealtimeChaseScore.players` / `RealtimeEightBall.players` 类型，已含 `userId?`） | 需要增加改名入口（仅房主、仅未绑定席位） |
| 参考 | `src/lib/eight-ball.ts:140` `renameEightBallPlayer`（本机中八改名，事件 `type:"rename"`）；`GameApp.tsx:727`（本机中八计分板内联改名输入） | 实时房间改名的前端交互可参考此实现 |

---

## 2. 方案设计

### 2.1 R1：房主昵称默认为第一个玩家的名字（后端为主）

**目标**：开房（含从云端对局开房 `createRoom` 与直接建房 `createDirectRoom`）后，房主成员在成员列表中的昵称显示为**对局草稿第一位玩家的名字**（如「玩家 A」），而不是注册昵称。

**产品口径（按 1.2 模型）**：房主即第一位玩家的身份——开房人在线下对局中给自己起的名字（草稿第一位玩家名）就是他在房间里的名字；房主**不需要**认领席位来「占有」第一位，第一位席位本来就以该名字显示，与成员列表一致。其余临时席位（`userId` 为空）才是分配给没账号的朋友的（R3 改名），与 R1 互不影响。

**改动点**

| 文件 | 改动 |
|------|------|
| `worker/realtime/api.ts` | ① 提取 `firstPlayerName(chaseScore, eightBall, draft?)`：`chaseScore?.players[0]?.nickname ?? eightBall?.players[0]?.nickname ?? draft?.players[0]?.name ?? session.user.nickname`（兜底注册昵称）；② `createRoom` 两处 `ensureHostPlayer(...)` 与两处 `host` 对象的 `nickname` 改为该值；③ `createDirectRoom` 的 `host`（`485`）、`ensureHostPlayer`（`489`）、D1 host INSERT（`536-539`）同步替换；④ 复用房间路径（`existing` 分支）在 `ensureHostPlayer` 后补一条 `UPDATE match_players SET nickname_snapshot = ?1 WHERE match_id = ?2 AND user_id = ?3 AND role = 'host'`（`ensureHostPlayer` 现有 UPDATE 只改 role，需显式收敛昵称） |
| `worker/realtime/match-room.ts` | 无改动（`initialize` 已按 `input.host.nickname` 写入 `room_members`，见 `142-146`） |
| `app/GameApp.tsx` | 无改动（成员列表渲染 `memberDisplayName(member)`，自动生效） |

**边界**
- 只影响**开房时刻**的 host 成员昵称快照；已存在的房间复用时不覆盖 DO 内 `room_members.nickname`（与 P1「加入时快照」原则一致），仅收敛 D1 侧。
- `loadChaseScoreState` 在 DO 重建时优先取基线 `source.name`（P1 §6.1 已知限制），与 R1 无关，不在此处理。

**验证**：开房后 GET 房间快照，`snapshot.members` 中 host 的 `nickname` 等于草稿第一位玩家名；直接建房路径（`/api/realtime/rooms/direct`）同样成立。

---

### 2.2 R2：认领席位与加分所选位置联动（前端为主）

**目标**：认领席位时，加分所选位置（计分板当前高亮选手位）即认领目标；认领成功后该席位显示认领人（注册成员）的名字，加分操作直接作用于认领人。

**需求解读（两层面，推荐都做）**
- **层面 A（认领目标 = 当前选中席位）**：房主先在计分板点选某席位（`selectedId`，即「当前选中的人物」），再对成员点「认领席位」→ 绑定**该选中席位**而非第一个空席位；未选中时回退首个空席位。
- **层面 B（选中跟随）**：认领成功后计分板选中项切到被认领席位，其昵称即认领人名字（服务端已把席位昵称改为成员注册昵称快照，`match-room.ts:383`）。

**改动点（全部在前端 `app/GameApp.tsx`）**

| 改动 | 位置 |
|------|------|
| 把 `RealtimeChasePanel` 的 `selectedId` 状态提升到 `RealtimeRoomPanel`（或通过 `onSeatClaimed(seatId)` 回调 / `claimedSeatId` prop 下推），使成员列表能读到「当前选中席位」 | `RealtimeChasePanel`（`~920`）、`RealtimeRoomPanel` |
| `claimSeatForMember` 改为：优先使用当前选中的**有效空席位**（`active && !userId`），否则回退 `find(首个空席位)`；请求 URL 使用该 `seat.id`（服务端已支持） | `1401-1430` |
| 认领成功后（`player.claimed` 事件 / 响应 `event.payload.playerId`）把选中项设为该席位；`RealtimeChasePanel` 收到 `selectedId` 变化后高亮即认领人 | 事件处理（`~1160`）或 `refreshRoom` 后同步 |
| 中八面板（`RealtimeEightBallPanel`）为固定双席位、无「加分所选位置」，仅需保证认领后计分板显示认领人名字（现有行为已满足），无需选中联动 | — |

**验证**：房主选中席位 B → 对成员「认领席位」→ 席位 B 显示该成员注册昵称且保持高亮，点加分按钮作用于席位 B。

---

### 2.3 R3：局内修改非注册用户（临时席位）的名字（后端 + 前端 + D1 收敛）

**目标**：房间进行中，房主可修改**未绑定注册成员**的席位昵称（追分与中八均支持），改后即时广播给所有客户端，并收敛 D1 使归档与重建保留新名。

**典型用例（按 1.2 模型）**：没账号的朋友入座临时席位后，房主在局内把「玩家 B」改成朋友的真实名字（如「老王」），计分板、流水与归档统一显示新名。

**服务端**

| 文件 | 改动 |
|------|------|
| `worker/realtime/match-room.ts` | 新增 `renameSeat(input: { operationId; expectedVersion; actorUserId; playerId; nickname })`，整体复刻 `claimSeat`（`361-422`）骨架：① actor 必须为 host；② 席位存在且 `!player.userId`（已绑定注册成员的席位**拒绝改名**，其显示名 = 注册昵称快照）；③ 昵称校验：`trim().slice(0, 80)`，空值拒绝（对齐 `claimSeat` 的 displayName 规则，`383`）；④ chase / eightBall 分别更新席位 `nickname` 并 `persist*State`；⑤ `appendEvent(..., "player.renamed", { playerId, nickname, previousNickname })`；⑥ 成功后 `broadcast` |
| `worker/realtime/api.ts` | 新增 `PATCH /api/realtime/rooms/:code/players/:playerId/name`（body：`operationId`、`expectedVersion`、`nickname`），复刻 claim 处理器（`830-867`）：host 校验（`room.owner_user_id !== session.user.id` → 403）→ DO `renameSeat` → 成功后收敛 D1 `match_players.nickname_snapshot`（`860` 同款 UPDATE）→ `commandResponse`。路由注册在 `983-990` players 路由旁 |
| 事件结构 | `player.renamed` payload：`{ playerId, nickname, previousNickname }`；快照无需新字段（席位 `nickname` 即显示名） |

**D1 / 归档一致性（关键）**

`buildArchiveSnapshot`（`match-room.ts:868`）chase 分支 `890`、eight 分支 `949` 的 `name` **优先取基线 `stored.name`（草稿名）**。只收敛 `nickname_snapshot` 无法让归档/重建显示新名（与 P1 已知限制同源）。推荐二选一：

- **方案 B（推荐）**：改名 API 成功后在 D1 额外做一次「基线同步」——读 `matches.snapshot_json`，把对应 `players[i].name` 改为新名后写回（read-modify-write，沿用 `assignMemberRole` 的 retryable 503 收敛模式，`api.ts:663-672`）。顺带修复 P1 §6.1「DO 重建回退草稿名」问题；认领路径可后续同法补齐。
- **方案 C（更小改动）**：`buildArchiveSnapshot` 改为「存在 `player.renamed` / 已认领（`userId` 非空）时优先 `player.nickname`」。注意：这会改变现有「已认领席位归档显示草稿名」的行为（当前归档测试未断言玩家名，见 `match-room.integration.test.ts:1259`），需人工回归确认。

**前端（`app/GameApp.tsx`）**

| 改动 | 位置 |
|------|------|
| 追分选手位：`isHost && !player.userId` 时显示「改名」入口（铅笔按钮 → 内联输入 → 确认/取消），输入框 `maxLength={12}` 与开房草稿一致（`273`）；确认后调 `renamePlayer(playerId, nickname)` | `RealtimeChasePanel`（`~948` 选手位渲染） |
| 中八选手卡：同样在 `!player.userId` 时提供改名入口（交互参考本机中八 `727` 的内联输入） | `RealtimeEightBallPanel`（`1003-1009`） |
| `RealtimeRoomPanel` 新增 `renamePlayer`：`PATCH /api/realtime/rooms/${activeCode}/players/${playerId}/name`，body 带 `operationId` / `expectedVersion` / `nickname`，成功后 `refreshRoom()`；沿用 503 retryable 重试一次的模式（参考 `changeRole`，`1270-1297`） | `RealtimeRoomPanel` |
| 类型：`RealtimeChaseScore.players` / `RealtimeEightBall.players` 已含 `userId?`，无需扩展 | — |

**权限与校验**
- 仅房主可改名（与认领/移除/踢出权限一致）；已绑定注册成员的席位禁止改名（见待决策 D3）。
- 校验规则与 `claimSeat` 对齐：`trim` 后 1–80 字符；是否引入用户名规则（2–8 位白名单，见 ROADMAP 2.3）作为待决策 D5。

**验证**：房主把「玩家 A」改为「老周」→ 所有客户端计分板即时更新；结束对局归档后快照玩家名为「老周」。

---

## 3. 分阶段实施路线

> 每个阶段独立可交付、可验证；R1/R2/R3 互不阻塞，可并行。

### 阶段 0：现状复核（约 0.5 人日）
- [ ] 复核 1.3 清单的行号与行为（开房 host 昵称、认领首个空席位、计分板选中不跟随、无改名入口）。
- 产出：确认版代码定位清单；锁定 R2 需求解读（见待决策 D1）。

### 阶段 1：R1 房主昵称（约 0.5 人日）
- 按 2.1 修改 `worker/realtime/api.ts`（4 处 host 昵称 + 复用路径收敛）。
- 验证：`npm run test:worker` 新增 1 条集成用例（开房后 host 成员昵称 = 第一位玩家名；复用房间时 D1 host 行昵称收敛）；手工：从对局开房 / 直接建房两种路径检查成员列表。

### 阶段 2：R2 认领席位选中联动（约 0.5–1 人日）
- 按 2.2 提升 `selectedId`、改 `claimSeatForMember`、认领成功后同步选中。
- 验证：手工回归「选中席位 B → 认领 → B 显示认领人名且高亮 → 加分作用于 B」；「未选中 → 认领 → 回退首个空席位」；中八认领显示不受影响。

### 阶段 3：R3 局内临时玩家改名（约 1–2 人日）
- 服务端：`match-room.ts` `renameSeat` + 事件；`api.ts` 端点 + D1 收敛（含基线同步方案 B）。
- 前端：追分/中八改名入口 + `renamePlayer`。
- 验证：`npm run test:worker` 新增集成用例（权限 403、非注册席位可改、已绑定席位拒绝、幂等 duplicate、D1 `nickname_snapshot` 收敛、`player.renamed` 事件）；手工：改名 → 广播 → 归档名。

### 阶段 4：回归（约 0.5–1 人日）
- [ ] `npm run test`、`npm run test:worker`、`npm run lint`、`tsc --noEmit` 全绿。
- [ ] 回归 P1 认领链路（`match-room.integration.test.ts:1095` 两条用例不受影响）、归档链路（`1259`）。
- [ ] e2e：`e2e/room-fullscreen.spec.ts` 无登录链路，本次三项均为登录态功能，e2e 仅做外壳回归（沿用现有说明）。

**合计约 3–5 人日**（不含待决策评审时间）。

---

## 4. 验收标准

### R1
- [ ] 从云端对局开房 / 直接建房后，成员列表中房主昵称 = 草稿第一位玩家名（无玩家时回退注册昵称）。
- [ ] 复用已存在房间（503 重连路径）不产生重复房主行，D1 host 行昵称与 DO 一致。

### R2
- [ ] 房主选中计分板某席位后认领成员，绑定的是**该选中席位**（非第一个空席位），席位显示认领人注册昵称且保持选中。
- [ ] 认领后点加分按钮，`playerId` 为被认领席位（认领人），分值正确落账。
- [ ] 未选中席位时认领仍可工作（回退首个空席位），行为与现状兼容。

### R3
- [ ] 房主可在局内修改未绑定注册成员的席位昵称，全客户端即时同步显示。
- [ ] 已绑定注册成员的席位无改名入口 / 服务端拒绝（403 或 400）。
- [ ] 改名后结束对局，归档快照与云端战绩中的玩家名为新名（方案 B/C 生效）。
- [ ] 非房主调用改名接口被拒绝；重复提交同一 operationId 幂等成功。
- [ ] 昵称超长 / 空值被拒绝，无 XSS 注入（文本渲染沿用现有 React 转义）。

---

## 5. 待决策项（需产品确认，⚠️ 阻塞排期项）

| 编号 | 决策点 | 结论 / 选项建议 | 影响 |
|------|--------|----------|------|
| D1 | R2 需求解读：是「认领当前选中席位」（层面 A），还是「认领后选中跟随」（层面 B）？ | **已确认：A+B 都做**（A 是主诉求：认领目标 = 计分板当前选中席位；B 是 A 的自然结果：认领后加分所选位置即认领人。产品模型（临时席位 = 没账号的朋友）不改变该设计，见 2.2）✅ | 阶段 2 范围 |
| D2 | R3 改名权限：仅房主，还是 player 成员也可改（非注册席位）？ | **推荐仅房主**（与认领/移除/踢出权限一致）⚠️ | 阶段 3 权限边界 |
| D3 | 已绑定注册成员的席位（`userId` 非空）是否允许改名？ | **推荐禁止**（显示名 = 注册昵称快照，改名应走账号资料） | 阶段 3 校验 |
| D4 | R3 持久化策略：方案 B（同步基线 `snapshot_json`，顺带修复 P1 §6.1）还是方案 C（`buildArchiveSnapshot` 优先实时名，改变现有认领归档行为）？ | **推荐方案 B**（改动面可控，与 D1 收敛模式一致）⚠️ | 阶段 3 工作量 |
| D5 | 改名昵称校验规则：沿用 `claimSeat` 的 1–80 字符，还是引入 ROADMAP 2.3 的统一用户名规则（2–8 位白名单）？ | **推荐沿用 1–80**（临时席位是显示名而非账号名，与开房草稿 `maxLength=12` 一致）⚠️ | 阶段 3 校验与提示 |
| D6 | 房主昵称（R1）改为第一位玩家名后，「房主再认领席位」的显示名是否符合预期？ | **已按产品模型确认 ✅**：① 房主 = 第一位玩家的身份，开房后成员列表即显示第一位玩家名，**房主无需认领席位来占位**；② 未绑定注册成员的临时席位 = 分配给没账号的朋友（R3 改名对象）；③ 「认领席位」（R2）= 把**有账号**的朋友绑定到席位，显示其注册昵称。三者互不重叠，原问题场景不成立 | 阶段 1 口径 |

---

## 6. 风险与注意事项

| 编号 | 风险 | 应对 |
|------|------|------|
| R1 | 房主昵称改默认值后，老客户端仍显示旧字段（无兼容问题，仅显示名） | R1 只改开房写入值，消息结构不变，向后兼容 |
| R2 | 状态提升 `selectedId` 后，快照刷新可能重置选中（`refreshRoom` 每次全量拉取） | 选中态存于 `RealtimeRoomPanel`（组件外），刷新后按席位 id 恢复；被移除席位自动回退 |
| R3 | 归档名仍取基线草稿名（若选方案 C 需改变量） | 采用方案 B 同步基线；归档用例 `1259` 未断言玩家名，改动安全 |
| R3 | D1 收敛失败导致改名「房内生效、归档旧名」 | 沿用 retryable 503 + 同 operationId 重试模式（`api.ts:663-672`）；DO 为实时权威 |
| R3 | 改名与认领并发（先认领后改名、先改名后认领） | 命令均带 `expectedVersion`，冲突返回 409；改名仅限 `!userId` 席位，认领会清空改名前提，行为自洽 |
| 全部 | 集成测试环境（miniflare）与线上 D1 行为差异 | 集成用例覆盖 DO + D1 收敛断言（沿用 `match-room.integration.test.ts` 既有模式） |

---

## 7. 交付物清单

- [x] 本路线文档（`docs/REALTIME_ROOM_UX_ROADMAP.md`）
- [ ] 阶段 0：复核后的代码定位清单（更新 1.3 行号）
- [ ] 阶段 1：R1 实现 + 1 条集成用例
- [ ] 阶段 2：R2 前端实现 + 手工回归记录
- [ ] 阶段 3：R3 服务端（`renameSeat` / 端点 / 收敛）+ 前端改名入口 + 集成用例
- [ ] 阶段 4：全量测试 / lint / tsc 通过记录与归档回归
