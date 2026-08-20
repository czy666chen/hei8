# P1 实时房间注册用户昵称显示 — 实施与验收

> 对应 [ROADMAP.md](../ROADMAP.md)（工作区 `taiqiuqizhao`，v1.2 草案）**阶段 0（现状梳理）+ 阶段 1（P1）**。
> 问题：实时房间中新加入的注册用户被显示为「玩家A / 玩家B」等占位名，而非其注册昵称。
> 状态：**已实施**（提交于 v5.3.0 候选）。

---

## 1. 阶段 0：代码定位清单

ROADMAP 写作时工作区仅有 Git 骨架（无源码），本节把占位符替换为真实代码位置，作为后续 P2/P4 的复用依据。

| ROADMAP 任务 | 真实位置 | 现状说明 | 处置 |
|---|---|---|---|
| 0.1 「玩家A / 玩家B」生成与兜底 | `app/GameApp.tsx:272`、`app/GameApp.tsx:650`（本机/云端草稿默认席位名 `["玩家 A","玩家 B"]`）；`src/lib/deck.ts:231-232`、`src/lib/local-storage.ts:196-197`（本机旧数据） | 实时房间计分板席位名直接来自草稿名；房主不修改时即显示「玩家 A / 玩家 B」 | 席位名改由「注册成员认领」驱动（见第 3 节）；本机默认名保留（不属于实时房间） |
| 0.2 实时房间加入流程 | `worker/realtime/api.ts:583` `joinRoom`；`worker/realtime/api.ts:398` `createRoom`、`471` `createDirectRoom`；`worker/realtime/match-room.ts:142` `addMember`、`107` `initialize` | 注册用户加入时成员昵称已写入 `session.user.nickname`（`api.ts:627`），快照 `members[].nickname` 正确；**但席位（score/eightBall players）与注册成员无关联**，计分板显示草稿占位名 | 新增「席位认领」链路（见第 3 节） |
| 0.3 提示文案来源 | — | 不属于 P1 | 见 P3 阶段 4 |
| 0.4 注册用户名校验 | `worker/auth/core.ts:47-51`（昵称 1–40 字符）；`worker/auth/api.ts:178` | 注册必填昵称，回退用户名 | 见 P4 阶段 3 |
| 0.5 实时通信协议 | WebSocket + Durable Object（`worker/realtime/match-room.ts`），HTTP 命令 + WS 广播；全量/增量快照同步 | 前端收到事件后 `refreshRoom()` 全量拉取快照（`app/GameApp.tsx:1152`），显示名天然收敛 | 广播 payload 补充 `nickname`（displayName），见第 4 节 |

### 参与者模型（对齐 ROADMAP 2.1）

```ts
// worker/realtime/match-room.ts
type RoomMember = {
  userId: string;
  nickname: string;          // 即 displayName：加入时的注册昵称快照
  role: "host" | "player" | "spectator";
  joinedAt: number;
  playerType?: "registered" | "guest";  // P1 恒为 registered；P2 扩展 guest
};
```

设计原则落实：**座位号（seat_no）只用于布局，显示名一律取 `nickname`（displayName）**。
席位模型同步扩展（`worker/realtime/chase-scoring.ts` / `eight-ball-scoring.ts`）：`players[].userId?` 记录绑定的注册成员，`players[].nickname` 即席位显示名。

---

## 2. 与 ROADMAP 假设的差异说明

ROADMAP 以「席位 = 参与者、座位号 = 玩家A/B」的旧模型为出发点；真实代码库（v5.1.0–v5.2.0）已把「成员（注册账号）」与「席位（局内草稿选手）」分离：

- 成员（`room_members` / `match_players.role`）：注册用户，join 时已写入真实昵称，成员列表显示正确。
- 席位（`match_players.role='player'`、`user_id NULL`）：局内计分对象，显示名来自房主草稿名（默认「玩家 A/B」）。

因此 P1 的真实缺口是**席位显示名与注册成员脱节**：被提升为玩家的注册用户在计分板上没有以自己昵称呈现的席位。本实施以「**席位认领（seat claim）**」补齐该缺口：房主把注册成员绑定到空席位，席位显示名切换为该成员注册昵称快照，其余客户端经实时广播即时可见。

---

## 3. P1 实施内容

### 3.1 服务端

| 文件 | 改动 |
|---|---|
| `worker/realtime/match-room.ts` | ① `RoomMember` 增加 `playerType`（P1 恒为 `registered`）；② `member.role_changed` / `member.left` / `member.kicked` 广播 payload 增加 `nickname`（displayName）；③ 新增 `claimSeat` 命令（仅房主；目标成员须为 host/player；幂等；写入 `player.claimed` 事件并更新 chase/eightBall 席位 `nickname`+`userId`） |
| `worker/realtime/api.ts` | 新增 `POST /api/realtime/rooms/:code/players/:playerId/claim`（body：`operationId`、`expectedVersion`、`userId`）；成功后收敛 D1 席位 `nickname_snapshot`（保留归档昵称；**刻意不写 `user_id`**，避免破坏「无流水席位可整体移除」路径） |
| `worker/realtime/chase-scoring.ts` / `eight-ball-scoring.ts` | 席位类型增加可选 `userId?: string`（绑定注册成员） |

