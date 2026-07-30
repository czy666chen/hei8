import { describe, expect, it } from "vitest";
import {
  createDeck,
  DEFAULT_SETTINGS,
  drawCards,
  loadGameState,
  playCard,
  resetGame,
  skipUnsafeCard,
} from "./deck";

const first = () => 0;

describe("卡牌核心逻辑", () => {
  it("总卡牌实例数量为 51", () => expect(createDeck()).toHaveLength(51));

  it("无懈可击有两个不同实例和显示编号", () => {
    const cards = createDeck().filter((item) => item.title === "无懈可击");
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((item) => item.instanceId)).size).toBe(2);
    expect(cards.map((item) => item.displayNumber)).toEqual(["026-A", "026-B"]);
  });

  it("一套手牌按设置发牌", () => {
    const state = resetGame({ ...DEFAULT_SETTINGS, handMode: "shared", sharedHandSize: 5 }, first);
    expect(state.hands.shared).toHaveLength(5);
    expect(state.remaining).toHaveLength(46);
    expect(state.activeHand).toBe("shared");
  });

  it("双手牌可分别设置不同数量", () => {
    const state = resetGame({
      ...DEFAULT_SETTINGS,
      handMode: "dual",
      playerAHandSize: 2,
      playerBHandSize: 6,
    }, first);
    expect(state.hands.playerA).toHaveLength(2);
    expect(state.hands.playerB).toHaveLength(6);
    expect(state.remaining).toHaveLength(43);
  });

  it("一次抽取 N 张不会重复", () => {
    const state = resetGame({ ...DEFAULT_SETTINGS, sharedHandSize: 0 }, first);
    const result = drawCards(state, "shared", 10, first);
    expect(new Set(result.hands.shared.map((item) => item.instanceId)).size).toBe(10);
  });

  it("连续抽取不会抽到已经抽出的卡", () => {
    const state = resetGame({ ...DEFAULT_SETTINGS, sharedHandSize: 0 }, first);
    const once = drawCards(state, "shared", 12, first);
    const twice = drawCards(once, "shared", 12, first);
    expect(new Set(twice.hands.shared.map((item) => item.instanceId)).size).toBe(24);
  });

  it("使用卡牌后进入带归属的记录", () => {
    const state = resetGame({ ...DEFAULT_SETTINGS, sharedHandSize: 1 }, first);
    const target = state.hands.shared[0];
    const played = playCard(state, "shared", target.instanceId, 123);
    expect(played.hands.shared).toHaveLength(0);
    expect(played.used[0]).toMatchObject({ owner: "shared", recordedAt: 123 });
    expect(playCard(played, "shared", target.instanceId)).toBe(played);
  });

  it("风险卡可以跳过并补抽", () => {
    const deck = createDeck();
    const risk = deck.find((item) => item.safetyNote);
    expect(risk).toBeDefined();
    const state = resetGame({ ...DEFAULT_SETTINGS, sharedHandSize: 0 }, first);
    const custom = {
      ...state,
      remaining: state.remaining.filter((item) => item.instanceId !== risk!.instanceId),
      hands: { ...state.hands, shared: [risk!] },
    };
    const skipped = skipUnsafeCard(custom, "shared", risk!.instanceId, first, 456);
    expect(skipped.discarded[0]).toMatchObject({ owner: "shared", recordedAt: 456 });
    expect(skipped.hands.shared).toHaveLength(1);
  });

  it("损坏的本地数据会被拒绝", () => {
    expect(loadGameState("{broken")).toBeNull();
    expect(loadGameState(JSON.stringify({ remaining: [] }))).toBeNull();
  });

  it("旧版状态可迁移为一套手牌", () => {
    const deck = createDeck();
    const legacy = {
      remaining: deck.slice(2),
      hand: [deck[0]],
      used: [deck[1]],
    };
    const migrated = loadGameState(JSON.stringify(legacy));
    expect(migrated?.version).toBe(2);
    expect(migrated?.hands.shared).toHaveLength(1);
    expect(migrated?.used[0].owner).toBe("shared");
  });

  it("不能抽取超过剩余数量的卡", () => {
    const state = resetGame({ ...DEFAULT_SETTINGS, sharedHandSize: 0 }, first);
    expect(() => drawCards(state, "shared", 52, first)).toThrow();
  });
});
