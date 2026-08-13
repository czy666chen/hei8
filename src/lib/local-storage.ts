import { GameState, loadGameState } from "./deck";
import { EightBallMatch, isEightBallMatch } from "./eight-ball";
import { getOfficialDeck } from "./official-decks";
import { BilliardsMatch, DEFAULT_RULES, isStoredMatch, ScoreRule } from "./match";

export const APP_STORAGE_KEY = "billiards-club-assistant:v1";
export const CARD_STORAGE_KEY = "billiards-trick-cards:v2";
export const LEGACY_CARD_STORAGE_KEY = "neon-pool-cards:v1";
export const EIGHT_BALL_LAYOUT_KEY = "billiards-eight-layout:v1";
export const MIGRATION_LINKS_KEY = "billiards-cloud-links:v1";
export const SYNC_DEVICE_KEY = "billiards-sync-device:v1";
export const SYNC_QUEUE_KEY = "billiards-sync-queue:v1";

export type ScorePreset = { id: string; name: string; rules: ScoreRule[] };

export type AppData = {
  version: 1;
  activeMatch: BilliardsMatch | null;
  history: BilliardsMatch[];
  savedRules: ScoreRule[];
  scorePresets: ScorePreset[];
  pausedMatches: BilliardsMatch[];
  recoverySnapshots: { match: BilliardsMatch; abandonedAt: number; reason: string }[];
  activeEightBallMatch: EightBallMatch | null;
  eightBallHistory: EightBallMatch[];
};

export type StorageIssue = { message: string; raw: string };

export const EMPTY_APP_DATA: AppData = {
  version: 1,
  activeMatch: null,
  history: [],
  savedRules: DEFAULT_RULES,
  scorePresets: [],
  pausedMatches: [],
  recoverySnapshots: [],
  activeEightBallMatch: null,
  eightBallHistory: [],
};

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export class BrowserStorageAdapter implements StorageAdapter {
  constructor(private readonly storage: Storage) {}

  get(key: string) { return this.storage.getItem(key); }
  set(key: string, value: string) { this.storage.setItem(key, value); }
  remove(key: string) { this.storage.removeItem(key); }
  keys() { return Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index)).filter((key): key is string => key !== null); }
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }

  get(key: string) { return this.values.get(key) ?? null; }
  set(key: string, value: string) { this.values.set(key, value); }
  remove(key: string) { this.values.delete(key); }
  keys() { return [...this.values.keys()]; }
}

export type VersionedCodec<T> = {
  key: string;
  version: number;
  empty: T;
  decode(raw: string): T;
};

export type StorageRead<T> = { value: T; issue?: StorageIssue };

export class VersionedLocalStore {
  constructor(readonly adapter: StorageAdapter) {}

  read<T>(codec: VersionedCodec<T>): StorageRead<T> {
    const raw = this.adapter.get(codec.key);
    if (raw === null) return { value: codec.empty };
    try {
      return { value: codec.decode(raw) };
    } catch {
      return { value: codec.empty, issue: { message: "数据格式或版本无法识别", raw } };
    }
  }

  write<T>(codec: VersionedCodec<T>, value: T): void {
    this.adapter.set(codec.key, JSON.stringify(value));
  }

  getRaw(key: string): string | null { return this.adapter.get(key); }
  setRaw(key: string, value: string): void { this.adapter.set(key, value); }
  remove(key: string): void { this.adapter.remove(key); }
}

function parseAppData(raw: string): AppData {
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object") {
    const data = parsed as Partial<AppData>;
    if (data.version === 1 && Array.isArray(data.history)) {
      return {
        version: 1,
        activeMatch: isStoredMatch(data.activeMatch) ? data.activeMatch : null,
        history: data.history.filter(isStoredMatch),
        savedRules: Array.isArray(data.savedRules) ? data.savedRules : DEFAULT_RULES,
        scorePresets: Array.isArray(data.scorePresets)
          ? data.scorePresets.filter((preset) => preset && typeof preset.id === "string" && typeof preset.name === "string" && Array.isArray(preset.rules))
          : [],
        pausedMatches: Array.isArray(data.pausedMatches) ? data.pausedMatches.filter(isStoredMatch) : [],
        recoverySnapshots: Array.isArray(data.recoverySnapshots)
          ? data.recoverySnapshots.filter((item) => item && isStoredMatch(item.match))
          : [],
        activeEightBallMatch: isEightBallMatch(data.activeEightBallMatch) ? data.activeEightBallMatch : null,
        eightBallHistory: Array.isArray(data.eightBallHistory) ? data.eightBallHistory.filter(isEightBallMatch) : [],
      };
    }
  }
  throw new Error("invalid app data");
}

export const APP_DATA_CODEC: VersionedCodec<AppData> = {
  key: APP_STORAGE_KEY,
  version: 1,
  empty: EMPTY_APP_DATA,
  decode: parseAppData,
};

export type CloudLink = {
  kind: "preset" | "deck" | "match";
  localId: string;
  resourceId: string;
  version: number;
  lastSyncedAt: number;
  operationId: string;
};

export type CloudLinks = { version: 1; links: Record<string, CloudLink> };

export const CLOUD_LINKS_CODEC: VersionedCodec<CloudLinks> = {
  key: MIGRATION_LINKS_KEY,
  version: 1,
  empty: { version: 1, links: {} },
  decode(raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cloud links");
    const value = parsed as Partial<CloudLinks>;
    if (value.version !== 1 || !value.links || typeof value.links !== "object") throw new Error("invalid cloud links");
    return { version: 1, links: value.links };
  },
};

function migrateLegacyCardMatch(state: GameState): BilliardsMatch {
  const now = Date.now();
  const players = [
    { id: "legacy-player-a", name: "玩家 A", kind: "guest" as const, initialScore: 0, score: 0, active: true },
    { id: "legacy-player-b", name: "玩家 B", kind: "guest" as const, initialScore: 0, score: 0, active: true },
  ];
  const shared = state.settings.handMode === "shared";
  return {
    version: 1,
    id: `migrated-${now}`,
    mode: "cards",
    status: "active",
    createdAt: now,
    startedAt: now,
    players,
    currentPlayerId: players[0].id,
    rules: DEFAULT_RULES,
    scoreEvents: [],
    cards: {
      mode: shared ? "shared" : "independent",
      remaining: state.remaining,
      hands: shared ? { shared: state.hands.shared } : { [players[0].id]: state.hands.playerA, [players[1].id]: state.hands.playerB },
      used: state.used.map((record) => record.card),
      skipped: state.discarded.map((record) => record.card),
      events: [],
      initialHandSize: shared ? state.settings.sharedHandSize : state.settings.playerAHandSize,
      deckSnapshot: {
        id: "complete",
        version: 1,
        name: "完整奇招",
        definitionIds: [...getOfficialDeck("complete").definitionIds],
        cardCount: 51,
      },
    },
  };
}

export function loadAppData(store: VersionedLocalStore): StorageRead<AppData> {
  const currentRaw = store.getRaw(APP_STORAGE_KEY);
  if (currentRaw !== null) return store.read(APP_DATA_CODEC);
  const legacy = loadGameState(store.getRaw(CARD_STORAGE_KEY)) ?? loadGameState(store.getRaw(LEGACY_CARD_STORAGE_KEY));
  const hasLegacyGame = legacy && (
    legacy.used.length > 0 || legacy.discarded.length > 0 || Object.values(legacy.hands).some((hand) => hand.length > 0)
  );
  return { value: hasLegacyGame ? { ...EMPTY_APP_DATA, activeMatch: migrateLegacyCardMatch(legacy) } : EMPTY_APP_DATA };
}
