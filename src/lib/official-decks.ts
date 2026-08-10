import { CARD_DEFINITIONS } from "../data/cards";

export type OfficialDeckId = "complete" | "light" | "competitive" | "safe";

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
const competitiveIds = [
  1, 3, 5, 8, 9, 10, 13, 14, 15, 18, 19, 21, 23, 26, 31, 32, 36, 37, 39, 40, 42, 44, 47, 48, 50,
].map((number) => `card-${String(number).padStart(3, "0")}`);

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
    id: "competitive",
    version: 1,
    name: "竞技牌组",
    description: "保留局势、球权与攻防决策类规则，排除表演和社交惩罚。",
    difficulty: "标准",
    safety: "不含身体动作挑战，适合更重视胜负与策略的对局。",
    definitionIds: competitiveIds,
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
