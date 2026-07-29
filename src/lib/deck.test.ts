import { describe, expect, it } from "vitest";
import { createDeck, drawCards, resetGame, useCard } from "./deck";

const first = () => 0;

describe("卡牌核心逻辑", () => {
  it("总卡牌实例数量为 51", () => expect(createDeck()).toHaveLength(51));
  it("无懈可击有两个不同 instanceId", () => {
    const cards = createDeck().filter((item) => item.title === "无懈可击");
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((item) => item.instanceId)).size).toBe(2);
  });
  it("一次抽取 N 张不会重复", () => {
    const result = drawCards(resetGame(), 10, first);
    expect(new Set(result.hand.map((item) => item.instanceId)).size).toBe(10);
  });
  it("连续抽取不会抽到已经抽出的卡", () => {
    const once = drawCards(resetGame(), 12, first);
    const twice = drawCards(once, 12, first);
    expect(new Set(twice.hand.map((item) => item.instanceId)).size).toBe(24);
  });
  it("已使用卡不能再次使用", () => {
    const drawn = drawCards(resetGame(), 1, first);
    const used = useCard(drawn, drawn.hand[0].instanceId);
    expect(useCard(used, used.used[0].instanceId)).toBe(used);
  });
  it("重置后恢复全部卡牌", () => {
    const drawn = drawCards(resetGame(), 3, first);
    const played = useCard(drawn, drawn.hand[0].instanceId);
    expect(resetGame()).toEqual({ remaining: createDeck(), hand: [], used: [] });
    expect(played.remaining).toHaveLength(48);
  });
  it("不能抽取超过剩余数量的卡", () => expect(() => drawCards(resetGame(), 52, first)).toThrow());
});
