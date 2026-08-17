import { expect, test } from "@playwright/test";

test.describe("多人实时房间全屏化", () => {
  test("首页不再内嵌房间面板，提供进入 /room 的入口", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".realtime-room-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /多人实时房间/ })).toBeVisible();
  });

  test("/room 全屏入口页对游客显示登录引导", async ({ page }) => {
    await page.goto("/room");
    await expect(page.getByRole("heading", { name: "多人实时房间" })).toBeVisible();
    await expect(page.getByText("需要登录", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /前往登录/ }).click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test("/room/:code 路径可直达全屏房间页外壳", async ({ page }) => {
    await page.goto("/room/ABC234");
    await expect(page.getByRole("heading", { name: "多人实时房间" })).toBeVisible();
  });
});
