import { CardInstance, createDeck, secureRandomIndex } from "./deck";

export type MatchMode = "cards" | "score" | "score_cards";
export type CardMode = "none" | "shared" | "independent";
export type ScoreRuleKind = "gain" | "penalty";

export interface MatchPlayer {
  id: string;
  name: string;
  kind: "guest" | "registered-placeholder";
  initialScore: number;
  score: number;
  active: boolean;
}

export interface ScoreRule {
  id: string;
  label: string;
  value: number;
  kind: ScoreRuleKind;
  enabled: boolean;
  color: string;
}

export interface ScoreEvent {
  id: string;
  type: "score";
  label: string;
  playerId: string;
  changes: Record<string, number>;
  previousCurrentPlayerId: string;
  occurredAt: number;
}

export interface CardEvent {
  id: string;
  type: "draw" | "play" | "skip";
  label: string;
  handId: string;
  card?: CardInstance;
  occurredAt: number;
}

export interface MatchCardState {
  mode: Exclude<CardMode, "none">;
  remaining: CardInstance[];
  hands: Record<string, CardInstance[]>;
  used: CardInstance[];
  skipped: CardInstance[];
  events: CardEvent[];
  initialHandSize: number;
}

export interface BilliardsMatch {
  version: 1;
  id: string;
  mode: MatchMode;
  status: "active" | "completed";
  createdAt: number;
  startedAt: number;
  endedAt?: number;
  players: MatchPlayer[];
  currentPlayerId: string;
  rules: ScoreRule[];
  scoreEvents: ScoreEvent[];
  cards?: MatchCardState;
}

export interface MatchDraft {
  mode: MatchMode;
  playerNames: string[];
  initialScore: number;
  rules: ScoreRule[];
  cardMode: CardMode;
  initialHandSize: number;
}

export const DEFAULT_RULES: ScoreRule[] = [
  { id: "normal-win", label: "普胜", value: 10, kind: "gain", enabled: true, color: "mint" },
  { id: "small-gold", label: "小金", value: 20, kind: "gain", enabled: true, color: "cyan" },
  { id: "big-gold", label: "大金", value: 30, kind: "gain", enabled: true, color: "gold" },
  { id: "golden-nine", label: "黄金 9", value: 40, kind: "gain", enabled: false, color: "violet" },
  { id: "foul", label: "犯规", value: 5, kind: "penalty", enabled: true, color: "red" },
];

const makeId = (prefix: string, now = Date.now()) =>
  `${prefix}-${now}-${Math.random().toString(36).slice(2, 8)}`;

function takeRandom(source: CardInstance[], count: number, randomIndex = secureRandomIndex) {
  if (!Number.isInteger(count) || count < 0 || count > source.length) {
    throw new Error("抽卡数量超出剩余卡牌范围");
  }
  const remaining = [...source];
  const drawn: CardInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const selected = randomIndex(remaining.length);
    drawn.push(remaining[selected]);
    remaining[selected] = remaining[remaining.length - 1];
    remaining.pop();
  }
  return { remaining, drawn };
}

export function createMatch(draft: MatchDraft, now = Date.now(), randomIndex = secureRandomIndex): BilliardsMatch {
  const names = draft.playerNames.map((name) => name.trim()).filter(Boolean).slice(0, 8);
  if (names.length < 2) throw new Error("至少需要 2 名玩家");
  const players = names.map((name, index) => ({
    id: `player-${now}-${index + 1}`,
    name,
    kind: "guest" as const,
    initialScore: draft.initialScore,
    score: draft.initialScore,
    active: true,
  }));
  const mode = draft.mode;
  let cards: MatchCardState | undefined;
  if (draft.cardMode !== "none") {
    const handIds = draft.cardMode === "shared" ? ["shared"] : players.map((player) => player.id);
    let remaining = createDeck();
    const hands: Record<string, CardInstance[]> = {};
    const size = Math.max(0, Math.min(Math.trunc(draft.initialHandSize), Math.floor(51 / handIds.length)));
    for (const handId of handIds) {
      const dealt = takeRandom(remaining, size, randomIndex);
      remaining = dealt.remaining;
      hands[handId] = dealt.drawn;
    }
    cards = { mode: draft.cardMode, remaining, hands, used: [], skipped: [], events: [], initialHandSize: size };
  }
  return {
    version: 1,
    id: makeId("match", now),
    mode,
    status: "active",
    createdAt: now,
    startedAt: now,
    players,
    currentPlayerId: players[0].id,
    rules: draft.rules.map((rule) => ({ ...rule, value: Math.abs(Math.trunc(rule.value)) })),
    scoreEvents: [],
    ...(cards ? { cards } : {}),
  };
}

