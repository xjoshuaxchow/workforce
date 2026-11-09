import { test, expect } from "./fixtures.js";

test("AC-D-02-03 request form rejects an end time before its start without sending", async ({
  page,
}) => {
  await login(page);
  await create(page, "/sites", {
    code: "FORM-TIME",
    name: "Form Time Depot",
    timezone: "Asia/Singapore",
  });
  await page.getByRole("button", { name: "調度工作台", exact: true }).click();
  await page.getByRole("button", { name: "新增調度", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增調度" });
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("開始時間", { exact: true }).fill(date + "T15:00");
  await dialog.getByLabel("結束時間", { exact: true }).fill(date + "T07:00");
  await expect(dialog.getByRole("alert")).toContainText(
    "結束時間必須晚於開始時間",
  );
  await expect(
    dialog.getByRole("button", { name: "建立草稿", exact: true }),
  ).toBeDisabled();
  expect((await (await page.request.get("/api/requests")).json()).total).toBe(
    0,
  );
});
async function login(page) {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "員工管理", exact: true }),
  ).toBeVisible();
}
async function create(page, path, data) {
  const r = await page.request.post("/api" + path, { data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function fixture(page, code, name, mobile) {
  const site = await create(page, "/sites", {
    code,
    name: code + " Depot",
    timezone: "Asia/Singapore",
  });
  const staff = await create(page, "/staff", {
    name,
    mobile,
    whatsapp_opt_in: true,
    whatsapp_opt_in_source: "test",
  });
  await create(page, `/sites/${site.id}/staff`, { staff_ids: [staff.id] });
  return { site, staff };
}

test("AC-D-02-05 direct invitation from the staff page prefills the staff and linked site", async ({
  page,
}) => {
  await login(page);
  const { site, staff } = await fixture(
    page,
    "DIRECT-UI",
    "Direct UI Anna",
    "+6592345678",
  );
  await page.getByLabel("搜尋員工").fill(staff.name);
  await page
    .getByRole("row")
    .filter({ hasText: staff.name })
    .getByRole("button", { name: "直接邀請", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "新增調度" });
  await expect(dialog.getByLabel("模式", { exact: true })).toHaveValue(
    "direct",
  );
  await expect(dialog.getByLabel("指定員工", { exact: true })).toHaveValue(
    staff.id,
  );
  await expect(dialog.getByLabel("工作地點", { exact: true })).toHaveValue(
    site.id,
  );
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("開始時間", { exact: true }).fill(date + "T07:00");
  await dialog.getByLabel("結束時間", { exact: true }).fill(date + "T15:00");
  await dialog.getByRole("button", { name: "建立草稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "調度詳情" })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: staff.name }),
  ).toHaveCount(1);
});

test("AC-D-04-02 per-channel reply receipt time is visible in request details", async ({
  page,
}) => {
  await login(page);
  const { site, staff } = await fixture(
    page,
    "TIMES-UI",
    "Time UI Anna",
    "+6592345679",
  );
  const start = new Date(Date.now() + 4 * 86400000);
  const request = await create(page, "/requests", {
    site_id: site.id,
    mode: "direct",
    staff_id: staff.id,
    channels: ["whatsapp", "voice"],
    headcount: 1,
    start_at: start.toISOString(),
    end_at: new Date(+start + 8 * 3600000).toISOString(),
  });
  const sent = await create(page, `/requests/${request.id}/send`, {});
  for (const a of sent.candidates[0].attempts)
    await create(page, `/mock/attempts/${a.id}/events`, {
      type: "reply",
      option_id: "ACCEPT",
    });
  const detail = await (
    await page.request.get("/api/requests/" + request.id)
  ).json();
  await page.getByRole("button", { name: "調度工作台", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "TIMES-UI Depot" })
    .getByRole("button", { name: "查看詳情" })
    .click();
  const row = page.getByRole("row").filter({ hasText: staff.name });
  for (const [channel, label] of [
    ["whatsapp", "WhatsApp 回覆時間"],
    ["voice", "電話回覆時間"],
  ]) {
    const a = detail.candidates[0].attempts.find(
      (a) => a.channel === channel && a.purpose === "offer",
    );
    await expect(row.getByLabel(label, { exact: true })).toHaveAttribute(
      "datetime",
      a.response_at,
    );
  }
  await page.screenshot({
    path: "test-results/local-complete-channel-times.png",
    fullPage: true,
  });
});

test("G-08 site and staff pickers can search and select records beyond the first 200", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  const csv =
    "name,mobile\n" +
    Array.from(
      { length: 201 },
      (_, i) =>
        `Directory ${String(i).padStart(3, "0")},+6592${String(i).padStart(6, "0")}`,
    ).join("\n");
  await create(page, "/staff/import", { csv });
  for (let i = 0; i < 201; i += 10)
    await Promise.all(
      Array.from({ length: Math.min(10, 201 - i) }, (_, j) =>
        create(page, "/sites", {
          code: `DIR${String(i + j).padStart(3, "0")}`,
          name: `Directory Depot ${i + j}`,
          timezone: "Asia/Singapore",
        }),
      ),
    );
  const { site, staff } = await fixture(
    page,
    "ZZ-DIRECT",
    "ZZ Directory Target",
    "+6592234567",
  );
  await page.getByRole("button", { name: "班表", exact: true }).click();
  await page.getByLabel("搜尋班表地點", { exact: true }).fill(site.name);
  await page.getByLabel("班表地點", { exact: true }).selectOption(site.id);
  await page.getByRole("button", { name: "新增班次", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增班次" });
  await dialog.getByLabel("搜尋指派員工", { exact: true }).fill(staff.name);
  await dialog.getByLabel("指派員工", { exact: true }).selectOption(staff.id);
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("開始時間", { exact: true }).fill(date + "T07:00");
  await dialog.getByLabel("結束時間", { exact: true }).fill(date + "T15:00");
  await dialog.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("班次已儲存");
  await page.getByRole("button", { name: "員工管理", exact: true }).click();
  await page.getByLabel("搜尋員工").fill(staff.name);
  await page
    .getByRole("row")
    .filter({ hasText: staff.name })
    .getByRole("button", { name: "直接邀請", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "新增調度" })
      .getByLabel("工作地點", { exact: true }),
  ).toHaveValue(site.id);
  await page.screenshot({
    path: "test-results/local-complete-direct-invite.png",
    fullPage: true,
  });
});
