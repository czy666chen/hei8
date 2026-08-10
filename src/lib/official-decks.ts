import { CARD_DEFINITIONS } from "../data/cards";

export type OfficialDeckId = "complete" | "light" | "safe";

export interface OfficialDeck {
  id: OfficialDeckId;
  version: 1;
  name: string;
  description: string;
  difficulty: "轻松" | "标准";
  safety: string;
  definitionIds: string[];
}

const allIds = CARD_DEFINITIONS.map((card) => card.id);
const lightIds = CARD_DEFINITIONS
  .filter((card) => Number(card.id.slice(-3)) % 2 === 0 && !card.needsReview)
  .map((card) => card.id);
const safeIds = CARD_DEFINITIONS
  .filter((card) => !card.needsReview && !card.safetyNote)
  .map((card) => card.id);

export const OFFICIAL_DECKS: OfficialDeck[] = [
  {
    id: "complete",
    version: 1,
    name: "完整奇招",
    description: "收录全部规则，适合熟悉玩法的朋友局。",
    difficulty: "标准",
    safety: "危险动作可随时安全跳过并补抽。",
    definitionIds: allIds,
  },
  {
    id: "light",
    version: 1,
    name: "轻量牌组",
    description: "精简规则数量，适合短局和第一次体验。",
    difficulty: "轻松",
    safety: "已排除待复核内容，仍请遵守卡面安全提示。",
    definitionIds: lightIds,
  },
  {
    id: "safe",
    version: 1,
    name: "安全牌组",
    description: "排除待复核规则及带身体动作风险提示的卡牌。",
    difficulty: "轻松",
    safety: "优先使用低风险规则；现场安全始终高于卡牌效果。",
    definitionIds: safeIds,
  },
];

export function getOfficialDeck(id: OfficialDeckId | undefined): OfficialDeck {
  return OFFICIAL_DECKS.find((deck) => deck.id === id) ?? OFFICIAL_DECKS[0];
}

export function officialDeckCardCount(deck: OfficialDeck): number {
  return CARD_DEFINITIONS
    .filter((card) => deck.definitionIds.includes(card.id))
    .reduce((sum, card) => sum + card.count, 0);
}
