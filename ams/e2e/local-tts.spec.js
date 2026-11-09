import { test, expect } from './fixtures.js';
for (const [language,label] of [['yue','粵語'],['en','英語']]) {
  test(`Local ${language} settings, full MP3 generation and reuse need no cloud key`,async({page})=>{
    await page.goto('/');await page.getByLabel('電郵').fill('ui-admin@test.local');await page.getByLabel('密碼',{exact:true}).fill('Local-test-password-123');await page.getByRole('button',{name:'登入',exact:true}).click();
    await page.getByRole('button',{name:'通訊設定',exact:true}).click();await page.getByRole('button',{name:'電話語音',exact:true}).click();
    await expect(page.getByLabel('電話內容方式',{exact:true}).locator('option[value="local-mp3"]')).toHaveCount(1,{timeout:1000});
    await page.getByLabel('電話內容方式',{exact:true}).selectOption('local-mp3');
    await expect(page.getByRole('heading',{name:'本機完整 MP3',exact:true})).toBeVisible();
    await expect(page.getByText('本機語音已安裝，可生成粵語及英語。',{exact:true})).toBeVisible();
    await page.getByLabel('本機語速',{exact:true}).selectOption('0.9');
    await page.getByRole('button',{name:'儲存設定',exact:true}).click();await expect(page.getByRole('status')).toContainText('通訊設定已儲存');
    const site=await(await page.request.post('/api/sites',{data:{code:'LOCAL'+language,name:language==='yue'?'九龍灣辦公室':'Local Depot',timezone:'Asia/Hong_Kong'}})).json();
    const staff=await(await page.request.post('/api/staff',{data:{name:'Local Staff',mobile:'+6591234567',language}})).json();
    await page.request.post(`/api/sites/${site.id}/staff`,{data:{staff_ids:[staff.id]}});
    const request=await(await page.request.post('/api/requests',{data:{site_id:site.id,mode:'direct',staff_id:staff.id,headcount:1,channels:['voice'],message:language==='yue'?'LOCAL_TEST_FAILURE':'',start_at:'2099-11-10T00:00:00Z',end_at:'2099-11-10T08:00:00Z'}})).json();
    await page.getByRole('button',{name:'調度工作台',exact:true}).click();await page.getByRole('button',{name:'查看詳情',exact:true}).click();
    const generate=page.getByRole('button',{name:`生成缺少 MP3（${label}）`,exact:true});
    await expect(generate).toBeEnabled();await generate.click();
    if(language==='yue'){
      await expect(page.getByText('生成失敗',{exact:true})).toBeVisible();
      await expect(page.getByText('Azure Key',{exact:false})).toHaveCount(0);
      await generate.click();
    }
    await expect(page.getByText('此語言音檔已齊備。',{exact:true})).toBeVisible();
    await expect(page.locator('audio[aria-label$="完整音檔試聽"]')).toHaveCount(6);
    const view=await(await page.request.get(`/api/requests/${request.id}/voice-preview`)).json();
    expect(view.mode).toBe('local-mp3');const item=view.languages[0].required[0];
    expect((await page.request.get(item.playback_path)).headers()['content-type']).toContain('audio/mpeg');
    expect((await(await page.request.post(`/api/requests/${request.id}/voice-synthesis`,{data:{language,purpose:item.purpose,expectedHash:item.hash}})).json()).asset_id).toBe(item.asset_id);
    const selected=view.languages[0].required.find(x=>x.purpose===(language==='yue'?'ack':'offer'));
    const card=page.locator('.azure-audio-item').filter({has:page.getByRole('heading',{name:selected.label,exact:true})});
    await expect(card.getByRole('button',{name:'修改這段講稿',exact:true})).toBeVisible({timeout:1000});
    await card.getByRole('button',{name:'修改這段講稿',exact:true}).click();
    const editor=page.getByRole('dialog',{name:`修改講稿：${selected.label}`,exact:true});
    await expect(editor).toBeVisible();
    await editor.getByLabel(language==='yue'?'固定字句 1':'固定字句 2',{exact:true}).fill(language==='yue'?'已收到，多謝你。':'. Please consider this work at ');
    if(language==='en'){
      await expect(editor.getByText('Local Depot',{exact:true})).toBeVisible();
      let failRefresh=true;
      await page.route(`**/api/requests/${request.id}/voice-preview`,route=>{if(failRefresh){failRefresh=false;return route.abort();}return route.continue();});
      await editor.getByRole('button',{name:'只儲存講稿',exact:true}).click();
      await expect(editor.getByText('講稿已儲存，但頁面未能更新。可重新檢查語音，或繼續修改後再儲存。',{exact:true})).toBeVisible();
      await editor.getByLabel('固定字句 2',{exact:true}).fill('. Please review this work at ');
      await editor.getByRole('button',{name:'只儲存講稿',exact:true}).click();
      await expect(card.getByText('尚未生成',{exact:true})).toBeVisible();
      await card.getByRole('button',{name:'生成此 MP3',exact:true}).click();
    }else await editor.getByRole('button',{name:'儲存並只生成這段',exact:true}).click();
    await expect(editor).not.toBeVisible();
    await expect(card.getByText('只套用於本工作',{exact:true})).toBeVisible();
    await expect(card.locator('audio')).toBeVisible();
    const edited=(await(await page.request.get(`/api/requests/${request.id}/voice-preview`)).json()).languages[0].required;
    expect(edited.find(x=>x.purpose===selected.purpose).customized).toBe(true);
    expect(edited.find(x=>x.purpose===selected.purpose).asset_id).not.toBe(selected.asset_id);
    for(const other of view.languages[0].required.filter(x=>x.purpose!==selected.purpose))expect(edited.find(x=>x.purpose===other.purpose).asset_id).toBe(other.asset_id);
    await card.getByRole('button',{name:'恢復預設講稿',exact:true}).click();
    await expect(card.getByText('只套用於本工作',{exact:true})).toHaveCount(0);
    const restored=(await(await page.request.get(`/api/requests/${request.id}/voice-preview`)).json()).languages[0].required.find(x=>x.purpose===selected.purpose);
    expect(restored.asset_id).toBe(selected.asset_id);expect(restored.customized).toBe(false);
    await page.screenshot({path:`/private/tmp/workforce-local-tts/${language}-request.png`,fullPage:true});
  });
}
