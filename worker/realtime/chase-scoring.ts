import type { RoomCardState } from "./room-cards";

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonScalar[] | { [key: string]: JsonScalar };
export type JsonObject = { [key: string]: JsonValue };

export type ChaseScoreRule = {
  id: string;
  label: string;
  value: number;
  kind: "gain" | "penalty";
  enabled: boolean;
};

export type ChaseScorePlayer = {
  id: string;
  /** 显示名（displayName）：P1 绑定注册成员后为注册昵称快照。 */
  nickname: string;
  /** P1：绑定的注册成员 userId（未绑定为 undefined）。 */
  userId?: string;
  initialScore: number;
  score: number;
  active: boolean;
};

export type ChaseScoreState = {
  mode: "score" | "score_cards";
  players: ChaseScorePlayer[];
  rules: ChaseScoreRule[];
  currentPlayerId: string;
  turnStrategy: "fixed" | "winner_stays";
  cards?: RoomCardState;
};

export type ChaseScoringEvent = {
  sequenceNo: number;
  kind: string;
  payload: JsonObject;
};

export type ChaseCommand = {
  kind: string;
  payload: JsonObject;
  now: number;
};

export type ChaseCommandProjection = {
  kind: "score.recorded" | "score.corrected" | "turn.changed";
  payload: JsonObject;
  state: ChaseScoreState;
};

export type ChaseCommandError = "invalid_command" | "not_found";

const MAX_SCORE_MAGNITUDE = 1_000_000_000;
const MAX_DELTA_MAGNITUDE = 1_000_000;

function text(value: JsonValue | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function optionalText(value: JsonValue | undefined, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return "";
  return text(value, maxLength);
}

function integer(value: JsonValue | undefined, options: { min?: number; max?: number } = {}): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
  if (options.min !== undefined && value < options.min) return undefined;
  if (options.max !== undefined && value > options.max) return undefined;
  return value;
}

function stringArray(value: JsonValue | undefined, maxItems: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) return undefined;
  const items = value.map((item) => text(item, 80));
  return items.every((item): item is string => !!item) ? items : undefined;
}

function activePlayer(state: ChaseScoreState, playerId: string): ChaseScorePlayer | undefined {
  return state.players.find((player) => player.id === playerId && player.active);
}

function nextPlayerId(state: ChaseScoreState, fromId = state.currentPlayerId): string {
  const active = state.players.filter((player) => player.active);
  if (!active.length) return fromId;
  const index = active.findIndex((player) => player.id === fromId);
  return active[(index + 1 + active.length) % active.length].id;
}

function applyChanges(state: ChaseScoreState, changes: Record<string, number>, currentPlayerId: string): ChaseScoreState | undefined {
  const players = state.players.map((player) => {
    const score = player.score + (changes[player.id] ?? 0);
    return { ...player, score };
  });
  if (players.some((player) => !Number.isSafeInteger(player.score) || Math.abs(player.score) > MAX_SCORE_MAGNITUDE)) return undefined;
  return { ...state, players, currentPlayerId };
}

function scorePayload(input: {
  type: "score" | "transfer" | "correction";
  label: string;
  playerId: string;
  changes: Record<string, number>;
  previousCurrentPlayerId: string;
  currentPlayerId: string;
  occurredAt: number;
  note?: string;
  correctsSequenceNo?: number;
  correctionSource?: "undo" | "correction";
}): JsonObject {
  return {
    type: input.type,
    label: input.label,
    playerId: input.playerId,
    changes: input.changes,
    previousCurrentPlayerId: input.previousCurrentPlayerId,
    currentPlayerId: input.currentPlayerId,
    occurredAt: input.occurredAt,
    ...(input.note ? { note: input.note } : {}),
    ...(input.correctsSequenceNo ? { correctsSequenceNo: input.correctsSequenceNo } : {}),
    ...(input.correctionSource ? { correctionSource: input.correctionSource } : {}),
  };
}

