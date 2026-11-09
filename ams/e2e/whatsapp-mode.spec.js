import { test, expect } from "./fixtures.js";
for (const voice of ["mock", "twilio"])
  test(`WhatsApp service mode is visible with ${voice} voice and guards browser writes`, async ({
    page,
  }) => {
    const mode =
      (voice === "mock" ? "mock" : "twilio-pstn") + "+whatsapp-service";
    await page.route("**/api/messaging/status", (route) =>
      route.fulfill({ json: { mode, voice, whatsapp: "service" } }),
    );
    await page.goto("/");
    await page.getByLabel("電郵").fill("ui-admin@test.local");
    await page
      .getByLabel("密碼", { exact: true })
      .fill("Local-test-password-123");
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(
      page.getByText(
        `電話：${voice === "mock" ? "模擬" : "Twilio PSTN 真實撥號"} · WhatsApp：microservice 真實發送`,
        { exact: true },
      ),
    ).toBeVisible();
    let observed;
    await page.route("**/api/sites", async (route) => {
      if (route.request().method() === "POST") {
        observed = route.request().headers()["x-workforce-messaging-mode"];
        return route.fulfill({
          status: 201,
          json: { id: "11111111-1111-4111-8111-111111111111" },
        });
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "工作地點", exact: true }).click();
    await page.getByRole("button", { name: "新增地點", exact: true }).click();
    await page.getByLabel("代碼", { exact: true }).fill("WA-MODE");
    await page.getByLabel("地點名稱", { exact: true }).fill("WA Mode Site");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已儲存");
    expect(observed).toBe(mode);
  });
