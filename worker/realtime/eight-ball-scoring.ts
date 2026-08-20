import type { JsonObject, JsonValue } from "./chase-scoring";

export type EightBallWinType = "normal" | "break_clear" | "runout";
export type EightBallServeRule = "alternate" | "winner";

export type RealtimeEightBallPlayer = {
  id: string;
  /** 显示名（displayName）：P1 绑定注册成员后为注册昵称快照。 */
  nickname: string;
  /** P1：绑定的注册成员 userId（未绑定为 undefined）。 */
  userId?: string;
};
export type RealtimeEightBallStats = { score: number; normal: number; breakClear: number; runout: number; fouls: number };
export type RealtimeEightBallRound = {
  roundId: string;
  winnerId: string;
  winType: EightBallWinType;
  fouls: Record<string, number>;
  note: string;
  startedAt: number;
  confirmedAt: number;
  serverId: string;
  voided: boolean;
};

export type RealtimeEightBallState = {
  mode: "chinese_eight";
  players: [RealtimeEightBallPlayer, RealtimeEightBallPlayer];
  raceTo: number | null;
  firstServerId: string;
  serveRule: EightBallServeRule;
  rounds: RealtimeEightBallRound[];
  stats: Record<string, RealtimeEightBallStats>;
  roundStartedAt: number;
};

export type EightBallCommandProjection = {
  kind: "eight_ball.round_recorded" | "eight_ball.round_corrected";
  payload: JsonObject;
  state: RealtimeEightBallState;
};

export type EightBallCommandError = "invalid_command" | "not_found";

type StablePlayer = { id: string; nickname: string };

const WIN_TYPES: EightBallWinType[] = ["normal", "break_clear", "runout"];

