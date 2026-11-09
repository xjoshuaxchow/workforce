import { test, expect } from "./fixtures.js";
for (const mode of ["mock", "twilio-pstn"])
  test(`PSTN mode ${mode} is explicit and mock tools match the active mode`, async ({
    page,
  }) => {
    await page.route("**/api/messaging/status", (route) =>
      route.fulfill({
        json: {
          mode,
          voice: mode === "mock" ? "mock" : "twilio",
          whatsapp: "mock",
        },
      }),
    );
    await page.goto("/");
    await page.getByLabel("電郵").fill("ui-admin@test.local");
    await page
      .getByLabel("密碼", { exact: true })
      .fill("Local-test-password-123");
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(
      page.getByText(
        mode === "mock"
          ? "電話：模擬 · WhatsApp：模擬"
          : "電話：Twilio PSTN 真實撥號 · WhatsApp：模擬",
        { exact: true },
      ),
    ).toBeVisible();
    const site = await (
      await page.request.post("/api/sites", {
        data: { code: "MODE", name: "Mode test", timezone: "Asia/Singapore" },
      })
    ).json();
    const start = Date.now() + 3 * 86400000;
    await page.request.post("/api/requests", {
      data: {
        site_id: site.id,
        mode: "broadcast",
        headcount: 1,
        channels: ["voice"],
        start_at: new Date(start).toISOString(),
        end_at: new Date(start + 3600000).toISOString(),
      },
    });
    await page.getByRole("button", { name: "調度工作台", exact: true }).click();
    await page.getByRole("button", { name: "查看詳情" }).click();
    if (mode === "mock")
      await expect(
        page.getByText("本機測試工具", { exact: true }),
      ).toBeVisible();
    else
      await expect(page.getByText("本機測試工具", { exact: true })).toHaveCount(
        0,
      );
  });

test("PSTN mode refreshes on focus without losing the active login", async ({
  page,
}) => {
  let mode = "mock";
  await page.route("**/api/messaging/status", (route) =>
    route.fulfill({
      json: {
        mode,
        voice: mode === "mock" ? "mock" : "twilio",
        whatsapp: "mock",
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(
    page.getByText("電話：模擬 · WhatsApp：模擬", { exact: true }),
  ).toBeVisible();
  mode = "twilio-pstn";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("電話：Twilio PSTN 真實撥號 · WhatsApp：模擬", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "員工管理", exact: true }),
  ).toBeVisible();
});
