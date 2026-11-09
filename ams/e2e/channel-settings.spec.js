import { test, expect } from "./fixtures.js";
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
test("Admin saves channel connection settings without exposing saved secrets and selects three language mappings", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "通訊設定", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "通訊設定", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("WhatsApp API key", { exact: true })
    .fill("dummy-ui-private-key");
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("通訊設定已儲存");
  await expect(
    page.getByLabel("WhatsApp API key", { exact: true }),
  ).toHaveValue("");
  await page.screenshot({
    path: "/private/tmp/workforce-settings/settings-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "WhatsApp 模板", exact: true })
    .click();
  for (const language of ["en", "yue", "zh"]) {
    await page.getByLabel("內容語言", { exact: true }).selectOption(language);
    await expect(page.getByLabel("Meta 語言代碼", { exact: true })).toHaveValue(
      language === "en" ? "en" : language === "yue" ? "zh_HK" : "zh_CN",
    );
  }
  await page
    .getByLabel("模板名稱", { exact: true })
    .fill("mandarin_shift_offer");
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/settings/channels")).json()).config
          .templates.zh.shift_offer_v1.name,
    )
    .toBe("mandarin_shift_offer");
  const body = await (await page.request.get("/api/settings/channels")).text();
  expect(body).not.toContain("dummy-ui-private-key");
});
test("Admin sees trilingual Twilio Say and can enable real mode without recordings", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "通訊設定", exact: true }).click();
  await page.getByRole("button", { name: "電話語音", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Twilio Say 三語語音", exact: true })).toBeVisible();
  for (const name of ["粵語", "普通話", "英語"]) await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.screenshot({ path: "/private/tmp/workforce-say/say-settings.png", fullPage: true });
  await page.getByRole("button", { name: "連線設定", exact: true }).click();
  await page.getByLabel("Twilio 模式", { exact: true }).selectOption("twilio-pstn");
  await page.getByLabel("Account SID", { exact: true }).fill("AC" + "1".repeat(32));
  await page.getByLabel("Auth Token", { exact: true }).fill("fake-test-token");
  await page.getByLabel("主叫號碼", { exact: true }).fill("+15005550006");
  await page.getByLabel("公開回調網址前綴", { exact: true }).fill("https://voice.example.test");
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await page.getByRole("button", { name: "確認啟用並儲存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("通訊設定已儲存");
  const c = (await (await page.request.get("/api/settings/channels")).json()).config;
  expect(c.voice.mode).toBe("twilio-pstn");
  expect(c.voice.authTokenConfigured).toBe(true);
  expect(c.prompts.yue.ack).toBeNull();
});
test("Cantonese staff dispatch uses speech without an upload step", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "新增員工", exact: true }).click();
  await page.getByLabel("姓名", { exact: true }).fill("粵語員工");
  await page.getByLabel("手機號碼", { exact: true }).fill("+6591234567");
  await page.getByLabel("語言代碼", { exact: true }).selectOption("yue");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByText("粵語員工", { exact: true })).toBeVisible();
  const site = await (
    await page.request.post("/api/sites", {
      data: { code: "REC", name: "Recording Site", timezone: "Asia/Hong_Kong" },
    })
  ).json();
  const staff = (await (await page.request.get("/api/staff")).json()).items[0];
  await page.request.post(`/api/sites/${site.id}/staff`, {
    data: { staff_ids: [staff.id] },
  });
  const start = Date.now() + 3 * 86400000;
  const r = await (
    await page.request.post("/api/requests", {
      data: {
        site_id: site.id,
        mode: "direct",
        staff_id: staff.id,
        headcount: 1,
        channels: ["voice"],
        start_at: new Date(start).toISOString(),
        end_at: new Date(start + 3600000).toISOString(),
      },
    })
  ).json();
  await page.getByRole("button", { name: "調度工作台", exact: true }).click();
  await page.getByRole("button", { name: "查看詳情", exact: true }).click();
  await expect(page.getByRole("heading", { name: "調度電話語音", exact: true })).toBeVisible();
  await expect(page.getByText("電話會按員工語言自動朗讀本次地點、日期、時間及按鍵提示，毋須上傳錄音。", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const response = await page.request.post(`/api/requests/${r.id}/send`, { data: {} });
  expect(response.status()).toBe(200);
  await page.screenshot({ path: "/private/tmp/workforce-say/say-dispatch.png", fullPage: true });
});

