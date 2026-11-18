import { test, expect } from "./fixtures.js";

test("AMS switches between Traditional Chinese and English and remembers the choice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登入工作台", exact: true })).toBeVisible();
  await page.getByLabel("介面語言").selectOption("en");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Email", { exact: true }).fill("ui-admin@test.local");
  await page.getByLabel("Password", { exact: true }).fill("Local-test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dispatch", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Interface language")).toHaveValue("en");
  await page.getByLabel("Interface language").selectOption("zh-Hant");
  await page.getByRole("button", { name: "派更工作台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "派更工作台", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
});