function text(value: JsonValue | unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function optionalText(value: JsonValue | unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return "";
  return text(value, maxLength);
}

function integer(value: JsonValue | unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function jsonRecord(value: JsonValue | unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseFouls(value: JsonValue | unknown, players: readonly RealtimeEightBallPlayer[]): Record<string, number> | undefined {
  const record = jsonRecord(value);
  if (!record) return undefined;
  const fouls: Record<string, number> = {};
  for (const player of players) {
    const count = record[player.id] ?? 0;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 99) return undefined;
    fouls[player.id] = count;
  }
  return fouls;
}

function emptyStats(players: readonly RealtimeEightBallPlayer[]): Record<string, RealtimeEightBallStats> {
  return Object.fromEntries(players.map((player) => [player.id, { score: 0, normal: 0, breakClear: 0, runout: 0, fouls: 0 }]));
}

export function recalculateEightBallState(state: RealtimeEightBallState): RealtimeEightBallState {
  const stats = emptyStats(state.players);
  const rounds = state.rounds.map((round) => ({ ...round, fouls: { ...round.fouls } }));
  let effectiveIndex = 0;
  let previousWinnerId: string | undefined;
  for (const round of rounds) {
    if (round.voided) continue;
    const firstServerIndex = state.players.findIndex((player) => player.id === state.firstServerId);
    round.serverId = state.serveRule === "winner" && previousWinnerId
      ? previousWinnerId
      : state.players[(firstServerIndex + effectiveIndex) % 2].id;
    const winner = stats[round.winnerId];
    winner.score += 1;
    if (round.winType === "normal") winner.normal += 1;
    if (round.winType === "break_clear") winner.breakClear += 1;
    if (round.winType === "runout") winner.runout += 1;
    for (const player of state.players) stats[player.id].fouls += round.fouls[player.id] ?? 0;
    previousWinnerId = round.winnerId;
    effectiveIndex += 1;
  }
  return { ...state, rounds, stats };
}

function parseRoundInput(
  state: RealtimeEightBallState,
  payload: JsonObject,
  now: number,
): Omit<RealtimeEightBallRound, "roundId" | "serverId" | "voided"> | EightBallCommandError {
  const winnerId = text(payload.winnerId, 80);
  const winType = typeof payload.winType === "string" && WIN_TYPES.includes(payload.winType as EightBallWinType)
    ? payload.winType as EightBallWinType
    : undefined;
  const fouls = parseFouls(payload.fouls, state.players);
  const note = optionalText(payload.note, 120);
  const startedAt = payload.startedAt === undefined
    ? state.roundStartedAt
    : integer(payload.startedAt, 0, now + 300_000);
  if (!winnerId || !state.players.some((player) => player.id === winnerId)) return "not_found";
  if (!winType || !fouls || note === undefined || startedAt === undefined || startedAt > now) return "invalid_command";
  return { winnerId, winType, fouls, note, startedAt, confirmedAt: now };
}

function recordedPayload(round: RealtimeEightBallRound): JsonObject {
  return {
    roundId: round.roundId,
    winnerId: round.winnerId,
    winType: round.winType,
    fouls: round.fouls,
    note: round.note,
    startedAt: round.startedAt,
    confirmedAt: round.confirmedAt,
    serverId: round.serverId,
  };
}

function correctionPayload(
  round: RealtimeEightBallRound,
  source: "undo" | "correction",
): JsonObject {
  return {
    correctsRoundId: round.roundId,
    correctionSource: source,
    ...(source === "correction" ? {
      replacementWinnerId: round.winnerId,
      replacementWinType: round.winType,
      replacementFouls: round.fouls,
      replacementNote: round.note,
      replacementStartedAt: round.startedAt,
      replacementConfirmedAt: round.confirmedAt,
      replacementServerId: round.serverId,
    } : {}),
  };
}

export function projectEightBallCommand(
  state: RealtimeEightBallState,
  command: { kind: string; payload: JsonObject; now: number; nextSequenceNo: number },
): EightBallCommandProjection | EightBallCommandError {
  if (command.kind === "eight_ball.round.record") {
    const input = parseRoundInput(state, command.payload, command.now);
    if (typeof input === "string") return input;
    const round: RealtimeEightBallRound = {
      ...input,
      roundId: `room-round-${command.nextSequenceNo}`,
      serverId: state.firstServerId,
      voided: false,
    };
    const next = recalculateEightBallState({ ...state, rounds: [...state.rounds, round], roundStartedAt: command.now });
    return { kind: "eight_ball.round_recorded", payload: recordedPayload(next.rounds.at(-1)!), state: next };
  }

  if (command.kind === "eight_ball.round.undo") {
    const targetIndex = state.rounds.findLastIndex((round) => !round.voided);
    if (targetIndex < 0) return "not_found";
    const rounds = state.rounds.map((round, index) => index === targetIndex ? { ...round, voided: true } : round);
    const next = recalculateEightBallState({ ...state, rounds });
    return {
      kind: "eight_ball.round_corrected",
      payload: correctionPayload(next.rounds[targetIndex], "undo"),
      state: next,
    };
  }

  if (command.kind === "eight_ball.round.correct") {
    const roundId = text(command.payload.roundId, 128);
    const targetIndex = state.rounds.findIndex((round) => round.roundId === roundId);
    if (!roundId || targetIndex < 0) return "not_found";
    const input = parseRoundInput(state, command.payload, command.now);
    if (typeof input === "string") return input;
    const rounds = state.rounds.map((round, index): RealtimeEightBallRound => index === targetIndex
      ? { ...round, ...input, voided: false }
      : round);
    const next = recalculateEightBallState({ ...state, rounds });
    return {
      kind: "eight_ball.round_corrected",
      payload: correctionPayload(next.rounds[targetIndex], "correction"),
      state: next,
    };
  }

  return "invalid_command";
}

function localRound(
  value: unknown,
  players: readonly RealtimeEightBallPlayer[],
  localToStable: Map<string, string>,
): Omit<RealtimeEightBallRound, "roundId" | "serverId" | "voided"> | undefined {
  const round = jsonRecord(value);
  if (!round || typeof round.winnerId !== "string") return undefined;
  const winnerId = localToStable.get(round.winnerId);
  const winType = typeof round.winType === "string" && WIN_TYPES.includes(round.winType as EightBallWinType)
    ? round.winType as EightBallWinType
    : undefined;
  const localFouls = jsonRecord(round.fouls);
  const fouls: Record<string, number> = {};
  for (const [localId, count] of Object.entries(localFouls ?? {})) {
    const stableId = localToStable.get(localId);
    if (stableId && typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 99) fouls[stableId] = count;
  }
  for (const player of players) fouls[player.id] ??= 0;
  const note = typeof round.note === "string" ? round.note.trim().slice(0, 120) : "";
  const startedAt = integer(round.startedAt, 0, Number.MAX_SAFE_INTEGER);
  const confirmedAt = integer(round.confirmedAt, 0, Number.MAX_SAFE_INTEGER);
  if (!winnerId || !winType || startedAt === undefined || confirmedAt === undefined) return undefined;
  return { winnerId, winType, fouls, note, startedAt, confirmedAt };
}

export function hydrateEightBallState(snapshot: Record<string, unknown>, stablePlayers: [StablePlayer, StablePlayer]): RealtimeEightBallState | undefined {
  const localPlayers = Array.isArray(snapshot.players) ? snapshot.players : [];
  if (localPlayers.length !== 2) return undefined;
  const localToStable = new Map<string, string>();
  const players = stablePlayers.map((stable, index) => {
    const local = jsonRecord(localPlayers[index]);
    if (typeof local?.id === "string") localToStable.set(local.id, stable.id);
    return {
      id: stable.id,
      nickname: typeof local?.name === "string" && local.name.trim() ? local.name.trim().slice(0, 80) : stable.nickname,
    };
  }) as [RealtimeEightBallPlayer, RealtimeEightBallPlayer];
  const localFirstServerId = typeof snapshot.firstServerId === "string" ? snapshot.firstServerId : undefined;
  const firstServerId = localFirstServerId ? localToStable.get(localFirstServerId) : players[0].id;
  if (!firstServerId) return undefined;
  const raceTo = snapshot.raceTo === null ? null : integer(snapshot.raceTo, 1, 99) ?? null;
  const serveRule: EightBallServeRule = snapshot.serveRule === "winner" ? "winner" : "alternate";
  const events = Array.isArray(snapshot.events) ? snapshot.events.map(jsonRecord).filter((event): event is Record<string, unknown> => !!event) : [];
  const corrections = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (event.type === "correction" && typeof event.correctsEventId === "string") corrections.set(event.correctsEventId, event);
  }
  const rounds: RealtimeEightBallRound[] = [];
  for (const event of events) {
    if (event.type !== "round" || typeof event.id !== "string") continue;
    const correction = corrections.get(event.id);
    const replacement = correction?.replacement;
    const parsed = localRound(replacement ?? event.round, players, localToStable);
    const original = localRound(event.round, players, localToStable);
    if (!original) continue;
    rounds.push({
      ...(parsed ?? original),
      roundId: `baseline:${event.id}`.slice(0, 128),
      serverId: firstServerId,
      voided: !!correction && !replacement,
    });
  }
  const startedAt = integer(snapshot.startedAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now();
  const state: RealtimeEightBallState = {
    mode: "chinese_eight",
    players,
    raceTo,
    firstServerId,
    serveRule,
    rounds,
    stats: emptyStats(players),
    roundStartedAt: [...rounds].reverse().find((round) => !round.voided)?.confirmedAt ?? startedAt,
  };
  return recalculateEightBallState(state);
}