无昵称回退（D1）：注册必填昵称（`worker/auth/core.ts:47-51`，1–40 字符，缺失时回退用户名），服务端 `claimSeat` 对昵称做 trim + 空值回退 `玩家${userId尾号}`；前端统一 `memberDisplayName()` 兜底渲染。

### 3.2 前端（`app/GameApp.tsx`）

| 改动 | 位置 |
|---|---|
| `RealtimeMember` / `RealtimeChaseScore.players` / `RealtimeEightBall.players` 类型增加 `playerType?` / `userId?` | ~L853–878 |
| 新增 `memberDisplayName()` 兜底 helper（D1 回退「玩家+ID尾号」） | ~L898 |
| 成员列表：房主对 `player` 成员显示「认领席位」按钮（绑定首个未认领空席位，禁用态提示），席位牌显示名即注册昵称 | `RealtimeRoomPanel` |
| 踢出 / 解除限制的确认与提示统一使用 `memberDisplayName` | `kickMember` / `unbanMember` |

绑定后计分板、回合指示、流水中的席位昵称即为注册昵称；其余客户端经 `player.claimed` 事件 → `refreshRoom()` 即时同步（`app/GameApp.tsx:1152`）。

---

## 4. 消息结构说明（P1 相关）

```ts
// 加入（POST /api/realtime/rooms/:code/join，HTTP 201）
{ role, version, room: { code, matchId }, snapshot }

// 席位认领（POST /api/realtime/rooms/:code/players/:playerId/claim，HTTP 200）
{ ok, duplicate, version, event: { sequenceNo, operationId, actorUserId, kind: "player.claimed",
  payload: { playerId, userId, nickname /* displayName 快照 */ }, createdAt } }

// 事件广播（WebSocket，type: "event"）— 均携带 displayName：
member.joined      payload: { userId, nickname, role }
member.role_changed payload: { userId, nickname, role }
member.left         payload: { userId, nickname }
member.kicked       payload: { userId, nickname, kickedByUserId }

// 快照（WebSocket / GET 房间）— 参与者统一模型：
snapshot.members[]        = { userId, nickname, role, joinedAt, playerType: "registered" }
snapshot.chaseScore.players[] / snapshot.eightBall.players[] = { id, nickname, userId?, ... }
```

兼容性：新增字段均为可选/追加，旧客户端忽略未知字段（R1 向后兼容策略）。

---

## 5. 验收核对

| ROADMAP P1 验收标准 | 落实 |
|---|---|
| 注册用户加入实时房间后，所有界面展示其注册昵称，全程不出现「玩家A / 玩家B」 | ✅ 成员列表始终显示注册昵称（既有）；席位经房主「认领席位」后显示注册昵称快照（新增） |
| 中途加入的玩家，其他客户端能即时看到其真实昵称（实时广播生效） | ✅ `member.joined` / `player.claimed` 事件 → 快照刷新即时同步 |
| 无昵称账号有明确回退显示，不出现空白 / 占位符 | ✅ 注册必填昵称；服务端 + 前端双层 `玩家${ID尾号}` 回退 |
| 聊天、计分、回合提示中的昵称与座位牌一致 | ✅ 计分板 / 回合指示 / 流水全部渲染席位 `nickname`（即 displayName），绑定后与成员一致；当前无聊天模块 |

自动化验证：`worker/realtime/match-room.integration.test.ts` 新增 2 条用例（追分席位认领全链路：权限 403、幂等 duplicate、D1 昵称快照收敛；中八席位认领）；`tsc --noEmit`、`npm run test:worker`、`npm run test`、`npm run lint` 全部通过。

---

## 6. 已知限制与后续

1. **DO 重建回退**：席位认领的绑定关系只存于 Durable Object 状态；若房间因平台故障从 D1 重建，席位显示名回退为草稿名（`nickname_snapshot` 已同步认领名，但 `loadChaseScoreState` 优先取快照 `source.name`）。发生率极低，后续可将认领写入 `matches.snapshot_json` 以彻底持久化。
2. **认领粒度**：当前 UI 为「绑定到首个未认领空席位」；如需指定席位，可扩展为席位侧下拉选择成员。
3. **P2 游客**：`playerType` / 席位 `userId` 结构已预留；游客加入时扩展为 `guest` 并签发 guestId，无需再动席位显示链路。
