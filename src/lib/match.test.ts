import { describe, expect, it } from "vitest";
import {
  applyScore,
  createMatch,
  DEFAULT_RULES,
  drawMatchCards,
  finishMatch,
  getRankings,
  playMatchCard,
  skipMatchCard,
  undoLastScore,
} from "./match";

const first = () => 0;
const draft = {
  mode: "score" as const,
  playerNames: ["阿杰", "老王", "小李"],
  initialScore: 100,
  rules: DEFAULT_RULES,
  cardMode: "none" as const,
  initialHandSize: 0,
};

describe("追分对局", () => {
  it("支持 2–8 人并保留同名玩家的独立 ID", () => {
    const match = createMatch({ ...draft, playerNames: ["阿杰", "阿杰"] }, 100, first);
    expect(match.players).toHaveLength(2);
    expect(new Set(match.players.map((player) => player.id)).size).toBe(2);
  });

  it("按自定义分值记分并自动轮转", () => {
    const match = createMatch(draft, 100, first);
    const scored = applyScore(match, "normal-win", match.players[0].id, 200);
    expect(scored.players[0].score).toBe(110);
    expect(scored.currentPlayerId).toBe(match.players[1].id);
    expect(scored.scoreEvents[0].changes[match.players[0].id]).toBe(10);
  });

  it("犯规扣分且撤销同时恢复积分与当前玩家", () => {
    const match = createMatch(draft, 100, first);
    const fouled = applyScore(match, "foul", match.players[0].id, 200);
    expect(fouled.players[0].score).toBe(95);
    const undone = undoLastScore(fouled);
    expect(undone.players[0].score).toBe(100);
    expect(undone.currentPlayerId).toBe(match.players[0].id);
    expect(undone.scoreEvents).toHaveLength(0);
  });

  it("结算后保存确定排名", () => {
    const match = createMatch(draft, 100, first);
    const scored = applyScore(match, "big-gold", match.players[1].id, 200);
    const completed = finishMatch(scored, 300);
    expect(completed.status).toBe("completed");
    expect(completed.endedAt).toBe(300);
    expect(getRankings(completed)[0].name).toBe("老王");
  });
});

describe("追分与奇招牌组合", () => {
  it("独立手牌不放回且每名玩家都有起始手牌", () => {
    const match = createMatch({ ...draft, mode: "score_cards", cardMode: "independent", initialHandSize: 2 }, 100, first);
    const cards = Object.values(match.cards!.hands).flat();
    expect(cards).toHaveLength(6);
    expect(new Set(cards.map((card) => card.instanceId)).size).toBe(6);
    expect(match.cards!.remaining).toHaveLength(45);
  });

  it("共用手牌可抽取、使用并生成卡牌流水", () => {
    const match = createMatch({ ...draft, mode: "score_cards", cardMode: "shared", initialHandSize: 1 }, 100, first);
    const drawn = drawMatchCards(match, "shared", 1, 200, first);
    const target = drawn.cards!.hands.shared[0];
    const played = playMatchCard(drawn, "shared", target.instanceId, 300);
    expect(played.cards!.used[0].instanceId).toBe(target.instanceId);
    expect(played.cards!.events.some((event) => event.type === "play")).toBe(true);
  });

  it("危险卡可安全跳过并补抽", () => {
    const match = createMatch({ ...draft, mode: "score_cards", cardMode: "shared", initialHandSize: 0 }, 100, first);
    const risk = match.cards!.remaining.find((card) => card.safetyNote)!;
    const custom = {
      ...match,
      cards: {
        ...match.cards!,
        remaining: match.cards!.remaining.filter((card) => card.instanceId !== risk.instanceId),
        hands: { shared: [risk] },
      },
    };
    const skipped = skipMatchCard(custom, "shared", risk.instanceId, 200, first);
    expect(skipped.cards!.skipped[0].instanceId).toBe(risk.instanceId);
    expect(skipped.cards!.hands.shared).toHaveLength(1);
  });
});
