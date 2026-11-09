import { test, expect } from "./fixtures.js";
async function login(page) {
  await page.goto("/");
  await page.getByLabel("電郵").fill("ui-admin@test.local");
  await page
    .getByLabel("密碼", { exact: true })
    .fill("Local-test-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "員工管理" })).toBeVisible();
}
async function post(page, path, data) {
  const r = await page.request.post("/api" + path, { data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}

test("Review regression candidate search stays clearable when adding staff shrinks the picker to 50 options", async ({
  page,
}) => {
  test.setTimeout(30000);
  await login(page);
  const site = await post(page, "/sites", {
    code: "SHRINK",
    name: "Shrink Depot",
    timezone: "Asia/Singapore",
  });
  const csv =
    "name,mobile\n" +
    Array.from(
      { length: 50 },
      (_, i) =>
        `Picker Staff ${String(i).padStart(2, "0")},+6593${String(i).padStart(6, "0")}`,
    ).join("\n");
  await post(page, "/staff/import", { csv });
  const staff = (await (await page.request.get("/api/staff?limit=200")).json())
    .items;
  await post(page, `/sites/${site.id}/staff`, {
    staff_ids: staff.map((s) => s.id),
  });
  const start = new Date(Date.now() + 3 * 86400000);
  const r = await post(page, "/requests", {
    site_id: site.id,
    mode: "broadcast",
    channels: ["voice"],
    headcount: 1,
    start_at: start.toISOString(),
    end_at: new Date(+start + 8 * 3600000).toISOString(),
  });
  for (const c of r.candidates) {
    const removed = await page.request.delete(
      `/api/requests/${r.id}/candidates/${c.id}`,
    );
    expect(removed.ok()).toBeTruthy();
  }
  await page.getByRole("button", { name: "調度工作台", exact: true }).click();
  await page.getByRole("button", { name: "查看詳情" }).click();
  const search = page.getByLabel("搜尋加入候選員工", { exact: true });
  await search.fill("Picker Staff 00");
  const target = staff.find((s) => s.name === "Picker Staff 00");
  await page
    .getByLabel("加入候選員工", { exact: true })
    .selectOption(target.id);
  await page.getByRole("button", { name: "加入候選人", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: target.name }),
  ).toHaveCount(1);
  await expect(search).toBeVisible();
  await search.fill("");
  await expect(
    page.getByLabel("加入候選員工", { exact: true }).locator("option"),
  ).toHaveCount(50);
  await expect(
    page.getByRole("button", { name: "加入候選人", exact: true }),
  ).toBeDisabled();
});

test("Review regression linkage save can retry a transient failure without losing selections", async ({
  page,
}) => {
  await login(page);
  const site = await post(page, "/sites", {
    code: "RETRY",
    name: "Retry Depot",
    timezone: "Asia/Singapore",
  });
  const staff = await post(page, "/staff", {
    name: "Retry Anna",
    mobile: "+6593456789",
  });
  await page.getByRole("button", { name: "工作地點", exact: true }).click();
  await page.getByRole("button", { name: "管理員工", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(staff.name).check();
  let fail = true;
  await page.route(`**/api/sites/${site.id}/staff`, async (route) => {
    if (route.request().method() === "POST" && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Temporary save failure" }),
      });
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "儲存關聯" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Temporary save failure",
  );
  await expect(dialog.getByLabel(staff.name)).toBeChecked();
  await expect(dialog.getByRole("button", { name: "儲存關聯" })).toBeEnabled();
  await dialog.getByRole("button", { name: "儲存關聯" }).click();
  await expect(page.getByRole("status")).toContainText("員工關聯已儲存");
  const linked = await (
    await page.request.get(`/api/sites/${site.id}/staff`)
  ).json();
  expect(linked.items.map((s) => s.id)).toContain(staff.id);
});
