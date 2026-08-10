import { CARD_DEFINITIONS } from "../data/cards";

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  displayNumber: string;
  title: string;
  effect: string;
  safetyNote?: string;
}

export type HandMode = "shared" | "dual";
export type HandId = "shared" | "playerA" | "playerB";

export interface GameSettings {
  handMode: HandMode;
  sharedHandSize: number;
  playerAHandSize: number;
  playerBHandSize: number;
  excludedDefinitionIds: string[];
}

export interface CardRecord {
  card: CardInstance;
  owner: HandId;
  recordedAt: number;
}

export interface GameState {
  version: 3;
  remaining: CardInstance[];
  excluded: CardInstance[];
  hands: Record<HandId, CardInstance[]>;
  used: CardRecord[];
  discarded: CardRecord[];
  activeHand: HandId;
  settings: GameSettings;
}

export const DEFAULT_SETTINGS: GameSettings = {
  handMode: "shared",
  sharedHandSize: 3,
  playerAHandSize: 3,
  playerBHandSize: 3,
  excludedDefinitionIds: [],
};

export const createDeck = (): CardInstance[] =>
  CARD_DEFINITIONS.flatMap((item) =>
    Array.from({ length: item.count }, (_, index) => ({
      instanceId: `${item.id}-${index + 1}`,
      definitionId: item.id,
      displayNumber: `${item.id.slice(-3)}${item.count > 1 ? `-${String.fromCharCode(65 + index)}` : ""}`,
      title: item.title,
      effect: item.effect,
      ...(item.safetyNote ? { safetyNote: item.safetyNote } : {}),
    })),
  );

const emptyHands = (): Record<HandId, CardInstance[]> => ({
  shared: [],
  playerA: [],
  playerB: [],
});

export function secureRandomIndex(max: number): number {
  if (!Number.isInteger(max) || max <= 0) throw new Error("随机范围必须为正整数");
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.getRandomValues) return Math.floor(Math.random() * max);
  const limit = Math.floor(0x100000000 / max) * max;
  const values = new Uint32Array(1);
  do cryptoObject.getRandomValues(values); while (values[0] >= limit);
  return values[0] % max;
}

