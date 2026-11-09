import { test } from "node:test";
import assert from "node:assert/strict";
import * as content from "../src/voice-content.js";
import { buildPayload } from "../src/messaging.js";
import { voiceTwiml, voiceMessage } from "../src/twilio-pstn.js";

test("Edited Cantonese fixed copy preserves automatic data and DTMF keys as escaped Say text", () => {
  assert.equal(typeof content.defaultVoiceTexts, "function");
  const texts = content.defaultVoiceTexts();
  texts.yue.offer[1] = "，你好。有份工作想邀請你，地點係";
  texts.yue.offer[5] = " 接呢份工請按";
  texts.yue.ack[0] = "收到你嘅回覆，多謝 <Hangup/>。";
  const payload = buildPayload(
    { id: "test", purpose: "offer", channel: "voice" },
    { name: "陳大文", mobile: "+85296644718", language: "yue" },
    { name: "中環", address: "皇后大道中1號", timezone: "Asia/Hong_Kong" },
    { start_at: "2099-11-10T15:30:00Z", end_at: "2099-11-10T17:00:00Z", message: "請帶證件" },
    texts,
  );
  const xml = voiceTwiml(payload, "https://voice.test/gather");
  for (const text of ["陳大文", "有份工作想邀請你", "中環", "皇后大道中1號", "2099年11月10日", "2099年11月11日", "請帶證件", "接呢份工請按1", "拒絕請按2", "重聽請按9"]) assert.ok(xml.includes(text), text);
  assert.match(voiceMessage(payload), /收到你嘅回覆，多謝 &lt;Hangup\s*\/&gt;。/);
  assert.match(xml, /input="dtmf"/);
  assert.match(xml, /voice="Google.yue-HK-Standard-A"/);
});

test("Language and purpose edits have independent defaults", () => {
  assert.equal(typeof content.defaultVoiceTexts, "function");
  const texts = content.defaultVoiceTexts();
  texts.yue.ack[0] = "收到。";
  assert.equal(content.defaultVoiceTexts().yue.ack[0], "已收到你嘅回覆。多謝。");
  assert.equal(texts.zh.ack[0], "已收到您的回复。谢谢。");
  assert.equal(texts.yue.no_input[0], "未收到你嘅按鍵回覆。再見。");
});