function projectTransfer(
  state: ChaseScoreState,
  input: { winnerId: string; loserIds: string[]; amount: number; label: string; note?: string; now: number },
): ChaseCommandProjection | ChaseCommandError {
  const winner = activePlayer(state, input.winnerId);
  const uniqueLosers = [...new Set(input.loserIds)].filter((id) => id !== input.winnerId);
  const losers = uniqueLosers.map((id) => activePlayer(state, id));
  if (!winner || uniqueLosers.length !== input.loserIds.length || losers.some((player) => !player)) return "not_found";
  const changes: Record<string, number> = { [winner.id]: input.amount * uniqueLosers.length };
  for (const loserId of uniqueLosers) changes[loserId] = -input.amount;
  const currentPlayerId = state.turnStrategy === "winner_stays" ? winner.id : nextPlayerId(state);
  const next = applyChanges(state, changes, currentPlayerId);
  if (!next) return "invalid_command";
  return {
    kind: "score.recorded",
    state: next,
    payload: scorePayload({
      type: "transfer", label: input.label, playerId: winner.id, changes,
      previousCurrentPlayerId: state.currentPlayerId, currentPlayerId, occurredAt: input.now, note: input.note,
    }),
  };
}

function correctedSequences(events: ChaseScoringEvent[]): Set<number> {
  const result = new Set<number>();
  for (const event of events) {
    if (event.kind !== "score.corrected") continue;
    const sequenceNo = integer(event.payload.correctsSequenceNo, { min: 1 });
    if (sequenceNo) result.add(sequenceNo);
  }
  return result;
}

function correctEvent(
  state: ChaseScoreState,
  events: ChaseScoringEvent[],
  targetSequenceNo: number,
  note: string,
  source: "undo" | "correction",
  now: number,
): ChaseCommandProjection | ChaseCommandError {
  const target = events.find((event) => event.sequenceNo === targetSequenceNo && event.kind === "score.recorded");
  if (!target || correctedSequences(events).has(targetSequenceNo)) return "not_found";
  const rawChanges = target.payload.changes;
  if (!rawChanges || typeof rawChanges !== "object" || Array.isArray(rawChanges)) return "invalid_command";
  const changes: Record<string, number> = {};
  for (const [playerId, value] of Object.entries(rawChanges)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return "invalid_command";
    changes[playerId] = -value;
  }
  const playerId = text(target.payload.playerId, 80);
  const label = text(target.payload.label, 80);
  const previousCurrentPlayerId = text(target.payload.previousCurrentPlayerId, 80);
  if (!playerId || !label || !previousCurrentPlayerId) return "invalid_command";
  const currentPlayerId = source === "undo" ? previousCurrentPlayerId : state.currentPlayerId;
  const next = applyChanges(state, changes, currentPlayerId);
  if (!next) return "invalid_command";
  return {
    kind: "score.corrected",
    state: next,
    payload: scorePayload({
      type: "correction", label: `更正 · ${label}`, playerId, changes,
      previousCurrentPlayerId: state.currentPlayerId, currentPlayerId,
      occurredAt: now, note, correctsSequenceNo: targetSequenceNo, correctionSource: source,
    }),
  };
}