export function nextPlayerId(match: BilliardsMatch, fromId = match.currentPlayerId): string {
  const active = match.players.filter((player) => player.active);
  if (!active.length) return fromId;
  const index = active.findIndex((player) => player.id === fromId);
  return active[(index + 1 + active.length) % active.length].id;
}

export function applyScore(match: BilliardsMatch, ruleId: string, playerId: string, now = Date.now()): BilliardsMatch {
  const rule = match.rules.find((item) => item.id === ruleId && item.enabled);
  const player = match.players.find((item) => item.id === playerId && item.active);
  if (!rule || !player || match.status !== "active") return match;
  const delta = rule.kind === "penalty" ? -Math.abs(rule.value) : Math.abs(rule.value);
  const event: ScoreEvent = {
    id: makeId("score", now),
    type: "score",
    label: rule.label,
    playerId,
    changes: { [playerId]: delta },
    previousCurrentPlayerId: match.currentPlayerId,
    occurredAt: now,
  };
  return {
    ...match,
    players: match.players.map((item) => item.id === playerId ? { ...item, score: item.score + delta } : item),
    currentPlayerId: nextPlayerId(match),
    scoreEvents: [event, ...match.scoreEvents],
  };
}

export function undoLastScore(match: BilliardsMatch): BilliardsMatch {
  const [event, ...scoreEvents] = match.scoreEvents;
  if (!event || match.status !== "active") return match;
  return {
    ...match,
    players: match.players.map((player) => ({
      ...player,
      score: player.score - (event.changes[player.id] ?? 0),
    })),
    currentPlayerId: event.previousCurrentPlayerId,
    scoreEvents,
  };
}

export function reorderPlayers(match: BilliardsMatch, playerIds: string[]): BilliardsMatch {
  const positions = new Map(playerIds.map((id, index) => [id, index]));
  return { ...match, players: [...match.players].sort((a, b) => (positions.get(a.id) ?? 999) - (positions.get(b.id) ?? 999)) };
}

export function finishMatch(match: BilliardsMatch, now = Date.now()): BilliardsMatch {
  if (match.status === "completed") return match;
  return { ...match, status: "completed", endedAt: now };
}

export function drawMatchCards(match: BilliardsMatch, handId: string, count = 1, now = Date.now(), randomIndex = secureRandomIndex): BilliardsMatch {
  if (!match.cards || !match.cards.hands[handId] || match.status !== "active") return match;
  const dealt = takeRandom(match.cards.remaining, count, randomIndex);
  const events = dealt.drawn.map((card, index): CardEvent => ({
    id: makeId("card", now + index), type: "draw", label: `抽取「${card.title}」`, handId, card, occurredAt: now + index,
  }));
  return {
    ...match,
    cards: {
      ...match.cards,
      remaining: dealt.remaining,
      hands: { ...match.cards.hands, [handId]: [...dealt.drawn, ...match.cards.hands[handId]] },
      events: [...events, ...match.cards.events],
    },
  };
}

export function playMatchCard(match: BilliardsMatch, handId: string, instanceId: string, now = Date.now()): BilliardsMatch {
  const card = match.cards?.hands[handId]?.find((item) => item.instanceId === instanceId);
  if (!match.cards || !card || match.status !== "active") return match;
  return {
    ...match,
    cards: {
      ...match.cards,
      hands: { ...match.cards.hands, [handId]: match.cards.hands[handId].filter((item) => item.instanceId !== instanceId) },
      used: [card, ...match.cards.used],
      events: [{ id: makeId("card", now), type: "play", label: `使用「${card.title}」`, handId, card, occurredAt: now }, ...match.cards.events],
    },
  };
}

export function skipMatchCard(match: BilliardsMatch, handId: string, instanceId: string, now = Date.now(), randomIndex = secureRandomIndex): BilliardsMatch {
  const card = match.cards?.hands[handId]?.find((item) => item.instanceId === instanceId);
  if (!match.cards || !card || match.status !== "active") return match;
  const base: BilliardsMatch = {
    ...match,
    cards: {
      ...match.cards,
      hands: { ...match.cards.hands, [handId]: match.cards.hands[handId].filter((item) => item.instanceId !== instanceId) },
      skipped: [card, ...match.cards.skipped],
      events: [{ id: makeId("card", now), type: "skip", label: `安全跳过「${card.title}」`, handId, card, occurredAt: now }, ...match.cards.events],
    },
  };
  return base.cards?.remaining.length ? drawMatchCards(base, handId, 1, now + 1, randomIndex) : base;
}

export function getRankings(match: BilliardsMatch): MatchPlayer[] {
  return [...match.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
}

export function isStoredMatch(value: unknown): value is BilliardsMatch {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<BilliardsMatch>;
  return match.version === 1 && typeof match.id === "string" && Array.isArray(match.players) && Array.isArray(match.rules) && Array.isArray(match.scoreEvents);
}
