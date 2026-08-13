import { describe, expect, it } from "vitest";
import { createEightBallMatch, finishEightBallMatch } from "./eight-ball";
import { EMPTY_APP_DATA } from "./local-storage";
import { reconcileCloudMatches } from "./cloud-reconcile";

describe("cloud match reconciliation", () => {
  it("moves a stale active match to history when another device completed it", () => {
    const active = createEightBallMatch({ playerNames: ["红方", "蓝方"], raceTo: 3, firstServer: 0, serveRule: "alternate", layout: "split" }, 100);
    const completed = finishEightBallMatch(active, 500);
    const result = reconcileCloudMatches({ ...EMPTY_APP_DATA, activeEightBallMatch: active }, [completed]);
    expect(result.activeEightBallMatch).toBeNull();
    expect(result.eightBallHistory).toEqual([completed]);
    expect(reconcileCloudMatches(result, [completed])).toBe(result);
  });
});