test("Admin edits only fixed speech fragments, previews locked data and persists three-language text", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "通訊設定", exact: true }).click();
  await page.getByRole("button", { name: "電話語音", exact: true }).click();
  await page.getByLabel("講稿語言", { exact: true }).selectOption("yue");
  await page.getByLabel("講稿用途", { exact: true }).selectOption("offer");
  const words = "，你好。有份工作想邀請你，地點係";
  await page.getByLabel("固定字句 2", { exact: true }).fill(words);
  const preview = page.getByRole("region", { name: "講稿預覽", exact: true });
  await expect(preview).toContainText(words);
  await expect(preview).toContainText("員工姓名");
  await expect(preview).toContainText("地點與地址");
  await expect(preview).toContainText("接受請按1");
  await expect(page.getByRole("textbox", { name: "員工姓名", exact: true })).toHaveCount(0);
  await page.getByLabel("講稿用途", { exact: true }).selectOption("ack");
  await page.getByLabel("固定字句 1", { exact: true }).fill("收到你嘅回覆，多謝。 ");
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("通訊設定已儲存");
  await page.reload();
  await page.getByRole("button", { name: "通訊設定", exact: true }).click();
  await page.getByRole("button", { name: "電話語音", exact: true }).click();
  await page.getByLabel("講稿語言", { exact: true }).selectOption("yue");
  await page.getByLabel("講稿用途", { exact: true }).selectOption("offer");
  await expect(page.getByLabel("固定字句 2", { exact: true })).toHaveValue(words);
  await page.getByLabel("講稿語言", { exact: true }).selectOption("en");
  await expect(page.getByLabel("固定字句 2", { exact: true })).toHaveValue(". This is a shift offer at ");
  await page.getByLabel("講稿語言", { exact: true }).selectOption("yue");
  await page.screenshot({ path: "/private/tmp/workforce-voice-text/editor.png", fullPage: true });
});
test('Admin uploads and maps MP3 mode recordings, then draft shows missing fragments and accepts supplementary audio', async ({page}) => {
  await login(page);
  await page.getByRole('button',{name:'通訊設定',exact:true}).click();
  await page.getByRole('button',{name:'電話語音',exact:true}).click();
  await page.getByLabel('電話內容方式',{exact:true}).selectOption('clips');
  await expect(page.getByRole('heading',{name:'自備錄音庫',exact:true})).toBeVisible();
  const wave=Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000','hex');
  await page.getByLabel('錄音片段',{exact:true}).selectOption('offer');
  await page.getByLabel('上傳此片段錄音',{exact:true}).setInputFiles({name:'offer.wav',mimeType:'audio/wav',buffer:wave});
  await expect(page.getByText('已加入此片段，請儲存設定。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'儲存設定',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('通訊設定已儲存');
  await page.reload();
  await page.getByRole('button',{name:'通訊設定',exact:true}).click();
  await page.getByRole('button',{name:'電話語音',exact:true}).click();
  await expect(page.getByLabel('電話內容方式',{exact:true})).toHaveValue('clips');
  await expect(page.getByLabel('使用已有錄音',{exact:true})).not.toHaveValue('');
  await page.screenshot({path:'/private/tmp/workforce-mp3-clips/library.png',fullPage:true});
  const site=await(await page.request.post('/api/sites',{data:{code:'MP3',name:'MP3 Depot',address:'1 Test Road',timezone:'Asia/Hong_Kong'}})).json();
  const staff=await(await page.request.post('/api/staff',{data:{name:'錄音員工',mobile:'+6591234567',language:'yue'}})).json();
  await page.request.post(`/api/sites/${site.id}/staff`,{data:{staff_ids:[staff.id]}});
  const request=await(await page.request.post('/api/requests',{data:{site_id:site.id,mode:'direct',staff_id:staff.id,headcount:1,channels:['voice'],message:'帶證件',start_at:'2099-11-10T00:00:00Z',end_at:'2099-11-10T08:00:00Z'}})).json();
  await page.getByRole('button',{name:'調度工作台',exact:true}).click();
  await page.getByRole('button',{name:'查看詳情',exact:true}).click();
  await expect(page.getByText('尚欠錄音',{exact:true})).toBeVisible();
  await expect(page.locator('ul').getByText('地點與地址 · MP3 Depot，1 Test Road',{exact:true})).toBeVisible();
  await page.getByLabel('補充說明錄音（粵語）',{exact:true}).setInputFiles({name:'message.wav',mimeType:'audio/wav',buffer:wave});
  await expect(page.getByText('補充錄音已上傳',{exact:true})).toBeVisible();
  const response=await page.request.post(`/api/requests/${request.id}/send`,{data:{}});
  expect(response.status()).toBe(409);
  const preview=await(await page.request.get(`/api/requests/${request.id}/voice-preview`)).json();
  expect(preview.languages[0].missing.map(x=>x.key)).not.toContain('message');
  await page.screenshot({path:'/private/tmp/workforce-mp3-clips/draft-preview.png',fullPage:true});
  const settings=await(await page.request.get('/api/settings/channels')).json();
  const catalog=await(await page.request.get('/api/settings/voice-clips/catalog?language=yue')).json();
  const asset=settings.config.voiceClips.library.yue.offer;
  for(const item of catalog.items)settings.config.voiceClips.library.yue[item.key]=asset;
  delete settings.config.voice.authTokenConfigured;delete settings.config.whatsapp.keyConfigured;
  expect((await page.request.patch('/api/settings/channels',{data:{expectedVersion:settings.id,config:settings.config}})).status()).toBe(200);
  await page.getByRole('button',{name:'重新檢查錄音',exact:true}).click();
  await expect(page.getByText('錄音已齊備，包含跟進通知。',{exact:true})).toBeVisible();
  const playback=page.waitForResponse(r=>r.url().includes('/media/voice/'));
  await page.getByRole('button',{name:'連續試聽',exact:true}).click();
  expect((await playback).status()).toBe(200);
  await expect(page.getByLabel('拼接語音試聽',{exact:true})).toBeVisible();
});
test('WhatsApp-only draft exposes the required recorded voice followup checklist',async({page})=>{
  await login(page);
  const settings=await(await page.request.get('/api/settings/channels')).json();
  settings.config.voiceClips.mode='clips';
  delete settings.config.voice.authTokenConfigured;delete settings.config.whatsapp.keyConfigured;
  expect((await page.request.patch('/api/settings/channels',{data:{expectedVersion:settings.id,config:settings.config}})).status()).toBe(200);
  const site=await(await page.request.post('/api/sites',{data:{code:'FALLBACK',name:'Fallback Depot',timezone:'Asia/Hong_Kong'}})).json();
  const staff=await(await page.request.post('/api/staff',{data:{name:'WA員工',mobile:'+6591234567',language:'yue',whatsapp_opt_in:true,whatsapp_opt_in_source:'test'}})).json();
  await page.request.post(`/api/sites/${site.id}/staff`,{data:{staff_ids:[staff.id]}});
  expect((await page.request.post('/api/requests',{data:{site_id:site.id,mode:'direct',staff_id:staff.id,headcount:1,channels:['whatsapp'],start_at:'2099-11-10T00:00:00Z',end_at:'2099-11-10T08:00:00Z'}})).status()).toBe(201);
  await page.getByRole('button',{name:'調度工作台',exact:true}).click();
  await page.getByRole('button',{name:'查看詳情',exact:true}).click();
  await expect(page.getByRole('heading',{name:'調度電話語音',exact:true})).toBeVisible();
  await expect(page.getByText('尚欠錄音',{exact:true})).toBeVisible();
  await expect(page.getByLabel('試聽通知（粵語）',{exact:true})).toHaveValue('confirmation');
});
