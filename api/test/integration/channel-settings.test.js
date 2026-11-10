import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/security.js";
import { resetTestData } from "../test-db.js";
let impl = {};
try {
  impl = await import("../../src/channel-settings.js");
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test DB required");
const pool = createPool(url.toString());
let settings, server, base, token;
before(() => migrate(pool));
after(() => pool.end());
beforeEach(async () => {
  await resetTestData(pool);
  for (const role of ["admin", "site_manager"])
    await pool.query(
      "INSERT INTO users(email,name,role,password_hash) VALUES($1,$1,$2,$3)",
      [
        role + "@settings.test",
        role,
        await hashPassword("Local-test-password-123"),
      ],
    );
});
afterEach(async () => {
  if (server) {
    await new Promise((r) => server.close(r));
    server = null;
  }
});
async function setup(options = {}) {
  assert.equal(typeof impl.createChannelSettings, "function");
  await pool.query(
    "TRUNCATE messaging_settings_active,messaging_settings_versions CASCADE",
  );
  settings = impl.createChannelSettings({ pool, key: Buffer.alloc(32, 1), ...options });
  server = createApp({ pool, settings }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  await login("admin");
}
async function login(role) {
  token = (
    await api("POST", "/api/auth/login", {
      email: role + "@settings.test",
      password: "Local-test-password-123",
    })
  ).body.token;
}
async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
}
async function save(patch = {}) {
  const current = await settings.current();
  const config = structuredClone(current.config);
  Object.assign(config.voice, patch.voice ?? {});
  Object.assign(config.whatsapp, patch.whatsapp ?? {});
  return api("PATCH", "/api/settings/channels", {
    expectedVersion: current.id,
    config,
  });
}

test("Channel settings are admin-only and include Cantonese Mandarin English configuration", async () => {
  await setup();
  const r = await api("GET", "/api/settings/channels");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.config.templates).sort(), [
    "en",
    "yue",
    "zh",
  ]);
  await login("site_manager");
  assert.equal((await api("GET", "/api/settings/channels")).status, 403);
  assert.equal((await api("PATCH", "/api/settings/channels", {})).status, 403);
});
test("Channel credentials are encrypted and never appear in API or audit; omitted replacement preserves them", async () => {
  await setup();
  const r = await save({
    voice: { authToken: "test-private-twilio-token" },
    whatsapp: { key: "test-private-wa-key" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.config.voice.authTokenConfigured, true);
  assert.equal(r.body.config.whatsapp.keyConfigured, true);
  assert.ok(!JSON.stringify(r.body).includes("test-private-"));
  const rows = (await pool.query("SELECT * FROM messaging_settings_versions"))
    .rows;
  assert.ok(!JSON.stringify(rows).includes("test-private-"));
  assert.ok(
    !JSON.stringify(
      (await pool.query("SELECT * FROM audit_log")).rows,
    ).includes("test-private-"),
  );
  const current = await settings.current(),
    redacted = (await api("GET", "/api/settings/channels")).body;
  delete redacted.config.voice.authTokenConfigured;
  delete redacted.config.whatsapp.keyConfigured;
  const second = await api("PATCH", "/api/settings/channels", {
    expectedVersion: current.id,
    config: redacted.config,
  });
  assert.equal(second.status, 200);
  assert.equal(
    (await settings.current()).config.whatsapp.key,
    "test-private-wa-key",
  );
  assert.equal(
    (await settings.get(current.id)).config.voice.authToken,
    "test-private-twilio-token",
  );
});
test("Channel settings reject stale edits and enabling an incomplete real provider without changing active version", async () => {
  await setup();
  const old = await settings.current();
  assert.equal(
    (await save({ voice: { fromNumber: "+15005550006" } })).status,
    200,
  );
  const stale = await api("PATCH", "/api/settings/channels", {
    expectedVersion: old.id,
    config: old.config,
  });
  assert.equal(stale.status, 409);
  const before = (await settings.current()).id;
  assert.equal((await save({ voice: { mode: "twilio-pstn" } })).status, 400);
  assert.equal((await settings.current()).id, before);
  assert.equal((await save({ whatsapp: { mode: "service" } })).status, 400);
});
const wave = Buffer.from(
  "524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000",
  "hex",
).toString("base64");
const audioBody = {
  name: "粵語提示",
  language: "yue",
  content_type: "audio/wav",
  data: wave,
};
test("Audio upload rejects non-audio and admin uploads can be privately previewed or publicly played by opaque token", async () => {
  await setup();
  assert.equal(
    (
      await api("POST", "/api/settings/voice-assets", {
        ...audioBody,
        data: Buffer.from("<html>unsafe</html>").toString("base64"),
      })
    ).status,
    400,
  );
  const r = await api("POST", "/api/settings/voice-assets", audioBody);
  assert.equal(r.status, 201);
  assert.equal(r.body.language, "yue");
  assert.ok(!JSON.stringify(r.body).includes(wave));
  const privateAudio = await fetch(
    base + `/api/settings/voice-assets/${r.body.id}/content`,
    { headers: { authorization: "Bearer " + token } },
  );
  assert.equal(privateAudio.status, 200);
  assert.equal(privateAudio.headers.get("content-type"), "audio/wav");
  assert.deepEqual(
    Buffer.from(await privateAudio.arrayBuffer()),
    Buffer.from(wave, "base64"),
  );
  const publicAudio = await fetch(base + r.body.playback_path);
  assert.equal(publicAudio.status, 200);
  assert.equal(
    (await fetch(base + "/media/voice/" + "0".repeat(64))).status,
    404,
  );
  await login("site_manager");
  assert.equal((await api("GET", "/api/settings/voice-assets")).status, 403);
  assert.equal(
    (await api("POST", "/api/settings/voice-assets", audioBody)).status,
    403,
  );
});
test("Request audio binding is scoped to its site and draft, preserves English Mandarin Cantonese options", async () => {
  await setup();
  const site = (
    await api("POST", "/api/sites", {
      code: "AUDIO",
      name: "Audio Site",
      timezone: "Asia/Hong_Kong",
    })
  ).body;
  const request = (
    await api("POST", "/api/requests", {
      site_id: site.id,
      mode: "broadcast",
      headcount: 1,
      channels: ["voice"],
      start_at: "2099-11-10T00:00:00Z",
      end_at: "2099-11-10T08:00:00Z",
    })
  ).body;
  const result = await api("POST", `/api/requests/${request.id}/voice-audio`, {
    ...audioBody,
    purpose: "offer",
  });
  assert.equal(result.status, 201);
  const bindings = await api("GET", `/api/requests/${request.id}/voice-audio`);
  assert.equal(bindings.status, 200);
  assert.equal(bindings.body.items[0].language, "yue");
  await api("POST", `/api/requests/${request.id}/cancel`, {});
  assert.equal(
    (
      await api("POST", `/api/requests/${request.id}/voice-audio`, {
        ...audioBody,
        purpose: "offer",
      })
    ).status,
    409,
  );
  await login("site_manager");
  assert.equal(
    (await api("GET", `/api/requests/${request.id}/voice-audio`)).status,
    404,
  );
});
test("WhatsApp template management requires admin configured service and never emits a message send", async () => {
  await setup();
  const r = await api("GET", "/api/settings/whatsapp/templates?language=zh_HK");
  assert.equal(r.status, 503);
  await login("site_manager");
  assert.equal(
    (await api("GET", "/api/settings/whatsapp/templates")).status,
    403,
  );
});
let runtime, providerCalls;
async function setupRuntime(options = {}) {
  await setup(options);
  const mod = await import("../../src/channel-runtime.js").catch((e) => {
    if (e.code === "ERR_MODULE_NOT_FOUND") return {};
    throw e;
  });
  assert.equal(typeof mod.createChannelRuntime, "function");
  providerCalls = [];
  const records = new Map();
  const calls = (sid) => ({
    fetch: async () => records.get(sid) ?? { sid, status: "queued" },
    update: async (input) => {
      const row = { sid, status: input.status };
      records.set(sid, row);
      return row;
    },
  });
  calls.create = async (input) => {
    providerCalls.push(input);
    const row = {
      sid: "CA" + providerCalls.length.toString(16).padStart(32, "0"),
      status: "queued",
    };
    records.set(row.sid, row);
    return row;
  };
  runtime = mod.createChannelRuntime({
    pool,
    settings,
    pstnClientFactory: () => ({ calls }),
  });
  await new Promise((r) => server.close(r));
  server = createApp({ pool, settings, runtime, pstn: runtime.pstn }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
}
async function voiceRequest(language = "en", channels = ["voice"]) {
  const code = "R" + Math.random().toString(36).slice(2, 9);
  const site = (
    await api("POST", "/api/sites", {
      code,
      name: code,
      timezone: "Asia/Hong_Kong",
    })
  ).body;
  const staffResponse = await api("POST", "/api/staff", {
    name: "Voice " + language,
    mobile:
      "+659" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0"),
    language,
    ...(channels.includes("whatsapp")
      ? { whatsapp_opt_in: true, whatsapp_opt_in_source: "test" }
      : {}),
  });
  assert.equal(staffResponse.status, 201);
  const staff = staffResponse.body;
  await api("POST", `/api/sites/${site.id}/staff`, { staff_ids: [staff.id] });
  const r = await api("POST", "/api/requests", {
    site_id: site.id,
    mode: "direct",
    staff_id: staff.id,
    headcount: 1,
    channels,
    start_at: "2099-11-10T00:00:00Z",
    end_at: "2099-11-10T08:00:00Z",
  });
  assert.equal(r.status, 201);
  return { request: r.body, staff };
}
const liveVoice = {
  mode: "twilio-pstn",
  accountSid: "AC" + "1".repeat(32),
  authToken: "private-token-A",
  fromNumber: "+15005550006",
  publicBaseUrl: "https://voice.example.test",
};
const encodedMp3 = Buffer.concat(Array.from({length:2},()=>{const frame=Buffer.alloc(417);Buffer.from([0xff,0xfb,0x90,0x00]).copy(frame);return frame;}));
async function azureMode() {
  const current=await settings.current();
  assert.ok(current.config.voiceSynthesis,'Azure settings are required');
  current.config.voiceClips.mode='azure-mp3';
  Object.assign(current.config.voiceSynthesis,{region:'eastasia',key:'private-azure-test-key'});
  return settings.save({role:'admin',id:null},{expectedVersion:current.id,config:current.config});
}
async function generate(id,item,extra={}) {
  return api('POST',`/api/requests/${id}/voice-synthesis`,{language:item.language,purpose:item.purpose,expectedHash:item.hash,...extra});
}
async function localMode(speed=1) {
  const current=await settings.current();
  current.config.voiceClips.mode='local-mp3';
  current.config.localSpeech={speed};
  const saved=await api('PATCH','/api/settings/channels',{expectedVersion:current.id,config:current.config});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  return saved.body;
}
test('English spoken Site fields persist and independent audition does not change staff language',async()=>{
  await setupRuntime({localClientFactory:installedLocal(async()=>encodedMp3)});await localMode();const {request,staff}=await voiceRequest('yue');
  const updated=await api('PATCH',`/api/sites/${request.site_id}`,{name:'九龍灣辦公室',address:'香港九龍永康街9號',voice_name_en:'Tech Nine',voice_address_en:'9 Wing Hong Street, Kowloon'});
  assert.equal(updated.status,200);assert.equal(updated.body.voice_name_en,'Tech Nine');
  const preserved=await api('PATCH',`/api/sites/${request.site_id}`,{address:'香港九龍永康街9號28/F'});assert.equal(preserved.body.voice_address_en,'9 Wing Hong Street, Kowloon');
  const view=(await api('GET',`/api/requests/${request.id}/voice-preview?language=en`)).body;
  assert.deepEqual(view.requiredLanguages,['yue']);const english=view.languages.find(p=>p.language==='en');assert.ok(english);assert.equal(english.previewOnly,true);assert.match(english.required[0].script,/Tech Nine/);assert.deepEqual(english.required[0].issues,[]);
  const generated=await generate(request.id,english.required[0],{previewOnly:true});assert.equal(generated.status,200,JSON.stringify(generated.body));
  assert.equal((await pool.query('SELECT language FROM staff WHERE id=$1',[staff.id])).rows[0].language,'yue');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM attempts WHERE request_id=$1',[request.id])).rows[0].n,0);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,409,'English audition must not satisfy required Cantonese dispatch');
});
test('English audition explains missing spoken address before calling the local engine',async()=>{
  let calls=0;await setupRuntime({localClientFactory:installedLocal(async()=>{calls++;return encodedMp3;})});await localMode();const {request}=await voiceRequest('yue');
  await api('PATCH',`/api/sites/${request.site_id}`,{name:'tech nine',address:'香港九龍永康街9號'});
  const view=(await api('GET',`/api/requests/${request.id}/voice-preview?language=en`)).body;const plan=view.languages.find(p=>p.language==='en');assert.ok(plan);
  assert.match(plan.required[0].issues.join(''),/英文朗讀地址/);assert.equal(plan.required[0].state,'blocked');
  assert.equal((await generate(request.id,plan.required[0],{previewOnly:true})).status,409);assert.equal(calls,0);
});
const installedLocal = synthesize => () => ({status:async()=>({installed:true,languages:['yue','en']}),synthesize});
async function editVoiceText(id,item,parts,extra={}) {
  return api('PATCH',`/api/requests/${id}/voice-text`,{language:item.language,purpose:item.purpose,expectedHash:item.hash,expectedTextRevision:item.textRevision??null,parts,...extra});
}
test('Draft users edit and regenerate one purpose, keep other MP3 and restore the cached default',async()=>{
  let calls=0;await setupRuntime({localClientFactory:installedLocal(async()=>{calls++;return encodedMp3;})});await localMode();
  const {request}=await voiceRequest('yue');
  let items=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required;
  for(const item of items)assert.equal((await generate(request.id,item)).status,200);
  items=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required;
  const original=items[0];assert.ok(Array.isArray(original.parts),'Draft cards need editable fixed wording');
  const parts=[...original.parts];parts[1]='，你好，請留意以下工作邀請。地點係';
  const changed=await editVoiceText(request.id,original,parts);assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.match(changed.body.script,/請留意以下工作邀請/);assert.match(changed.body.script,/接受請按1/);assert.equal(calls,6);
  let current=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0];
  assert.equal(current.missing.length,1);assert.equal(current.required[0].customized,true);
  for(const other of items.slice(1))assert.equal(current.required.find(x=>x.purpose===other.purpose).asset_id,other.asset_id);
  assert.equal((await generate(request.id,current.required[0])).status,200);assert.equal(calls,7);
  current=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0];
  assert.equal(current.missing.length,0);
  assert.equal((await editVoiceText(request.id,current.required[0],null)).status,200);
  const restored=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  assert.equal(restored.hash,original.hash);assert.equal(restored.asset_id,original.asset_id);assert.equal(restored.customized,false);assert.equal(calls,7);
});
test('Editing a shared ending is isolated to its work and stores a Site-scoped recording',async()=>{
  await setupRuntime({localClientFactory:installedLocal(async()=>encodedMp3)});await localMode();
  const first=await voiceRequest('yue'), second=await voiceRequest('yue');
  const view=async id=>(await api('GET',`/api/requests/${id}/voice-preview`)).body.languages[0].required;
  const ack=(await view(first.request.id)).find(x=>x.purpose==='ack');assert.equal((await generate(first.request.id,ack)).status,200);
  const edited=await editVoiceText(first.request.id,ack,['已收到，多謝你。']);assert.equal(edited.status,200);
  const custom=(await view(first.request.id)).find(x=>x.purpose==='ack');assert.equal(custom.shared,false);assert.notEqual(custom.hash,ack.hash);
  const made=await generate(first.request.id,custom);assert.equal(made.status,200);
  const asset=(await pool.query('SELECT request_id,site_id FROM voice_assets WHERE id=$1',[made.body.asset_id])).rows[0];
  assert.equal(asset.request_id,first.request.id);assert.equal(asset.site_id,first.request.site_id);
  const other=(await view(second.request.id)).find(x=>x.purpose==='ack');assert.equal(other.hash,ack.hash);assert.equal(other.state,'ready');assert.equal(other.customized,false);
});
test('Draft text edits reject malformed parts, stale revisions and unauthorized Site access',async()=>{
  await setupRuntime({localClientFactory:installedLocal(async()=>encodedMp3)});await localMode();const {request}=await voiceRequest('en');
  const item=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];assert.ok(item.parts);
  for(const bad of [[],['incomplete'],item.parts.map(()=>''),item.parts.map(()=> 'a'.repeat(401))])assert.equal((await editVoiceText(request.id,item,bad)).status,400);
  const parts=[...item.parts];parts[1]='. Please consider this work at ';
  const saved=await editVoiceText(request.id,item,parts);assert.equal(saved.status,200);
  assert.equal((await editVoiceText(request.id,item,item.parts)).status,409);
  const current=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  await pool.query("UPDATE sites SET address='Changed Road' WHERE id=$1",[request.site_id]);
  assert.equal((await editVoiceText(request.id,current,parts)).status,409);
  await login('site_manager');assert.equal((await editVoiceText(request.id,current,parts)).status,404);
});
test('In-flight old generation cannot satisfy an edited script and published work refuses further edits',async()=>{
  let started,release;const begun=new Promise(r=>started=r);let calls=0;
  await setupRuntime({localClientFactory:installedLocal(async()=>{if(++calls===1){started();return new Promise(r=>release=r);}return encodedMp3;})});await localMode();const {request}=await voiceRequest('yue');
  const original=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];assert.ok(original.parts);
  const pending=generate(request.id,original);await begun;
  const parts=[...original.parts];parts[1]='，你好。現有一份工作，地點係';
  assert.equal((await editVoiceText(request.id,original,parts)).status,200);
  release(encodedMp3);assert.equal((await pending).status,200);
  let plan=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0];
  assert.notEqual(plan.required[0].hash,original.hash);assert.equal(plan.required[0].state,'missing');
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,409);
  for(const item of plan.required)assert.equal((await generate(request.id,item)).status,200);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,200);
  plan=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0];
  assert.equal((await editVoiceText(request.id,plan.required[0],original.parts)).status,409);
});
test('Local MP3 mode generates Cantonese and English without Azure, reuses files, and invalidates changed speed/content',async()=>{
  let generated=0;
  await setupRuntime({localClientFactory:installedLocal(async()=>{generated++;return encodedMp3;}),azureClientFactory:()=>({synthesize:async()=>{throw Error('Azure must not run');}})});
  await localMode();
  for(const language of ['yue','en']){
    const {request}=await voiceRequest(language);
    const preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
    assert.equal(preview.mode,'local-mp3');assert.equal(preview.configured,true);
    const item=preview.languages[0].required[0];
    const first=await generate(request.id,item);assert.equal(first.status,200);assert.equal(first.body.state,'ready');
    const again=await generate(request.id,item);assert.equal(again.body.asset_id,first.body.asset_id);
    const content=await fetch(base+first.body.playback_path);assert.match(content.headers.get('content-type'),/audio\/mpeg/);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()),encodedMp3);
    const stale=structuredClone(item);
    await pool.query("UPDATE sites SET address='changed' WHERE id=$1",[request.site_id]);
    assert.equal((await generate(request.id,stale)).status,409);
    assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,409);
  }
  assert.equal(generated,2);
  const {request}=await voiceRequest('yue');
  const old=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  await localMode(0.9);
  const changed=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  assert.notEqual(changed.hash,old.hash);assert.equal((await generate(request.id,old)).status,409);
  const view=(await api('GET','/api/settings/channels')).body;
  assert.equal(view.localSpeechStatus.installed,true);delete view.config.localSpeech;
  delete view.config.voice.authTokenConfigured;delete view.config.whatsapp.keyConfigured;
  assert.equal((await api('PATCH','/api/settings/channels',{expectedVersion:view.id,config:view.config})).status,200);
  assert.equal((await settings.current()).config.localSpeech.speed,0.9);
});
test('Local mode blocks unsupported languages and incomplete installation without falling back to paid speech',async()=>{
  let generated=0;
  await setupRuntime({localClientFactory:installedLocal(async()=>{generated++;return encodedMp3;})});await localMode();
  const {request}=await voiceRequest('zh');
  const preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.equal(preview.languages[0].required.length,0);assert.equal(preview.languages[0].missing[0].key,'language');
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,409);assert.equal(generated,0);
});
test('Local generation failure is retryable and has no Azure billing warnings',async()=>{
  let count=0;
  await setupRuntime({localClientFactory:installedLocal(async()=>{if(++count===1)throw Error('private process details');return encodedMp3;})});
  await localMode();const {request}=await voiceRequest('yue');
  const item=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  const failed=await generate(request.id,item);assert.equal(failed.status,422);assert.equal(failed.body.state,'failed');
  assert.doesNotMatch(JSON.stringify(failed.body),/private process|Azure|收費|額度/);
  assert.equal((await generate(request.id,item)).status,200);assert.equal(count,2);
});
test('Local full MP3 and DTMF use pinned Play after settings change; shared prompts are reused across works',async()=>{
  let count=0;
  await setupRuntime({localClientFactory:installedLocal(async()=>{count++;return encodedMp3;})});
  await save({voice:liveVoice});await localMode();const {request,staff}=await voiceRequest('yue');
  const preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  for(const item of preview.languages[0].required)assert.equal((await generate(request.id,item)).status,200);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,200);
  const next=await settings.current();next.config.voiceClips.mode='say';
  await settings.save({role:'admin',id:null},{expectedVersion:next.id,config:next.config});
  const {runJobs}=await import('../../src/messaging.js');await runJobs(pool,()=>new Date(),{pstn:runtime.pstn,whatsapp:runtime.whatsapp});
  const attempt=(await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",[request.id])).rows[0];
  const xml=await(await signedVoice(attempt,staff,liveVoice.authToken)).text();
  assert.match(xml,/<Play>/);assert.doesNotMatch(xml,/<Say/);
  assert.match(await(await signedVoice(attempt,staff,liveVoice.authToken,'9')).text(),/<Play>/);
  assert.match(await(await signedVoice(attempt,staff,liveVoice.authToken,'1')).text(),/<Play>/);
  assert.equal(count,6);
  await localMode();const fresh=await voiceRequest('yue');
  const required=(await api('GET',`/api/requests/${fresh.request.id}/voice-preview`)).body.languages[0].required;
  assert.equal(required.filter(x=>x.state==='ready').length,3);
});
test('Real local models persist playable English and Cantonese MP3 and dispatch pinned Play', {skip:process.env.LOCAL_TTS_SMOKE!=='1'}, async()=>{
  const {writeFile,mkdir}=await import('node:fs/promises');
  const {validMp3}=await import('../../src/audio-validation.js');
  await setupRuntime();await save({voice:liveVoice});await localMode();
  await mkdir('/private/tmp/workforce-local-tts/api-smoke',{recursive:true});
  for(const language of ['yue','en']){
    const {request,staff}=await voiceRequest(language);
    await pool.query('UPDATE sites SET name=$2,address=$3 WHERE id=$1',[request.site_id,language==='yue'?'九龍灣辦公室':'Kowloon Bay Office','']);
    const preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
    assert.equal(preview.configured,true);
    for(const item of preview.languages[0].required){
      const made=await generate(request.id,item);assert.equal(made.status,200,JSON.stringify(made.body));
      const response=await fetch(base+made.body.playback_path);const bytes=Buffer.from(await response.arrayBuffer());
      assert.match(response.headers.get('content-type'),/audio\/mpeg/);assert.equal(validMp3(bytes),true);
      await writeFile(`/private/tmp/workforce-local-tts/api-smoke/${language}-${item.purpose}.mp3`,bytes);
      const cached=await generate(request.id,item);assert.equal(cached.body.asset_id,made.body.asset_id);
    }
    assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,200);
    const {runJobs}=await import('../../src/messaging.js');await runJobs(pool,()=>new Date(),{pstn:runtime.pstn,whatsapp:runtime.whatsapp});
    const attempt=(await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",[request.id])).rows[0];
    const xml=await(await signedVoice(attempt,staff,liveVoice.authToken)).text();
    assert.match(xml,/<Play>/);assert.doesNotMatch(xml,/<Say/);
  }
});
test('Azure settings redact and preserve Key, validate region and voice language, and old clients do not erase Azure config',async()=>{
  await setup();await azureMode();
  let view=(await api('GET','/api/settings/channels')).body;
  assert.equal(view.config.voiceSynthesis.key,undefined);assert.equal(view.config.voiceSynthesis.keyConfigured,true);
  assert.ok(!JSON.stringify((await pool.query('SELECT * FROM audit_log')).rows).includes('private-azure-test-key'));
  delete view.config.voice.authTokenConfigured;delete view.config.whatsapp.keyConfigured;delete view.config.voiceSynthesis;
  assert.equal((await api('PATCH','/api/settings/channels',{expectedVersion:view.id,config:view.config})).status,200);
  assert.equal((await settings.current()).config.voiceSynthesis.key,'private-azure-test-key');
  for(const change of [c=>c.voiceSynthesis.region='eastasia.evil/path',c=>c.voiceSynthesis.voices.yue='en-GB-SoniaNeural']){
    const current=await settings.current();change(current.config);
    assert.equal((await api('PATCH','/api/settings/channels',{expectedVersion:current.id,config:current.config})).status,400);
  }
});
test('Azure generation reserves each hash once across concurrent requests and returns the same cached full MP3 after key/region replacement',async()=>{
  let release,started,paid=0;
  const begun=new Promise(r=>started=r);
  await setupRuntime({azureClientFactory:()=>({synthesize:async()=>{paid++;started();return new Promise(r=>release=r);}})});
  await azureMode();const {request}=await voiceRequest('en');
  const preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.equal(preview.mode,'azure-mp3');
  const item=preview.languages[0].required.find(x=>x.purpose==='offer');
  assert.equal(item.state,'missing');assert.match(item.script,/Hello there/);
  const first=generate(request.id,item);await begun;
  const second=await generate(request.id,item);assert.equal(second.status,202);assert.equal(paid,1);
  const switched=await settings.current();switched.config.voiceSynthesis.key='company-test-key';switched.config.voiceSynthesis.region='southeastasia';
  await settings.save({role:'admin',id:null},{expectedVersion:switched.id,config:switched.config});
  release(encodedMp3);const done=await first;assert.equal(done.status,200);assert.equal(done.body.state,'ready');
  const again=await generate(request.id,item);assert.equal(again.body.asset_id,done.body.asset_id);assert.equal(paid,1);
  const changed=await settings.current();changed.config.voiceSynthesis.key='company-test-key';changed.config.voiceSynthesis.region='southeastasia';
  await settings.save({role:'admin',id:null},{expectedVersion:changed.id,config:changed.config});
  const same=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required.find(x=>x.purpose==='offer');
  assert.equal(same.hash,item.hash);assert.equal(same.asset_id,done.body.asset_id);
  assert.equal((await generate(request.id,same)).status,200);assert.equal(paid,1);
  assert.equal((await fetch(base+done.body.playback_path)).status,200);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,409);
});
test('Azure completion does not hold synthesis lock while waiting for a concurrent draft command',async()=>{
  let release,started;const begun=new Promise(r=>started=r);
  await setupRuntime({azureClientFactory:()=>({synthesize:async()=>{started();return new Promise(r=>release=r);}})});
  await azureMode();const {request}=await voiceRequest('en');
  const item=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  const first=generate(request.id,item);await begun;
  const blocker=await pool.connect();
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM requests WHERE id=$1 FOR UPDATE',[request.id]);
    release(encodedMp3);
    let waiting=false;
    for(let i=0;i<100;i++){
      const result=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE 'INSERT INTO voice_assets%' OR query LIKE 'SELECT id FROM requests%')");
      if(result.rowCount){waiting=true;break;}
      await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(waiting,true,'Synthesis completion should reach the held request lock');
    await assert.doesNotReject(blocker.query('SELECT hash FROM voice_syntheses WHERE hash=$1 FOR UPDATE NOWAIT',[item.hash]),'Completion must acquire the request lock before the synthesis lock');
  } finally {await blocker.query('ROLLBACK');blocker.release();}
  assert.equal((await first).status,200);
});
test('Azure generation rejects stale scripts and unauthorized Site access without calling the provider',async()=>{
  let paid=0;await setupRuntime({azureClientFactory:()=>({synthesize:async()=>{paid++;return encodedMp3;}})});
  await azureMode();const {request}=await voiceRequest('yue');
  const item=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  await pool.query("UPDATE sites SET address='Changed Road' WHERE id=$1",[request.site_id]);
  assert.equal((await generate(request.id,item)).status,409);assert.equal(paid,0);
  await login('site_manager');
  assert.equal((await api('GET',`/api/requests/${request.id}/voice-preview`)).status,404);
  assert.equal((await generate(request.id,item)).status,404);assert.equal(paid,0);
});
test('Uncertain Azure generation is not automatically resubmitted and explicit retry is versioned',async()=>{
  let paid=0;
  await setupRuntime({azureClientFactory:()=>({synthesize:async()=>{paid++;if(paid===1)throw Object.assign(Error('private-azure-test-key'),{uncertain:true});return encodedMp3;}})});
  await azureMode();const {request}=await voiceRequest('yue');
  const item=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body.languages[0].required[0];
  const failed=await generate(request.id,item);assert.equal(failed.status,409);assert.equal(failed.body.state,'unknown');
  assert.ok(!JSON.stringify(failed.body).includes('private-azure-test-key'));
  assert.equal((await generate(request.id,item)).status,409);assert.equal(paid,1);
  assert.equal((await generate(request.id,item,{retryGeneration:failed.body.generation-1})).status,400);
  assert.equal((await generate(request.id,item,{retryGeneration:failed.body.generation})).status,200);assert.equal(paid,2);
  assert.equal((await generate(request.id,item,{retryGeneration:failed.body.generation})).status,200);assert.equal(paid,2);
});
test('Azure full-file playback is pinned before dispatch and common endings are generated once across works',async()=>{
  let paid=0;
  await setupRuntime({azureClientFactory:()=>({synthesize:async()=>{paid++;return encodedMp3;}})});
  await save({voice:liveVoice});await azureMode();
  const {request,staff}=await voiceRequest('en');
  const preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  for(const item of preview.languages[0].required)assert.equal((await generate(request.id,item)).status,200);
  assert.equal(paid,6);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,200);
  const next=await settings.current();next.config.voiceClips.mode='say';
  await settings.save({role:'admin',id:null},{expectedVersion:next.id,config:next.config});
  const {runJobs}=await import('../../src/messaging.js');
  await runJobs(pool,()=>new Date(),{pstn:runtime.pstn,whatsapp:runtime.whatsapp});
  const attempt=(await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",[request.id])).rows[0];
  const xml=await(await signedVoice(attempt,staff,liveVoice.authToken)).text();
  assert.equal((xml.match(/<Play>/g)||[]).length,1);assert.doesNotMatch(xml,/<Say/);
  assert.match(await(await signedVoice(attempt,staff,liveVoice.authToken,'1')).text(),/<Play>/);
  assert.equal(paid,6);
  await azureMode();const fresh=await voiceRequest('en');
  const pending=(await api('GET',`/api/requests/${fresh.request.id}/voice-preview`)).body.languages[0].required;
  assert.equal(pending.filter(x=>x.state==='ready').length,3);
  for(const item of pending.filter(x=>x.state!=='ready'))assert.equal((await generate(fresh.request.id,item)).status,200);
  assert.equal(paid,9);
});
test("Voice editor exposes defaults for old settings and rejects changed locked layout, blank prompts and excess copy", async () => {
  await setup();
  const view = (await api("GET", "/api/settings/channels")).body;
  assert.ok(view.config.voiceTexts, "Editable text defaults are required");
  assert.deepEqual(view.voiceTextLayout.offer.tokens.map((t) => t.key), ["staff_name", "location", "start", "end", "message", "accept_key", "decline_key", "repeat_key"]);
  for (const change of [
    (c) => c.voiceTexts.yue.offer.pop(),
    (c) => { c.voiceTexts.yue.ack = ["   "]; },
    (c) => { c.voiceTexts.yue.ack = ["字".repeat(401)]; },
    (c) => { c.voiceTexts.yue.extra = ["unknown"]; },
  ]) {
    const config = structuredClone((await settings.current()).config);
    change(config);
    const before = (await settings.current()).id;
    assert.equal((await api("PATCH", "/api/settings/channels", { expectedVersion: before, config })).status, 400);
    assert.equal((await settings.current()).id, before);
  }
});
test("Saved fixed copy is pinned before worker submission and inherited by confirmations; new requests use new copy", async () => {
  await setupRuntime();
  await save({ voice: liveVoice });
  const first = await settings.current();
  assert.ok(first.config.voiceTexts, "Editable text defaults are required");
  first.config.voiceTexts.yue.offer[1] = "，A版工作邀請，地點係";
  first.config.voiceTexts.yue.confirmation[1] = "，A版接單確認，地點係";
  first.config.voiceTexts.yue.ack[0] = "A版已收到 <Hangup/>。";
  const aVersion = await settings.save({ role: "admin", id: null }, { expectedVersion: first.id, config: first.config });
  const { request, staff } = await voiceRequest("yue");
  assert.equal((await api("POST", `/api/requests/${request.id}/send`, {})).status, 200);
  const next = await settings.current();
  next.config.voiceTexts.yue.offer[1] = "，B版工作邀請，地點係";
  next.config.voiceTexts.yue.confirmation[1] = "，B版接單確認，地點係";
  await settings.save({ role: "admin", id: null }, { expectedVersion: next.id, config: next.config });
  const { runJobs } = await import("../../src/messaging.js");
  const run = () => runJobs(pool, () => new Date(), { pstn: runtime.pstn, whatsapp: runtime.whatsapp });
  await run();
  const offer = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'", [request.id])).rows[0];
  assert.equal(offer.settings_version_id, aVersion.id);
  const initial = await signedVoice(offer, staff, liveVoice.authToken);
  const xml = await initial.text();
  assert.match(xml, /A版工作邀請/);
  assert.doesNotMatch(xml, /B版/);
  const ack = await signedVoice(offer, staff, liveVoice.authToken, "1");
  assert.match(await ack.text(), /A版已收到 &lt;Hangup\s*\/&gt;。/);
  await pool.query("UPDATE voice_calls SET state='finished',last_status='completed' WHERE attempt_id=$1", [offer.id]);
  await run();
  const follow = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='confirmation'", [request.id])).rows[0];
  assert.equal(follow.settings_version_id, aVersion.id);
  assert.match(await (await signedVoice(follow, staff, liveVoice.authToken)).text(), /A版接單確認/);
  const fresh = await voiceRequest("yue");
  await api("POST", `/api/requests/${fresh.request.id}/send`, {});
  await run();
  const newer = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'", [fresh.request.id])).rows[0];
  assert.match(await (await signedVoice(newer, fresh.staff, liveVoice.authToken)).text(), /B版工作邀請/);
});
test("Editing fixed words preserves credentials and omitted copy from an older client preserves the saved text", async () => {
  await setup();
  await save({ voice: { authToken: "saved-token" } });
  let current = await settings.current();
  assert.ok(current.config.voiceTexts, "Editable text defaults are required");
  current.config.voiceTexts.yue.no_input[0] = "未收到按鍵，拜拜。";
  const changed = await settings.save({ role: "admin", id: null }, { expectedVersion: current.id, config: current.config });
  const next = (await api("GET", "/api/settings/channels")).body;
  delete next.config.voice.authTokenConfigured;
  delete next.config.whatsapp.keyConfigured;
  delete next.config.voiceTexts;
  assert.equal((await api("PATCH", "/api/settings/channels", { expectedVersion: next.id, config: next.config })).status, 200);
  current = await settings.current();
  assert.equal(current.config.voice.authToken, "saved-token");
  assert.equal(current.config.voiceTexts.yue.no_input[0], "未收到按鍵，拜拜。");
  assert.equal((await settings.get(changed.id)).config.voiceTexts.yue.no_input[0], "未收到按鍵，拜拜。");
});
test("Speech settings reject XML-invalid control characters and lone surrogates before changing the active version", async () => {
  await setup();
  for (const invalid of ["\u000b", "\u0000", "\ud800", "\ufffe"]) {
    const current = await settings.current();
    current.config.voiceTexts.yue.ack[0] = "收到" + invalid;
    const result = await api("PATCH", "/api/settings/channels", { expectedVersion: current.id, config: current.config });
    assert.equal(result.status, 400);
    assert.equal((await settings.current()).id, current.id);
  }
  const valid = await settings.current();
  valid.config.voiceTexts.yue.ack[0] = "收到\n多謝\t你。🙂";
  assert.equal((await api("PATCH", "/api/settings/channels", { expectedVersion: valid.id, config: valid.config })).status, 200);
});
test("Legacy encrypted settings receive speech defaults in memory without rewriting their stored version", async () => {
  await setup();
  const current = await settings.current();
  delete current.config.voiceTexts;
  const encrypted = impl.sealSettings(Buffer.alloc(32, 1), current.config);
  await pool.query("UPDATE messaging_settings_versions SET encrypted_config=$2 WHERE id=$1", [current.id, encrypted]);
  assert.ok((await settings.get(current.id)).config.voiceTexts.yue.offer[1].includes("更次邀請"));
  assert.ok((await api("GET", "/api/settings/channels")).body.config.voiceTexts);
  const saved = (await pool.query("SELECT encrypted_config FROM messaging_settings_versions WHERE id=$1", [current.id])).rows[0];
  assert.equal(impl.openSettings(Buffer.alloc(32, 1), saved.encrypted_config).voiceTexts, undefined);
  assert.equal((await settings.current()).id, current.id);
});
test("Runtime pins queued mock attempts so changing settings cannot turn them into paid calls", async () => {
  await setupRuntime();
  const { request } = await voiceRequest("yue");
  const version = (await settings.current()).id;
  assert.equal(
    (await api("POST", `/api/requests/${request.id}/send`, {})).status,
    200,
  );
  await save({ voice: liveVoice });
  const { runJobs } = await import("../../src/messaging.js");
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(providerCalls.length, 0);
  const a = (
    await pool.query("SELECT * FROM attempts WHERE request_id=$1", [request.id])
  ).rows[0];
  assert.equal(a.settings_version_id, version);
  assert.equal(a.status, "sent");
});
test("Runtime settings revision rejects stale browser writes even when both channel modes stay mock", async () => {
  await setupRuntime();
  const status = (await api("GET", "/api/messaging/status")).body;
  assert.ok(status.configuration_revision);
  await save({ voice: { fromNumber: "+15005550006" } });
  const r = await fetch(base + "/api/sites", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
      "X-Workforce-Messaging-Mode": status.mode,
      "X-Workforce-Settings-Revision": status.configuration_revision,
    },
    body: JSON.stringify({
      code: "STALE-REV",
      name: "Stale",
      timezone: "Asia/Hong_Kong",
    }),
  });
  assert.equal(r.status, 409);
  assert.equal(
    (await pool.query("SELECT count(*) FROM sites WHERE code='STALE-REV'"))
      .rows[0].count,
    "0",
  );
});
test("Runtime sends a real-channel Mandarin request without any recording and returns signed Say TwiML", async () => {
  await setupRuntime();
  await save({ voice: liveVoice });
  const { request, staff } = await voiceRequest("zh");
  const response = await api("POST", `/api/requests/${request.id}/send`, {});
  assert.equal(response.status, 200);
  const { runJobs } = await import("../../src/messaging.js");
  await runJobs(pool, () => new Date(), { pstn: runtime.pstn, whatsapp: runtime.whatsapp });
  assert.equal(providerCalls.length, 1);
  const a = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'", [request.id])).rows[0];
  const reply = await signedVoice(a, staff, liveVoice.authToken);
  assert.equal(reply.status, 200);
  const xml = await reply.text();
  assert.match(xml, /<Say[^>]*voice="Google.cmn-CN-Standard-A"/);
  assert.match(xml, /接受请按1/);
  assert.doesNotMatch(xml, /<Play/);
});
test("Historical submitted audio snapshots and Twilio credentials survive settings rotation", async () => {
  await setupRuntime();
  let current = await settings.current();
  for (const kind of ["ack", "no_input", "unavailable"]) {
    const row = (
      await api("POST", "/api/settings/voice-assets", {
        ...audioBody,
        language: "en",
        name: kind,
      })
    ).body;
    current.config.prompts.en[kind] = row.id;
  }
  Object.assign(current.config.voice, liveVoice);
  await settings.save(
    { role: "admin", id: null },
    { expectedVersion: current.id, config: current.config },
  );
  const { request, staff } = await voiceRequest("en");
  for (const purpose of ["offer", "confirmation", "cancellation"])
    assert.equal(
      (
        await api("POST", `/api/requests/${request.id}/voice-audio`, {
          ...audioBody,
          language: "en",
          purpose,
        })
      ).status,
      201,
    );
  assert.equal(
    (await api("POST", `/api/requests/${request.id}/send`, {})).status,
    200,
  );
  const { runJobs } = await import("../../src/messaging.js");
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(providerCalls.length, 1);
  const a = (
    await pool.query("SELECT * FROM attempts WHERE request_id=$1", [request.id])
  ).rows[0];
  // Model a call already submitted by the previous recording-based implementation.
  const legacyPayload = structuredClone(a.payload);
  legacyPayload.voice = { audio: {
    main: "https://voice.example.test/media/voice/legacy-offer",
    ack: "https://voice.example.test/media/voice/legacy-ack",
    no_input: "https://voice.example.test/media/voice/legacy-no-input",
    unavailable: "https://voice.example.test/media/voice/legacy-unavailable",
  } };
  await pool.query("UPDATE voice_calls SET payload=$2 WHERE attempt_id=$1", [a.id, legacyPayload]);
  await save({
    voice: { authToken: "private-token-B", accountSid: "AC" + "2".repeat(32) },
  });
  const path = `/integrations/twilio/voice/${a.id}/twiml`,
    body = {
      AccountSid: liveVoice.accountSid,
      CallSid: a.external_id,
      From: liveVoice.fromNumber,
      To: staff.mobile,
      CallStatus: "in-progress",
    };
  const twilio = (await import("twilio")).default;
  const signature = twilio.getExpectedTwilioSignature(
    liveVoice.authToken,
    liveVoice.publicBaseUrl + path,
    body,
  );
  const reply = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body: new URLSearchParams(body).toString(),
  });
  assert.equal(reply.status, 200);
  const xml = await reply.text();
  assert.match(xml, /<Play>/);
  assert.doesNotMatch(xml, /<Say/);
});
test("WhatsApp template CRUD uses the configured microservice Bearer key and never calls messages", async () => {
  await setup();
  const { createServer } = await import("node:http"),
    calls = [];
  const remote = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    calls.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      data: raw ? JSON.parse(raw) : null,
    });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.method === "GET"
          ? {
              data: [
                {
                  id: "12345",
                  name: "hr_offer",
                  language: "zh_HK",
                  status: "APPROVED",
                  components: [],
                },
              ],
              nextCursor: null,
            }
          : { id: "12345", ok: true },
      ),
    );
  });
  remote.listen(0, "127.0.0.1");
  await new Promise((r) => remote.once("listening", r));
  try {
    assert.equal(
      (
        await save({
          whatsapp: {
            url: "http://127.0.0.1:" + remote.address().port,
            key: "test-template-key",
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await api("GET", "/api/settings/whatsapp/templates?language=zh_HK"))
        .status,
      200,
    );
    const body = {
      name: "hr_offer",
      language: "zh_HK",
      category: "UTILITY",
      body: "你好 {{1}}",
      examples: ["Anna"],
      offer: true,
    };
    assert.equal(
      (await api("POST", "/api/settings/whatsapp/templates", body)).status,
      201,
    );
    assert.equal(
      (await api("PATCH", "/api/settings/whatsapp/templates/12345", body))
        .status,
      200,
    );
    assert.equal(
      (await api("DELETE", "/api/settings/whatsapp/templates/12345")).status,
      200,
    );
    assert.equal(calls.length, 4);
    assert.ok(
      calls.every(
        (c) =>
          c.authorization === "Bearer test-template-key" &&
          c.path.startsWith("/v1/templates"),
      ),
    );
    assert.equal(calls[1].data.components[1].buttons[0].text, "接受");
  } finally {
    await new Promise((r) => remote.close(r));
  }
});
test("Runtime selects approved English Cantonese Mandarin templates from employee language", async () => {
  await setupRuntime();
  const current = await settings.current();
  Object.assign(current.config.whatsapp, {
    mode: "service",
    url: "http://127.0.0.1:8089",
    key: "local-test-key",
  });
  for (const [language, templates] of Object.entries(current.config.templates))
    for (const [name, value] of Object.entries(templates))
      value.name = language + "_" + name;
  await settings.save(
    { role: "admin", id: null },
    { expectedVersion: current.id, config: current.config },
  );
  let approved = true;
  const sent = [],
    records = new Map(),
    { createChannelRuntime } = await import("../../src/channel-runtime.js");
  const client = {
    async request(method, path, { data, params } = {}) {
      if (path.startsWith("/message-requests/"))
        throw Object.assign(Error("not found"), {
          status: 404,
          retryable: false,
        });
      if (method === "POST") {
        sent.push(data);
        const id = (await import("node:crypto")).randomUUID();
        records.set(id, {
          id,
          direction: "outbound",
          contact_id: data.to,
          content: data,
          meta_id: "wamid." + id,
          submission_status: "accepted",
          delivery_status: "sent",
        });
        return { messageIds: [id] };
      }
      if (path === "/templates") {
        const entry = Object.values(current.config.templates)
          .flatMap((x) => Object.values(x))
          .find((t) => t.name === params.name);
        return {
          data: [
            {
              id: "12345",
              name: entry.name,
              language: entry.language,
              status: approved ? "APPROVED" : "PENDING",
              components: [
                {
                  type: "BODY",
                  text: entry.body
                    .map((_, i) => "{{" + (i + 1) + "}}")
                    .join(" "),
                },
                {
                  type: "BUTTONS",
                  buttons: [
                    { type: "QUICK_REPLY", text: "Yes" },
                    { type: "QUICK_REPLY", text: "No" },
                  ],
                },
              ],
            },
          ],
          nextCursor: null,
        };
      }
      if (path === "/messages") return { data: [], nextCursor: null };
      return records.get(path.slice("/messages/".length));
    },
  };
  runtime = createChannelRuntime({
    pool,
    settings,
    whatsappClientFactory: () => client,
  });
  await new Promise((r) => server.close(r));
  server = createApp({ pool, settings, runtime, pstn: runtime.pstn }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  const { runJobs } = await import("../../src/messaging.js");
  for (const language of ["en", "yue", "zh"]) {
    const { request } = await voiceRequest(language, ["whatsapp"]);
    assert.equal(
      (await api("POST", `/api/requests/${request.id}/send`, {})).status,
      200,
    );
    await runJobs(pool, () => new Date(), {
      pstn: runtime.pstn,
      whatsapp: runtime.whatsapp,
    });
  }
  assert.deepEqual(
    sent.map((x) => x.template.language),
    ["en", "zh_HK", "zh_CN"],
  );
  assert.deepEqual(
    sent.map((x) => x.template.name),
    ["en_shift_offer_v1", "yue_shift_offer_v1", "zh_shift_offer_v1"],
  );
  approved = false;
  const bad = await voiceRequest("en", ["whatsapp"]);
  await api("POST", `/api/requests/${bad.request.id}/send`, {});
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(sent.length, 3);
  assert.equal(
    (
      await pool.query("SELECT status FROM attempts WHERE request_id=$1", [
        bad.request.id,
      ])
    ).rows[0].status,
    "failed",
  );
});
async function recordedRequest({
  language = "en",
  optIn = false,
  onlyOffer = false,
  mode = "direct",
} = {}) {
  await setupRuntime();
  let current = await settings.current();
  for (const kind of ["ack", "no_input", "unavailable"]) {
    const row = (
      await api("POST", "/api/settings/voice-assets", {
        ...audioBody,
        language,
        name: kind,
      })
    ).body;
    current.config.prompts[language][kind] = row.id;
  }
  Object.assign(current.config.voice, liveVoice);
  await settings.save(
    { role: "admin", id: null },
    { expectedVersion: current.id, config: current.config },
  );
  const data = await voiceRequest(language);
  if (mode !== "direct")
    await pool.query("UPDATE requests SET mode=$2 WHERE id=$1", [
      data.request.id,
      mode,
    ]);
  if (optIn)
    await api("PATCH", `/api/staff/${data.staff.id}`, {
      whatsapp_opt_in: true,
      whatsapp_opt_in_source: "test",
    });
  for (const purpose of onlyOffer
    ? ["offer"]
    : ["offer", "confirmation", "cancellation"])
    await api("POST", `/api/requests/${data.request.id}/voice-audio`, {
      ...audioBody,
      language,
      purpose,
    });
  return { ...data, config: current.config };
}
async function signedVoice(attempt, staff, authToken, Digits) {
  const twilio = (await import("twilio")).default,
    path = `/integrations/twilio/voice/${attempt.id}/${Digits === undefined ? "twiml" : "gather"}`,
    body = {
      AccountSid: liveVoice.accountSid,
      CallSid: attempt.external_id,
      From: liveVoice.fromNumber,
      To: staff.mobile,
      CallStatus: "in-progress",
      ...(Digits === undefined ? {} : { Digits }),
    };
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
        authToken,
        liveVoice.publicBaseUrl + path,
        body,
      ),
    },
    body: new URLSearchParams(body).toString(),
  });
}
test('Clips settings persist partial mappings, validate language and reject missing recordings before opening a draft', async () => {
  await setupRuntime();
  const current=await settings.current();
  assert.equal(current.config.voiceClips?.mode,'say');
  current.config.voiceClips.mode='clips';
  assert.equal((await api('PATCH','/api/settings/channels',{expectedVersion:current.id,config:current.config})).status,200);
  const {request}=await voiceRequest('yue');
  const preview=await api('GET',`/api/requests/${request.id}/voice-preview`);
  assert.equal(preview.status,200);
  assert.equal(preview.body.mode,'clips');
  assert.ok(preview.body.languages[0].missing.some(x=>x.key==='hour:8'));
  const send=await api('POST',`/api/requests/${request.id}/send`,{});
  assert.equal(send.status,409);
  assert.equal(send.body.reason,'missing_voice_clips');
  assert.equal((await api('GET',`/api/requests/${request.id}`)).body.status,'draft');
  assert.equal((await pool.query('SELECT count(*) FROM attempts')).rows[0].count,'0');
  const asset=(await api('POST','/api/settings/voice-assets',audioBody)).body;
  const changed=await settings.current();
  changed.config.voiceClips.library.en.ack=asset.id;
  assert.equal((await api('PATCH','/api/settings/channels',{expectedVersion:changed.id,config:changed.config})).status,400);
});
test('MP3 dispatch snapshots every followup, requires message recording, and keeps DTMF after settings and asset archive changes', async () => {
  await setupRuntime();
  await save({voice:liveVoice});
  const {request,staff}=await voiceRequest('yue');
  await pool.query("UPDATE requests SET message='帶證件' WHERE id=$1",[request.id]);
  const catalog=(await api('GET','/api/settings/voice-clips/catalog?language=yue')).body;
  assert.ok(Array.isArray(catalog.items),'Recording catalog required');
  const asset=(await api('POST','/api/settings/voice-assets',audioBody)).body;
  const current=await settings.current();
  assert.ok(current.config.voiceClips,'Clip configuration required');
  current.config.voiceClips.mode='clips';
  for(const item of catalog.items) current.config.voiceClips.library.yue[item.key]=asset.id;
  const saved=await settings.save({role:'admin',id:null},{expectedVersion:current.id,config:current.config});
  let preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.deepEqual(preview.languages[0].missing.map(x=>x.key),['message']);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,409);
  const message=await api('POST',`/api/requests/${request.id}/voice-audio`,{...audioBody,purpose:'message'});
  assert.equal(message.status,201);
  preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.deepEqual(preview.languages[0].missing,[]);
  assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,200);
  assert.equal((await api('POST',`/api/requests/${request.id}/voice-audio`,{...audioBody,purpose:'message'})).status,409);
  const next=await settings.current(); next.config.voiceClips.mode='say';
  await settings.save({role:'admin',id:null},{expectedVersion:next.id,config:next.config});
  await api('DELETE',`/api/settings/voice-assets/${asset.id}`);
  await pool.query("UPDATE sites SET address='new address' WHERE id=$1",[request.site_id]);
  const {runJobs}=await import('../../src/messaging.js');
  const run=()=>runJobs(pool,()=>new Date(),{pstn:runtime.pstn,whatsapp:runtime.whatsapp});
  await run();
  const offer=(await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",[request.id])).rows[0];
  assert.equal(offer.settings_version_id,saved.id);
  const xml=await(await signedVoice(offer,staff,liveVoice.authToken)).text();
  assert.match(xml,/<Gather/); assert.match(xml,/<Play>/); assert.doesNotMatch(xml,/<Say/);
  assert.ok(xml.includes(message.body.playback_path));
  const repeat=await(await signedVoice(offer,staff,liveVoice.authToken,'9')).text();
  assert.equal(repeat,xml);
  const ack=await(await signedVoice(offer,staff,liveVoice.authToken,'1')).text();
  assert.match(ack,/<Play>/); assert.doesNotMatch(ack,/<Say/);
  assert.equal((await pool.query('SELECT final_response FROM candidates WHERE id=$1',[offer.candidate_id])).rows[0].final_response,'accept');
  await pool.query("UPDATE voice_calls SET state='finished',last_status='completed' WHERE attempt_id=$1",[offer.id]);
  await run();
  const confirmation=(await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='confirmation'",[request.id])).rows[0];
  assert.equal(confirmation.settings_version_id,saved.id);
  assert.match(await(await signedVoice(confirmation,staff,liveVoice.authToken)).text(),/<Play>/);
  const pinned=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.equal(pinned.mode,'clips'); assert.deepEqual(pinned.languages[0].missing,[]);
  assert.equal((await fetch(base+asset.playback_path)).status,200);
});
test('Clips preview omits ineligible staff and WhatsApp-only offers only need their voice followup fragments', async () => {
  await setupRuntime();
  const current=await settings.current();
  assert.ok(current.config.voiceClips);
  current.config.voiceClips.mode='clips';
  await settings.save({role:'admin',id:null},{expectedVersion:current.id,config:current.config});
  const {request,staff}=await voiceRequest('yue',['whatsapp']);
  await pool.query("UPDATE requests SET message='written note' WHERE id=$1",[request.id]);
  let preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.ok(!preview.languages[0].required.some(x=>['offer','keys','message'].includes(x.key)));
  await pool.query("UPDATE staff SET status='inactive' WHERE id=$1",[staff.id]);
  preview=(await api('GET',`/api/requests/${request.id}/voice-preview`)).body;
  assert.deepEqual(preview.languages,[]);
});
for(const [language,digit,response] of [['zh','2','decline'],['en','',null]]) {
  test(`Recorded ${language} DTMF ${digit || 'no input'} uses recorded ending and preserves business response`,async()=>{
    await setupRuntime();await save({voice:liveVoice});
    const {request,staff}=await voiceRequest(language);
    const asset=(await api('POST','/api/settings/voice-assets',{...audioBody,language})).body;
    const current=await settings.current();current.config.voiceClips.mode='clips';
    const catalog=(await api('GET',`/api/settings/voice-clips/catalog?language=${language}`)).body;
    for(const item of catalog.items)current.config.voiceClips.library[language][item.key]=asset.id;
    await settings.save({role:'admin',id:null},{expectedVersion:current.id,config:current.config});
    assert.equal((await api('POST',`/api/requests/${request.id}/send`,{})).status,200);
    const {runJobs}=await import('../../src/messaging.js');
    await runJobs(pool,()=>new Date(),{pstn:runtime.pstn,whatsapp:runtime.whatsapp});
    const attempt=(await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",[request.id])).rows[0];
    const reply=await signedVoice(attempt,staff,liveVoice.authToken,digit);
    const xml=await reply.text();assert.match(xml,/<Play>/);assert.doesNotMatch(xml,/<Say/);
    const candidate=(await pool.query('SELECT * FROM candidates WHERE id=$1',[attempt.candidate_id])).rows[0];
    assert.equal(candidate.final_response,response);
    assert.equal((await pool.query('SELECT count(*) FROM assignments WHERE candidate_id=$1',[candidate.id])).rows[0].count,'0');
  });
}
for (const [language, digit, phrase, response] of [
  ["yue", "1", "接受請按1", "accept"],
  ["zh", "2", "接受请按1", "decline"],
  ["en", "", "Press 1 to accept", null],
]) {
  test(`Say ${language} signed DTMF keeps repeat, response and followup behavior without audio`, async () => {
    await setupRuntime();
    await save({ voice: liveVoice });
    const { request, staff } = await voiceRequest(language);
    assert.equal((await api("POST", `/api/requests/${request.id}/send`, {})).status, 200);
    const { runJobs } = await import("../../src/messaging.js");
    const run = () => runJobs(pool, () => new Date(), { pstn: runtime.pstn, whatsapp: runtime.whatsapp });
    await run();
    const attempt = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'", [request.id])).rows[0];
    const first = await signedVoice(attempt, staff, liveVoice.authToken);
    assert.equal(first.status, 200);
    assert.ok((await first.text()).includes(phrase));
    const repeat = await signedVoice(attempt, staff, liveVoice.authToken, "9");
    assert.equal(repeat.status, 200);
    assert.match(await repeat.text(), /<Gather[^>]*input="dtmf"[^>]*>[\s\S]*<Say/);
    assert.equal((await api("GET", `/api/requests/${request.id}`)).body.accepted, 0);
    const reply = await signedVoice(attempt, staff, liveVoice.authToken, digit);
    assert.equal(reply.status, 200);
    const ack = await reply.text();
    assert.match(ack, /<Say/);
    assert.doesNotMatch(ack, /<Gather|<Play/);
    const candidate = (await pool.query("SELECT * FROM candidates WHERE request_id=$1", [request.id])).rows[0];
    assert.equal(candidate.final_response, response);
    if (!response) assert.match(ack, /No key was pressed/);
    if (response === "accept") {
      await api("PATCH", `/api/staff/${staff.id}`, { language: "zh" });
      await pool.query("UPDATE voice_calls SET state='finished',last_status='completed' WHERE attempt_id=$1", [attempt.id]);
      await run();
      const follow = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='confirmation'", [request.id])).rows[0];
      const confirmed = await signedVoice(follow, staff, liveVoice.authToken);
      const xml = await confirmed.text();
      assert.match(xml, /你嘅更次已確認/);
      assert.match(xml, /language="yue-HK"/);
      assert.doesNotMatch(xml, /<Gather|<Play/);
      assert.equal((await api("POST", `/api/requests/${request.id}/cancel`, {})).status, 200);
      await run();
      const cancellation = (await pool.query("SELECT * FROM attempts WHERE request_id=$1 AND purpose='cancellation'", [request.id])).rows[0];
      const cancelled = await signedVoice(cancellation, staff, liveVoice.authToken);
      assert.match(await cancelled.text(), /你嘅更次已取消/);
    }
  });
}
test("Review settings canonicalize padded credentials and trailing-slash origins before activating runtime", async () => {
  await setupRuntime();
  const r = await save({
    voice: {
      ...liveVoice,
      accountSid: " " + liveVoice.accountSid + " ",
      authToken: " " + liveVoice.authToken + " ",
      fromNumber: " " + liveVoice.fromNumber + " ",
      publicBaseUrl: liveVoice.publicBaseUrl + "/",
    },
    whatsapp: { url: " http://127.0.0.1:8089/ ", key: " test-key " },
  });
  assert.equal(r.status, 200);
  const c = (await settings.current()).config;
  assert.equal(c.voice.accountSid, liveVoice.accountSid);
  assert.equal(c.voice.authToken, liveVoice.authToken);
  assert.equal(c.voice.publicBaseUrl, liveVoice.publicBaseUrl);
  assert.equal(c.whatsapp.url, "http://127.0.0.1:8089");
  assert.equal(c.whatsapp.key, "test-key");
  assert.equal((await api("GET", "/api/messaging/status")).status, 200);
});
test("Review same-account credential rotation accepts the new signature for an old call and rejects revoked token", async () => {
  const { request, staff } = await recordedRequest();
  await api("POST", `/api/requests/${request.id}/send`, {});
  const { runJobs } = await import("../../src/messaging.js");
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  const a = (
    await pool.query("SELECT * FROM attempts WHERE request_id=$1", [request.id])
  ).rows[0];
  await save({ voice: { authToken: "rotated-token" } });
  assert.equal((await signedVoice(a, staff, "rotated-token")).status, 200);
  assert.equal((await signedVoice(a, staff, liveVoice.authToken)).status, 401);
});
test("Archived recording references do not gate new Say calls or followups", async () => {
  const { request, staff, config } = await recordedRequest();
  await api("POST", `/api/requests/${request.id}/send`, {});
  await api("DELETE", `/api/settings/voice-assets/${config.prompts.en.ack}`);
  const binding = (
    await api("GET", `/api/requests/${request.id}/voice-audio`)
  ).body.items.find((x) => x.purpose === "confirmation");
  await api("DELETE", `/api/settings/voice-assets/${binding.id}`);
  const { runJobs } = await import("../../src/messaging.js");
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(providerCalls.length, 1);
  const a = (
    await pool.query(
      "SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",
      [request.id],
    )
  ).rows[0];
  assert.equal(
    (await signedVoice(a, staff, liveVoice.authToken, "1")).status,
    200,
  );
  await pool.query(
    "UPDATE voice_calls SET state='finished',last_status='completed' WHERE attempt_id=$1",
    [a.id],
  );
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(providerCalls.length, 2);
});
test("Say dispatch preserves deselection and eligibility checks", async () => {
  const { request } = await recordedRequest({ mode: "broadcast" });
  const candidate = (
    await pool.query("SELECT * FROM candidates WHERE request_id=$1", [
      request.id,
    ])
  ).rows[0];
  const other = (
    await api("POST", "/api/staff", {
      name: "Unselected Cantonese",
      mobile: "+6598765432",
      language: "yue",
    })
  ).body;
  await api("POST", `/api/sites/${request.site_id}/staff`, {
    staff_ids: [other.id],
  });
  assert.equal(
    (
      await api("POST", `/api/requests/${request.id}/candidates`, {
        staff_id: other.id,
      })
    ).status,
    200,
  );
  await pool.query(
    "UPDATE candidates SET selected=false WHERE request_id=$1 AND staff_id=$2",
    [request.id, other.id],
  );
  const unlinked = (
    await api("POST", "/api/staff", {
      name: "Unlinked Mandarin",
      mobile: "+6598765431",
      language: "zh",
    })
  ).body;
  await api("POST", `/api/sites/${request.site_id}/staff`, {
    staff_ids: [unlinked.id],
  });
  assert.equal(
    (
      await api("POST", `/api/requests/${request.id}/candidates`, {
        staff_id: unlinked.id,
      })
    ).status,
    200,
  );
  await pool.query(
    "UPDATE site_staff SET active=false WHERE site_id=$1 AND staff_id=$2",
    [request.site_id, unlinked.id],
  );
  assert.equal(
    (await api("POST", `/api/requests/${request.id}/send`, {})).status,
    200,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM candidates WHERE id=$1", [
        candidate.id,
      ])
    ).rows[0].status,
    "contacting",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT reason FROM candidates WHERE request_id=$1 AND staff_id=$2",
        [request.id, unlinked.id],
      )
    ).rows[0].reason,
    "not_linked",
  );
});
test("Say consent fallback needs no followup recordings and freezes language for an active request", async () => {
  const { request, staff } = await recordedRequest({
    optIn: true,
    onlyOffer: true,
  });
  assert.equal(
    (await api("POST", `/api/requests/${request.id}/send`, {})).status,
    200,
  );
  await api("PATCH", `/api/staff/${staff.id}`, {
    whatsapp_opt_in: false,
    language: "yue",
  });
  const { runJobs } = await import("../../src/messaging.js");
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(providerCalls.length, 1);
  const a = (
    await pool.query(
      "SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer'",
      [request.id],
    )
  ).rows[0];
  assert.equal(
    (await signedVoice(a, staff, liveVoice.authToken, "1")).status,
    200,
  );
  await pool.query(
    "UPDATE voice_calls SET state='finished',last_status='completed' WHERE attempt_id=$1",
    [a.id],
  );
  await runJobs(pool, () => new Date(), {
    pstn: runtime.pstn,
    whatsapp: runtime.whatsapp,
  });
  assert.equal(providerCalls.length, 2);
  const follow = (
    await pool.query(
      "SELECT * FROM attempts WHERE request_id=$1 AND purpose='confirmation'",
      [request.id],
    )
  ).rows[0];
  assert.equal(follow.status, "sent");
  assert.equal(follow.language_snapshot, "en");
  const spoken = await signedVoice(follow, staff, liveVoice.authToken);
  assert.match(await spoken.text(), /Your shift is confirmed/);
});
test("Review settings reject missing archived wrong-language and request-specific prompt references atomically", async () => {
  await setup();
  const global = (await api("POST", "/api/settings/voice-assets", audioBody))
    .body;
  const { request } = await voiceRequest();
  const personal = (
    await api("POST", `/api/requests/${request.id}/voice-audio`, {
      ...audioBody,
      language: "en",
      purpose: "offer",
    })
  ).body;
  await api("DELETE", `/api/settings/voice-assets/${global.id}`);
  const cases = [
    ["en", "11111111-1111-4111-8111-111111111111"],
    ["yue", global.id],
    ["en", personal.id],
  ];
  const wrong = (await api("POST", "/api/settings/voice-assets", audioBody))
    .body;
  cases.push(["en", wrong.id]);
  for (const [language, id] of cases) {
    const c = await settings.current();
    c.config.prompts[language].unavailable = id;
    const r = await api("PATCH", "/api/settings/channels", {
      expectedVersion: c.id,
      config: c.config,
    });
    assert.equal(r.status, 400);
    assert.equal((await settings.current()).id, c.id);
  }
});
test("Review MP3 upload rejects tag-only or truncated files but accepts a complete encoded recording", async () => {
  await setup();
  const { readFile } = await import("node:fs/promises"),
    bytes = await readFile(new URL("../fixtures/silence.mp3", import.meta.url));
  const tag = Buffer.alloc(128);
  tag.write("ID3");
  for (const data of [tag, bytes.subarray(0, bytes.length - 30)])
    assert.equal(
      (
        await api("POST", "/api/settings/voice-assets", {
          ...audioBody,
          content_type: "audio/mpeg",
          data: data.toString("base64"),
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await api("POST", "/api/settings/voice-assets", {
        ...audioBody,
        content_type: "audio/mpeg",
        data: bytes.toString("base64"),
      })
    ).status,
    201,
  );
});
test("Review restart with saved settings ignores obsolete bootstrap provider environment", async () => {
  await setup();
  await settings.current();
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      WORKFORCE_SETTINGS_KEY: Buffer.alloc(32, 1).toString("base64"),
      MESSAGING_MODE: "twilio-pstn",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      WHATSAPP_MODE: "service",
      WHATSAPP_SERVICE_URL: "",
      WHATSAPP_TEMPLATES_FILE: "/missing-legacy-template-file",
      HOST: "127.0.0.1",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  const exit = new Promise((r) => child.once("exit", r));
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    errors += b;
  });
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (output.includes("server.started")) {
            clearInterval(timer);
            resolve();
          } else if (child.exitCode !== null) {
            clearInterval(timer);
            reject(Error(errors));
          }
        }, 20);
        timer.unref();
      }),
      new Promise((_, reject) => {
        const t = setTimeout(
          () => reject(Error("Startup timeout: " + errors)),
          5000,
        );
        t.unref();
      }),
    ]);
  } finally {
    child.kill("SIGTERM");
    await exit;
  }
  assert.match(output, /server.started/);
});
test("Review same-origin WhatsApp key replacement keeps old message polling usable", async () => {
  await setupRuntime();
  const c = await settings.current();
  Object.assign(c.config.whatsapp, {
    mode: "service",
    url: "http://127.0.0.1:8089",
    key: "old-service-key",
  });
  for (const [lang, templates] of Object.entries(c.config.templates))
    for (const [name, t] of Object.entries(templates))
      t.name = lang + "_" + name;
  await settings.save(
    { role: "admin", id: null },
    { expectedVersion: c.id, config: c.config },
  );
  let now = new Date(),
    usableKey = "old-service-key";
  const records = new Map(),
    { createChannelRuntime } = await import("../../src/channel-runtime.js");
  const scoped = createChannelRuntime({
    pool,
    settings,
    clock: () => now,
    whatsappClientFactory: (cfg) => ({
      async request(method, path, { data, params } = {}) {
        if (cfg.key !== usableKey)
          throw Object.assign(Error("unauthorized"), {
            status: 401,
            code: "UNAUTHORIZED",
            retryable: false,
          });
        if (path.startsWith("/message-requests/"))
          throw Object.assign(Error("not found"), {
            status: 404,
            retryable: false,
          });
        if (path === "/templates") {
          const t = c.config.templates.en.shift_offer_v1;
          return {
            data: [
              {
                name: t.name,
                language: "en",
                status: "APPROVED",
                components: [
                  {
                    type: "BODY",
                    text: t.body.map((_, i) => "{{" + (i + 1) + "}}").join(" "),
                  },
                  {
                    type: "BUTTONS",
                    buttons: [{ type: "QUICK_REPLY" }, { type: "QUICK_REPLY" }],
                  },
                ],
              },
            ],
          };
        }
        if (method === "POST") {
          const id = (await import("node:crypto")).randomUUID();
          records.set(id, {
            id,
            direction: "outbound",
            contact_id: data.to,
            meta_id: "wamid." + id,
            submission_status: "accepted",
            delivery_status: "read",
          });
          return { messageIds: [id] };
        }
        if (path === "/messages") return { data: [], nextCursor: null };
        return records.get(path.slice("/messages/".length));
      },
    }),
  });
  const { request } = await voiceRequest("en", ["whatsapp"]);
  await api("POST", `/api/requests/${request.id}/send`, {});
  const { runJobs } = await import("../../src/messaging.js");
  now = new Date(+now + 1000);
  await runJobs(pool, () => now, {
    pstn: scoped.pstn,
    whatsapp: scoped.whatsapp,
  });
  usableKey = "new-service-key";
  await save({ whatsapp: { key: usableKey } });
  now = new Date(+now + 4000);
  await scoped.whatsapp.poll();
  assert.equal(
    (
      await pool.query("SELECT status FROM attempts WHERE request_id=$1", [
        request.id,
      ])
    ).rows[0].status,
    "read",
  );
});