export function projectChaseCommand(
  state: ChaseScoreState,
  events: ChaseScoringEvent[],
  command: ChaseCommand,
): ChaseCommandProjection | ChaseCommandError {
  const { payload } = command;
  if (command.kind === "score.apply") {
    const playerId = text(payload.playerId, 80);
    const ruleId = text(payload.ruleId, 80);
    const note = optionalText(payload.note, 200);
    const player = playerId ? activePlayer(state, playerId) : undefined;
    const rule = state.rules.find((item) => item.id === ruleId && item.enabled);
    if (!player || !rule) return "not_found";
    if (note === undefined) return "invalid_command";
    const delta = rule.kind === "penalty" ? -Math.abs(rule.value) : Math.abs(rule.value);
    const currentPlayerId = state.turnStrategy === "winner_stays" && delta > 0 ? player.id : nextPlayerId(state);
    const changes = { [player.id]: delta };
    const next = applyChanges(state, changes, currentPlayerId);
    if (!next) return "invalid_command";
    return {
      kind: "score.recorded",
      state: next,
      payload: scorePayload({
        type: "score", label: rule.label, playerId: player.id, changes,
        previousCurrentPlayerId: state.currentPlayerId, currentPlayerId, occurredAt: command.now, note,
      }),
    };
  }

  if (command.kind === "score.transfer") {
    const winnerId = text(payload.winnerId, 80);
    const loserIds = stringArray(payload.loserIds, 7);
    const amount = integer(payload.amount, { min: 1, max: MAX_DELTA_MAGNITUDE });
    const label = optionalText(payload.label, 80);
    const note = optionalText(payload.note, 200);
    if (!winnerId || !loserIds || !amount || label === undefined || note === undefined) return "invalid_command";
    return projectTransfer(state, { winnerId, loserIds, amount, label: label || `转账 · 每人 ${amount} 分`, note, now: command.now });
  }

  if (command.kind === "score.black_gold") {
    const winnerId = text(payload.winnerId, 80);
    const baseAmount = integer(payload.baseAmount, { min: 1, max: MAX_DELTA_MAGNITUDE / 2 });
    const note = optionalText(payload.note, 200);
    if (!winnerId || !baseAmount || note === undefined) return "invalid_command";
    const amount = baseAmount * 2;
    const loserIds = state.players.filter((player) => player.active && player.id !== winnerId).map((player) => player.id);
    if (!loserIds.length) return "not_found";
    return projectTransfer(state, { winnerId, loserIds, amount, label: `黑金 · 每家 ${amount} 分`, note, now: command.now });
  }

  if (command.kind === "score.handicap") {
    const beneficiaryId = text(payload.beneficiaryId, 80);
    const grantorId = text(payload.grantorId, 80);
    const amount = integer(payload.amount, { min: 1, max: MAX_DELTA_MAGNITUDE });
    const note = optionalText(payload.note, 200);
    if (!beneficiaryId || !grantorId || !amount || note === undefined || beneficiaryId === grantorId) return "invalid_command";
    return projectTransfer(state, {
      winnerId: beneficiaryId, loserIds: [grantorId], amount, label: `让杆 · ${amount} 分`, note, now: command.now,
    });
  }

  if (command.kind === "score.backfill") {
    const playerId = text(payload.playerId, 80);
    const delta = integer(payload.delta, { min: -MAX_DELTA_MAGNITUDE, max: MAX_DELTA_MAGNITUDE });
    const label = text(payload.label, 70);
    const note = optionalText(payload.note, 200);
    const occurredAt = payload.occurredAt === undefined
      ? command.now
      : integer(payload.occurredAt, { min: 0, max: command.now + 300_000 });
    const player = playerId ? state.players.find((item) => item.id === playerId) : undefined;
    if (!player) return "not_found";
    if (!delta || !label || note === undefined || occurredAt === undefined) return "invalid_command";
    const changes = { [player.id]: delta };
    const next = applyChanges(state, changes, state.currentPlayerId);
    if (!next) return "invalid_command";
    return {
      kind: "score.recorded",
      state: next,
      payload: scorePayload({
        type: "score", label: `补录 · ${label}`, playerId: player.id, changes,
        previousCurrentPlayerId: state.currentPlayerId, currentPlayerId: state.currentPlayerId,
        occurredAt, note: note || "赛后补录",
      }),
    };
  }

  if (command.kind === "score.undo") {
    const corrected = correctedSequences(events);
    const target = [...events].reverse().find((event) => event.kind === "score.recorded" && !corrected.has(event.sequenceNo));
    if (!target) return "not_found";
    const note = optionalText(payload.note, 200);
    if (note === undefined) return "invalid_command";
    return correctEvent(state, events, target.sequenceNo, note || "撤销上一笔计分", "undo", command.now);
  }

  if (command.kind === "score.correct") {
    const targetSequenceNo = integer(payload.targetSequenceNo, { min: 1 });
    const note = optionalText(payload.note, 200);
    if (!targetSequenceNo || note === undefined) return "invalid_command";
    return correctEvent(state, events, targetSequenceNo, note || "手动更正", "correction", command.now);
  }

  if (command.kind === "turn.set") {
    const playerId = text(payload.playerId, 80);
    if (!playerId || !activePlayer(state, playerId)) return "not_found";
    return {
      kind: "turn.changed",
      state: { ...state, currentPlayerId: playerId },
      payload: { previousCurrentPlayerId: state.currentPlayerId, currentPlayerId: playerId },
    };
  }

  return "invalid_command";
}
