import { describe, expect, it } from "vitest";
import {
  calculateEightBallStats,
  correctEightBallRound,
  createEightBallMatch,
  eightBallElapsedMs,
  finishEightBallMatch,
  getEffectiveEightBallRounds,
  pauseEightBallMatch,
  recordEightBallRound,
  renameEightBallPlayer,
  resumeEightBallMatch,
  undoLastEightBallRound,
} from "./eight-ball";

const create = () => createEightBallMatch({
  playerNames: ["红方", "蓝方"], raceTo: 3, firstServer: 0, serveRule: "alternate", layout: "stacked",
}, 100);
const first = () => 0;

describe("中八追加式比赛模型", () => {
  it.each(["normal", "break_clear", "runout"] as const)("记录 %s 并累加胜方统计", (winType) => {
    const match = create();
    const winnerId = match.players[0].id;
    const scored = recordEightBallRound(match, { winnerId, winType, fouls: { [match.players[0].id]: 1, [match.players[1].id]: 2 }, note: "测试", startedAt: 110 }, 200);
    const stats = calculateEightBallStats(scored)[winnerId];
    expect(stats.score).toBe(1);
    expect(stats.normal + stats.breakClear + stats.runout).toBe(1);
    expect(stats.fouls).toBe(1);
    expect(scored.events[0]).toMatchObject({ sequenceNo: 1, matchVersion: 1, source: "user" });
    expect(scored.events[0].operationId).toBeTruthy();
  });

  it("双方多次犯规正确累计", () => {
    let match = create();
    match = recordEightBallRound(match, { winnerId: match.players[0].id, winType: "normal", fouls: { [match.players[0].id]: 2, [match.players[1].id]: 3 }, note: "", startedAt: 110 }, 200);
    match = recordEightBallRound(match, { winnerId: match.players[1].id, winType: "normal", fouls: { [match.players[0].id]: 1, [match.players[1].id]: 4 }, note: "", startedAt: 210 }, 300);
    const stats = calculateEightBallStats(match);
    expect(stats[match.players[0].id].fouls).toBe(3);
    expect(stats[match.players[1].id].fouls).toBe(7);
  });

  it("撤销追加更正事件且不删除原局", () => {
    const match = create();
    const scored = recordEightBallRound(match, { winnerId: match.players[0].id, winType: "normal", fouls: {}, note: "", startedAt: 110 }, 200);
    const undone = undoLastEightBallRound(scored, 300);
    expect(undone.events).toHaveLength(2);
    expect(undone.events[0].type).toBe("round");
    expect(undone.events[1]).toMatchObject({ type: "correction", source: "undo", correctsEventId: scored.events[0].id });
    expect(getEffectiveEightBallRounds(undone)).toHaveLength(0);
  });

  it("更正历史局后从完整流水重算比分与统计", () => {
    const match = create();
    const first = recordEightBallRound(match, { winnerId: match.players[0].id, winType: "normal", fouls: { [match.players[0].id]: 1 }, note: "旧", startedAt: 110 }, 200);
    const corrected = correctEightBallRound(first, first.events[0].id, { winnerId: match.players[1].id, winType: "runout", fouls: { [match.players[1].id]: 2 }, note: "改正", startedAt: 110, confirmedAt: 200 }, 300);
    const stats = calculateEightBallStats(corrected);
    expect(stats[match.players[0].id]).toMatchObject({ score: 0, fouls: 0 });
    expect(stats[match.players[1].id]).toMatchObject({ score: 1, runout: 1, fouls: 2 });
    expect(corrected.events[0].round?.note).toBe("旧");
  });

  it("改名保留稳定选手 ID 和旧事件姓名快照", () => {
    const match = create();
    const scored = recordEightBallRound(match, { winnerId: match.players[0].id, winType: "normal", fouls: {}, note: "", startedAt: 110 }, 200);
    const renamed = renameEightBallPlayer(scored, match.players[0].id, "新红方", 300);
    expect(renamed.players[0]).toMatchObject({ id: match.players[0].id, name: "新红方" });
    expect(renamed.events[0].playerNames[match.players[0].id]).toBe("红方");
    expect(renamed.events[1]).toMatchObject({ type: "rename", previousName: "红方", nextName: "新红方" });
  });

  it("暂停时间不计入累计用时且可在刷新数据后恢复", () => {
    const match = create();
    const paused = pauseEightBallMatch(match, 1_100);
    const serialized = JSON.parse(JSON.stringify(paused));
    expect(eightBallElapsedMs(serialized, 5_100)).toBe(1_000);
    const resumed = resumeEightBallMatch(serialized, 5_100);
    expect(eightBallElapsedMs(resumed, 6_100)).toBe(2_000);
    expect(finishEightBallMatch(resumed, 7_100).status).toBe("completed");
  });

  it("抢 N 只提示目标达到，模型不会自动锁死", () => {
    let match = createEightBallMatch({ playerNames: ["A", "B"], raceTo: 1, firstServer: 0, serveRule: "winner", layout: "split" }, 100);
    match = recordEightBallRound(match, { winnerId: match.players[0].id, winType: "normal", fouls: {}, note: "", startedAt: 110 }, 200);
    expect(match.status).toBe("active");
    expect(calculateEightBallStats(match)[match.players[0].id].score).toBe(1);
  });

  it("可启用独立奇招牌并在每局后重发", () => {
    const match = createEightBallMatch({
      playerNames: ["A", "B"],
      raceTo: 3,
      firstServer: 0,
      serveRule: "alternate",
      layout: "split",
      cardMode: "independent",
      initialHandSizes: [1, 2],
      initialHandSize: 1,
    }, 100, first);
    expect(match.cards!.hands[match.players[0].id]).toHaveLength(1);
    expect(match.cards!.hands[match.players[1].id]).toHaveLength(2);
    const before = match.cards!.hands[match.players[0].id][0].instanceId;
    const scored = recordEightBallRound(match, { winnerId: match.players[0].id, winType: "normal", fouls: {}, note: "", startedAt: 110 }, 200);
    expect(scored.cards!.hands[match.players[0].id]).toHaveLength(1);
    expect(scored.cards!.hands[match.players[1].id]).toHaveLength(2);
    expect(scored.cards!.hands[match.players[0].id][0].instanceId).not.toBe(before);
    expect(scored.cards!.events[0]).toMatchObject({ type: "reshuffle", label: "下一局重新发牌" });
  });
});
