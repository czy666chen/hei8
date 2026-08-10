import { expect, Page, test } from "@playwright/test";

async function createScoreMatch(page: Page, playerCount = 2) {
  await page.goto("/");
  await page.getByRole("button", { name: /开始追分局/ }).click();
  for (let index = 2; index < playerCount; index += 1) {
    await page.getByRole("button", { name: /添加临时玩家/ }).click();
  }
  await page.getByRole("button", { name: /下一步：确认规则/ }).click();
  await page.getByRole("button", { name: /确认并开始/ }).click();
  await expect(page.locator(".live-label")).toHaveText(/对局进行中/);
}

test.describe("追分核心流程", () => {
  for (const playerCount of [2, 4, 8]) {
    test(`${playerCount} 人可建局`, async ({ page }) => {
      await createScoreMatch(page, playerCount);
      await expect(page.locator(".ranking-grid button")).toHaveCount(playerCount);
    });
  }

  test("建局、计分、撤销、结束和历史查看", async ({ page }) => {
    await createScoreMatch(page, 2);
    await page.locator(".score-actions button").filter({ hasText: "普胜" }).click();
    await expect(page.locator(".ledger-row")).toHaveCount(1);
    await page.getByRole("button", { name: /撤销上一笔/ }).click();
    await expect(page.locator(".ledger-row")).toHaveCount(0);
    await page.locator(".score-actions button").filter({ hasText: "小金" }).click();
    await page.getByRole("button", { name: "结束对局" }).click();
    await page.getByRole("button", { name: "确认结束并保存" }).click();
    await expect(page.getByRole("heading", { name: "追分结算" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "追分结算" })).toBeVisible();
  });
});

test("奇招牌抽取、使用、安全跳过和刷新恢复", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始奇招牌局" }).click();
  await page.getByRole("button", { name: /安全牌组/ }).click();
  await page.getByRole("button", { name: /下一步：确认规则/ }).click();
  await page.getByRole("button", { name: /确认并开始/ }).click();
  const initialCards = await page.locator(".trick-card").count();
  await page.locator(".trick-card").first().getByRole("button", { name: "使用此卡" }).click();
  await expect(page.locator(".trick-card")).toHaveCount(initialCards - 1);
  await page.getByRole("button", { name: /抽一张/ }).click();
  await page.locator(".trick-card").first().getByRole("button", { name: "安全跳过" }).click();
  await expect(page.getByRole("status")).toContainText("已安全跳过");
  await page.reload();
  await expect(page.locator(".live-label")).toHaveText(/对局进行中/);
  await expect(page.locator(".card-log")).toContainText("安全跳过");
});

test("未结束对局可保存后新建并恢复", async ({ page }) => {
  await createScoreMatch(page, 2);
  await page.getByRole("button", { name: "玩法" }).click();
  await page.getByRole("button", { name: /开始设置/ }).click();
  await expect(page.getByRole("heading", { name: "发现未结束对局" })).toBeVisible();
  await page.getByRole("button", { name: "保存当前对局后新建" }).click();
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "对局" }).click();
  await expect(page.getByRole("heading", { name: "继续未结束对局" })).toBeVisible();
  await page.getByRole("button", { name: /继续 →/ }).click();
  await expect(page.locator(".live-label")).toHaveText(/对局进行中/);
});

test("损坏的本机数据不会被静默覆盖", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("billiards-club-assistant:v1", "{broken-json"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本机数据无法读取" })).toBeVisible();
  await page.getByRole("button", { name: "备份并安全重置" }).click();
  await expect(page.getByRole("heading", { name: /今晚这桌/ })).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => key.includes(":corrupt-backup:"))).toBe(true);
});
