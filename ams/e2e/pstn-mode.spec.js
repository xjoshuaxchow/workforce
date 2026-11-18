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
    await page.getByRole("button", { name: "派更工作台", exact: true }).click();
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

test("Redial keeps missed and new calls visible on the same work request", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page.getByLabel("密碼", { exact: true }).fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();

  const post = async (path, data = {}) => {
    const response = await page.request.post("/api" + path, { data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const site = await post("/sites", { code: "REDIAL", name: "Redial Site" });
  const staff = await post("/staff", { name: "Anna Redial", mobile: "+6598765433" });
  await post(`/sites/${site.id}/staff`, { staff_ids: [staff.id] });

  const start = Date.now() + 3 * 86400000;
  const request = await post("/requests", {
    site_id: site.id,
    mode: "direct",
    staff_id: staff.id,
    headcount: 1,
    channels: ["voice"],
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + 3600000).toISOString(),
  });
  const path = `/requests/${request.id}`;
  const sent = await post(path + "/send");
  await post("/mock/run-jobs");

  await page.getByRole("button", { name: "派更工作台", exact: true }).click();
  await page.getByRole("button", { name: "查看詳情" }).click();
  const candidate = page.getByRole("row").filter({ hasText: staff.name });
  await expect(candidate.getByRole("button", { name: "重撥電話" })).toHaveCount(0);

  const first = sent.candidates[0].attempts[0];
  await post(`/mock/attempts/${first.id}/events`, { type: "no_answer" });
  await candidate.getByRole("button", { name: "重撥電話" }).click();
  const dialog = page.getByRole("dialog", { name: "重撥電話" });
  await expect(dialog).toContainText(staff.mobile);
  await dialog.getByRole("button", { name: "重撥電話", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(candidate.getByRole("button", { name: "重撥電話" })).toHaveCount(0);
  await candidate.getByText("通話紀錄（2）").click();
  await expect(candidate.getByRole("listitem")).toHaveCount(2);
  await expect(candidate.getByRole("listitem").last()).toContainText("未接聽");

  await page.getByLabel("介面語言").selectOption("en");
  await expect(candidate.getByText("Call history (2)")).toBeVisible();
  await expect(candidate.getByRole("listitem").last()).toContainText("No answer");
});

test("Editing a sent request and extending the deadline keep its call history", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page.getByLabel("密碼", { exact: true }).fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();

  async function post(path, data = {}) {
    const response = await page.request.post("/api" + path, { data });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  const site = await post("/sites", { code: "EDIT-REQUEST", name: "Edit Request Site" });
  const staff = await post("/staff", { name: "Edit Request Anna", mobile: "+6598765433" });
  await post(`/sites/${site.id}/staff`, { staff_ids: [staff.id] });

  const { utcToLocal, HONG_KONG_TIMEZONE } = await import("../src/time.js");
  const start = new Date(Date.now() + 3 * 86400000);
  const deadline = new Date(+start - 4 * 3600000);
  const extension = new Date(+start - 2 * 3600000);
  const request = await post("/requests", {
    site_id: site.id,
    mode: "broadcast",
    headcount: 2,
    channels: ["voice"],
    start_at: start.toISOString(),
    end_at: new Date(+start + 3600000).toISOString(),
    deadline_at: deadline.toISOString(),
    message: "Original notes",
  });
  const path = `/requests/${request.id}`;
  const sent = await post(path + "/send");
  await post("/mock/run-jobs");
  const candidate = sent.candidates[0];
  const attempt = candidate.attempts[0];
  await post(`/mock/attempts/${attempt.id}/events`, { type: "no_answer" });
  const redialed = await post(path + `/candidates/${candidate.id}/redial`, { attempt_id: attempt.id });
  const second = redialed.candidates[0].attempts.find((call) => call.id !== attempt.id);
  await post("/mock/run-jobs");
  await post(`/mock/attempts/${second.id}/events`, { type: "reply", option_id: "DECLINE" });

  await page.getByRole("button", { name: "派更工作台", exact: true }).click();
  await page.getByRole("button", { name: "查看詳情" }).click();
  await page.getByRole("button", { name: "編輯工單" }).click();
  const edit = page.getByRole("dialog", { name: "編輯工單" });
  await expect(edit.getByLabel("工作地點")).toHaveCount(0);
  await expect(edit.getByLabel("開始時間")).toHaveCount(0);
  await edit.getByLabel("所需人數").fill("3");
  await edit.getByLabel("補充說明").fill("Latest AMS notes");
  await edit.getByRole("button", { name: "儲存" }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByText("Latest AMS notes")).toBeVisible();
  await expect(page.getByText("已拒絕", { exact: true })).toBeVisible();
  await page.getByText("通話紀錄（2）").click();
  await expect(page.getByRole("listitem").last()).toContainText("未接聽");

  await page.getByLabel("介面語言").selectOption("en");
  await page.getByRole("button", { name: "Extend reply deadline" }).click();
  const extend = page.getByRole("dialog", { name: "Extend reply deadline" });
  await extend.getByLabel("New reply deadline").fill(utcToLocal(extension.toISOString(), HONG_KONG_TIMEZONE));
  await extend.getByRole("button", { name: "Save", exact: true }).click();
  await expect(extend).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Reply deadline extended.");

  const updated = await (await page.request.get("/api" + path)).json();
  expect(updated.id).toBe(request.id);
  expect(updated.deadline_at.slice(0, 16)).toBe(extension.toISOString().slice(0, 16));
  expect(updated.headcount).toBe(3);
  expect(updated.candidates[0].final_response).toBe("decline");
  expect(updated.candidates[0].attempts.map((call) => call.id)).toEqual([attempt.id, second.id]);
});