function takeRandomCards(
  source: CardInstance[],
  count: number,
  randomIndex = secureRandomIndex,
): { remaining: CardInstance[]; drawn: CardInstance[] } {
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

export function normalizeSettings(input: GameSettings): GameSettings {
  const handMode: HandMode = input.handMode === "dual" ? "dual" : "shared";
  const validDefinitions = new Set(CARD_DEFINITIONS.map((item) => item.id));
  const excludedDefinitionIds = Array.from(new Set(
    Array.isArray(input.excludedDefinitionIds)
      ? input.excludedDefinitionIds.filter((id) => typeof id === "string" && validDefinitions.has(id))
      : [],
  ));
  const availableCount = CARD_DEFINITIONS
    .filter((item) => !excludedDefinitionIds.includes(item.id))
    .reduce((sum, item) => sum + item.count, 0);
  const clamp = (value: number) =>
    Math.max(0, Math.min(availableCount, Math.trunc(Number.isFinite(value) ? value : 0)));
  const sharedHandSize = clamp(input.sharedHandSize);
  const playerAHandSize = clamp(input.playerAHandSize);
  let playerBHandSize = clamp(input.playerBHandSize);
  if (playerAHandSize + playerBHandSize > availableCount) {
    playerBHandSize = Math.max(0, availableCount - playerAHandSize);
  }
  return { handMode, sharedHandSize, playerAHandSize, playerBHandSize, excludedDefinitionIds };
}

export function resetGame(
  settings: GameSettings = DEFAULT_SETTINGS,
  randomIndex = secureRandomIndex,
): GameState {
  const normalized = normalizeSettings(settings);
  const hands = emptyHands();
  const deck = createDeck();
  const excluded = deck.filter((card) => normalized.excludedDefinitionIds.includes(card.definitionId));
  let remaining = deck.filter((card) => !normalized.excludedDefinitionIds.includes(card.definitionId));

  if (normalized.handMode === "shared") {
    const dealt = takeRandomCards(remaining, normalized.sharedHandSize, randomIndex);
    remaining = dealt.remaining;
    hands.shared = dealt.drawn;
  } else {
    const dealtA = takeRandomCards(remaining, normalized.playerAHandSize, randomIndex);
    remaining = dealtA.remaining;
    hands.playerA = dealtA.drawn;
    const dealtB = takeRandomCards(remaining, normalized.playerBHandSize, randomIndex);
    remaining = dealtB.remaining;
    hands.playerB = dealtB.drawn;
  }

  return {
    version: 3,
    remaining,
    excluded,
    hands,
    used: [],
    discarded: [],
    activeHand: normalized.handMode === "shared" ? "shared" : "playerA",
    settings: normalized,
  };
}

function isAvailableHand(state: GameState, handId: HandId): boolean {
  return state.settings.handMode === "shared" ? handId === "shared" : handId !== "shared";
}

export function drawCards(
  state: GameState,
  handId: HandId,
  count: number,
  randomIndex = secureRandomIndex,
): GameState {
  if (!Number.isInteger(count) || count < 1 || count > state.remaining.length) {
    throw new Error("抽卡数量超出剩余卡牌范围");
  }
  if (!isAvailableHand(state, handId)) return state;
  const dealt = takeRandomCards(state.remaining, count, randomIndex);
  return {
    ...state,
    remaining: dealt.remaining,
    hands: { ...state.hands, [handId]: [...dealt.drawn, ...state.hands[handId]] },
    activeHand: handId,
  };
}

export function playCard(
  state: GameState,
  handId: HandId,
  instanceId: string,
  now = Date.now(),
): GameState {
  const target = state.hands[handId].find((item) => item.instanceId === instanceId);
  if (!target) return state;
  return {
    ...state,
    hands: {
      ...state.hands,
      [handId]: state.hands[handId].filter((item) => item.instanceId !== instanceId),
    },
    used: [{ card: target, owner: handId, recordedAt: now }, ...state.used],
  };
}

export function skipCard(
  state: GameState,
  handId: HandId,
  instanceId: string,
  randomIndex = secureRandomIndex,
  now = Date.now(),
): GameState {
  const target = state.hands[handId].find((item) => item.instanceId === instanceId);
  if (!target) return state;
  const base: GameState = {
    ...state,
    hands: {
      ...state.hands,
      [handId]: state.hands[handId].filter((item) => item.instanceId !== instanceId),
    },
    discarded: [{ card: target, owner: handId, recordedAt: now }, ...state.discarded],
  };
  if (base.remaining.length === 0) return base;
  return drawCards(base, handId, 1, randomIndex);
}

export function setExcludedDefinitions(state: GameState, definitionIds: string[]): GameState {
  const validDefinitions = new Set(CARD_DEFINITIONS.map((item) => item.id));
  const selected = Array.from(new Set(
    definitionIds.filter((id) => validDefinitions.has(id)),
  ));
  const availablePool = [...state.remaining, ...state.excluded];
  const excluded = availablePool.filter((card) => selected.includes(card.definitionId));
  const remaining = availablePool.filter((card) => !selected.includes(card.definitionId));
  return {
    ...state,
    remaining,
    excluded,
    settings: { ...state.settings, excludedDefinitionIds: selected },
  };
}

export function handLabel(handId: HandId): string {
  if (handId === "playerA") return "玩家 A";
  if (handId === "playerB") return "玩家 B";
  return "共用手牌";
}

export function loadGameState(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (isGameStateV3(value)) return hydrateState(value);
    if (isGameStateV2(value)) return migrateV2State(value);
    if (isLegacyState(value)) return migrateLegacyState(value);
  } catch {
    return null;
  }
  return null;
}

function isCard(value: unknown): value is CardInstance {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<CardInstance>;
  return (
    typeof card.instanceId === "string" &&
    typeof card.definitionId === "string" &&
    typeof card.title === "string" &&
    typeof card.effect === "string"
  );
}

function isCardRecord(value: unknown): value is CardRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CardRecord>;
  return (
    isCard(record.card) &&
    ["shared", "playerA", "playerB"].includes(String(record.owner)) &&
    typeof record.recordedAt === "number"
  );
}

