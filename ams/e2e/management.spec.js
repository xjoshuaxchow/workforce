import { test, expect } from "./fixtures.js";
test("AC-D-01-01/02/04 admin creates staff, site and linkage in the browser", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();
  await page.getByRole("button", { name: "新增員工", exact: true }).click();
  await page.getByLabel("姓名", { exact: true }).fill("Anna E2E");
  await page.getByLabel("手機號碼").fill("+6598765432");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByText("Anna E2E", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "工作地點", exact: true }).click();
  await page.getByRole("button", { name: "新增地點", exact: true }).click();
  await page.getByLabel("代碼", { exact: true }).fill("E2E-SITE");
  await page.getByLabel("地點名稱").fill("E2E North");
  await page.getByLabel("時區", { exact: true }).fill("Asia/Singapore");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "E2E North" })
    .getByRole("button", { name: "管理員工" })
    .click();
  await page.getByLabel("Anna E2E").check();
  await page.getByRole("button", { name: "儲存關聯" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登入", exact: true }),
  ).toBeVisible();
});
test("AC-D-02-01 and AC-D-04-01 dispatch response appears through polling", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();
  const site = await (
    await page.request.post("/api/sites", {
      data: {
        code: "CALL-TEST",
        name: "Call Test Site",
        timezone: "Asia/Singapore",
      },
    })
  ).json();
  const staff = await (
    await page.request.post("/api/staff", {
      data: {
        name: "Call Test Anna",
        mobile: "+6598765433",
        whatsapp_opt_in: true,
        whatsapp_opt_in_source: "paper_form",
      },
    })
  ).json();
  await page.request.post(`/api/sites/${site.id}/staff`, {
    data: { staff_ids: [staff.id] },
  });
  await page.getByRole("button", { name: "調度工作台", exact: true }).click();
  await page.getByRole("button", { name: "新增調度", exact: true }).click();
  await page.getByLabel("工作地點", { exact: true }).selectOption(site.id);
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("開始時間", { exact: true }).fill(`${date}T07:00`);
  await page.getByLabel("結束時間", { exact: true }).fill(`${date}T15:00`);
  await page.getByRole("button", { name: "建立草稿", exact: true }).click();
  await page.getByRole("button", { name: "發送邀請", exact: true }).click();
  await page.getByRole("button", { name: "確認發送", exact: true }).click();
  await expect(page.getByText("聯絡中", { exact: true }).first()).toBeVisible();
  const requests = await (await page.request.get("/api/requests")).json();
  const created = requests.items.find((r) => r.site_id === site.id);
  const detail = await (
    await page.request.get(`/api/requests/${created.id}`)
  ).json();
  const attempt = detail.candidates[0].attempts.find(
    (a) => a.purpose === "offer",
  );
  await page.request.post(`/api/mock/attempts/${attempt.id}/events`, {
    data: { type: "reply", option_id: "ACCEPT" },
  });
  await expect(page.getByText("已額滿", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("heading", { name: "1 / 1", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/local-dispatch-preview.png",
    fullPage: true,
  });
});
test("Review regression changing roster site hides stale actionable shifts during loading", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();
  const a = await (
    await page.request.post("/api/sites", {
      data: { code: "STALE-A", name: "Stale A", timezone: "Asia/Singapore" },
    })
  ).json();
  const b = await (
    await page.request.post("/api/sites", {
      data: { code: "STALE-B", name: "Stale B", timezone: "Asia/Singapore" },
    })
  ).json();
  const start = new Date(Date.now() + 2 * 86400000);
  start.setUTCHours(23, 0, 0, 0);
  await page.request.post("/api/shifts", {
    data: {
      site_id: a.id,
      start_at: start.toISOString(),
      end_at: new Date(+start + 8 * 3600000).toISOString(),
    },
  });
  await page.getByRole("button", { name: "班表", exact: true }).click();
  await expect(page.getByRole("button", {name:"07:00–15:00",exact:true})).toBeVisible();
  await page.getByLabel("班表地點").selectOption(a.id);
  await expect(
    page.getByRole("button", { name: "07:00–15:00", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/local-roster-preview.png",
    fullPage: true,
  });
  let release;
  const waiting = new Promise((r) => {
    release = r;
  });
  await page.route(`**/api/sites/${b.id}/roster?**`, async (route) => {
    await waiting;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        site: b,
        timezone: b.timezone,
        groups: [],
        days: {},
      }),
    });
  });
  try {
    await page.getByLabel("班表地點").selectOption(b.id);
    await expect(
      page.getByRole("button", { name: "07:00–15:00", exact: true }),
    ).toHaveCount(0, { timeout: 1000 });
  } finally {
    release();
  }
});
test("AC-S-01-09 deactivation visibly lists the retained future assignment", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();
  const site = await (
    await page.request.post("/api/sites", {
      data: { code: "WARN", name: "Warning Site", timezone: "Asia/Singapore" },
    })
  ).json();
  const staff = await (
    await page.request.post("/api/staff", {
      data: { name: "Warning Anna", mobile: "+6598765435" },
    })
  ).json();
  await page.request.post(`/api/sites/${site.id}/staff`, {
    data: { staff_ids: [staff.id] },
  });
  const start = new Date(Date.now() + 3 * 86400000);
  const r = await (
    await page.request.post("/api/requests", {
      data: {
        site_id: site.id,
        mode: "direct",
        staff_id: staff.id,
        headcount: 1,
        channels: ["voice"],
        start_at: start.toISOString(),
        end_at: new Date(+start + 8 * 3600000).toISOString(),
      },
    })
  ).json();
  const sent = await (
    await page.request.post(`/api/requests/${r.id}/send`, { data: {} })
  ).json();
  await page.request.post(
    `/api/mock/attempts/${sent.candidates[0].attempts[0].id}/events`,
    { data: { type: "reply", option_id: "ACCEPT" } },
  );
  await page.getByLabel("搜尋員工").fill("Warning Anna");
  await page
    .getByRole("row")
    .filter({ hasText: "Warning Anna" })
    .getByRole("button", { name: "編輯", exact: true })
    .click();
  await page.getByLabel("狀態", { exact: true }).selectOption("inactive");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("未來班次仍然保留");
  await expect(page.getByRole("status")).toContainText("Warning Site");
});