test("Real WhatsApp mode can be saved before templates exist and runtime status stays usable", async () => {
  await setup();
  const result = await save({ whatsapp: { mode: "service", url: "http://whatsapp-api:3000", key: "fixture-early-activation-key" } });
  assert.equal(result.status, 200);
  const active = await settings.current();
  assert.equal(active.config.whatsapp.mode, "service");
  for (const language of ["en", "yue", "zh"])
    assert.ok(Object.values(active.config.templates[language]).every(template => template.name === ""));
  const { createChannelRuntime } = await import("../../src/channel-runtime.js");
  const runtime = createChannelRuntime({ pool, settings });
  const status = await runtime.status();
  assert.equal(status.whatsapp, "service");
  assert.equal(status.mode, "mock+whatsapp-service");
});


test("Early WhatsApp activation still rejects invalid configured reply buttons", async () => {
  await setup();
  const current = await settings.current();
  current.config.whatsapp = { mode: "service", url: "http://whatsapp-api:3000", key: "fixture-activation-validation-key" };
  Object.assign(current.config.templates.en.shift_offer_v1, { name: "invite_job", buttons: { accept: 0, decline: 0 } });
  const result = await api("PATCH", "/api/settings/channels", { expectedVersion: current.id, config: current.config });
  assert.equal(result.status, 400);
  assert.match(JSON.stringify(result.body.errors), /distinct/);
  assert.equal((await settings.current()).id, current.id);
});