function isGameStateV3(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<GameState>;
  if (
    state.version !== 3 ||
    !Array.isArray(state.remaining) ||
    !Array.isArray(state.excluded) ||
    !state.hands ||
    !Array.isArray(state.used) ||
    !Array.isArray(state.discarded) ||
    !state.settings
  ) return false;
  const hands = state.hands as Partial<Record<HandId, unknown>>;
  return (
    state.remaining.every(isCard) &&
    state.excluded.every(isCard) &&
    Array.isArray(hands.shared) && hands.shared.every(isCard) &&
    Array.isArray(hands.playerA) && hands.playerA.every(isCard) &&
    Array.isArray(hands.playerB) && hands.playerB.every(isCard) &&
    state.used.every(isCardRecord) &&
    state.discarded.every(isCardRecord) &&
    ["shared", "playerA", "playerB"].includes(String(state.activeHand)) &&
    ["shared", "dual"].includes(String(state.settings.handMode))
  );
}

type GameStateV2 = Omit<GameState, "version" | "excluded"> & {
  version: 2;
  settings: Omit<GameSettings, "excludedDefinitionIds">;
};

function isGameStateV2(value: unknown): value is GameStateV2 {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<GameStateV2>;
  if (
    state.version !== 2 ||
    !Array.isArray(state.remaining) ||
    !state.hands ||
    !Array.isArray(state.used) ||
    !Array.isArray(state.discarded) ||
    !state.settings
  ) return false;
  const hands = state.hands as Partial<Record<HandId, unknown>>;
  return (
    state.remaining.every(isCard) &&
    Array.isArray(hands.shared) && hands.shared.every(isCard) &&
    Array.isArray(hands.playerA) && hands.playerA.every(isCard) &&
    Array.isArray(hands.playerB) && hands.playerB.every(isCard) &&
    state.used.every(isCardRecord) &&
    state.discarded.every(isCardRecord) &&
    ["shared", "playerA", "playerB"].includes(String(state.activeHand)) &&
    ["shared", "dual"].includes(String(state.settings.handMode))
  );
}

interface LegacyState {
  remaining: CardInstance[];
  hand: CardInstance[];
  used: CardInstance[];
}

function isLegacyState(value: unknown): value is LegacyState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<LegacyState>;
  return (
    Array.isArray(state.remaining) && state.remaining.every(isCard) &&
    Array.isArray(state.hand) && state.hand.every(isCard) &&
    Array.isArray(state.used) && state.used.every(isCard)
  );
}

function hydrateCard(card: CardInstance): CardInstance {
  const definition = CARD_DEFINITIONS.find((item) => item.id === card.definitionId);
  const copyIndex = Math.max(0, Number(card.instanceId.split("-").at(-1) ?? "1") - 1);
  return {
    ...card,
    displayNumber: card.displayNumber ??
      `${card.definitionId.slice(-3)}${(definition?.count ?? 1) > 1 ? `-${String.fromCharCode(65 + copyIndex)}` : ""}`,
    ...(definition?.safetyNote ? { safetyNote: definition.safetyNote } : {}),
  };
}

function hydrateState(state: GameState): GameState {
  return {
    ...state,
    remaining: state.remaining.map(hydrateCard),
    excluded: state.excluded.map(hydrateCard),
    hands: {
      shared: state.hands.shared.map(hydrateCard),
      playerA: state.hands.playerA.map(hydrateCard),
      playerB: state.hands.playerB.map(hydrateCard),
    },
    used: state.used.map((record) => ({ ...record, card: hydrateCard(record.card) })),
    discarded: state.discarded.map((record) => ({ ...record, card: hydrateCard(record.card) })),
    settings: normalizeSettings(state.settings),
  };
}

function migrateV2State(state: GameStateV2): GameState {
  return hydrateState({
    ...state,
    version: 3,
    excluded: [],
    settings: { ...state.settings, excludedDefinitionIds: [] },
  });
}

function migrateLegacyState(legacy: LegacyState): GameState {
  const settings = { ...DEFAULT_SETTINGS, sharedHandSize: legacy.hand.length };
  return {
    version: 3,
    remaining: legacy.remaining.map(hydrateCard),
    excluded: [],
    hands: { shared: legacy.hand.map(hydrateCard), playerA: [], playerB: [] },
    used: legacy.used.map((card, index) => ({
      card: hydrateCard(card),
      owner: "shared",
      recordedAt: Date.now() - index,
    })),
    discarded: [],
    activeHand: "shared",
    settings: { ...settings, excludedDefinitionIds: [] },
  };
}
