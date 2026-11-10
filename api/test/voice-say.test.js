import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../src/messaging.js";
import { voiceTwiml, voiceMessage } from "../src/twilio-pstn.js";

const site = { name: "中環 & <Centre>", address: "皇后大道中1號", timezone: "Asia/Hong_Kong" };
const request = { start_at: "2099-11-10T15:30:00Z", end_at: "2099-11-10T17:00:00Z", message: "請帶證件 <Hangup/>" };
function payload(language, purpose = "offer", location = site) {
  return buildPayload({ id: "test-attempt", channel: "voice", purpose }, { name: "陳大文", mobile: "+85291234567", language }, location, request);
}

for (const [language, voice, locale, dates, action] of [
  ["yue", "Google.yue-HK-Standard-A", "yue-HK", ["2099年11月10日", "2099年11月11日", "23點30分", "1點00分"], /接受請按1/],
  ["zh", "Google.cmn-CN-Standard-A", "cmn-CN", ["2099年11月10日", "2099年11月11日", "23点30分", "1点00分"], /接受请按1/],
  ["en", "Google.en-GB-Standard-A", "en-GB", ["10 November 2099", "11 November 2099", "23:30", "01:00"], /Press 1 to accept/],
]) {
  test(`Say ${language} offer speaks Site-local overnight dates, address and DTMF without recordings`, () => {
    const value = payload(language);
    const xml = voiceTwiml(value, "https://voice.test/gather?a=1&b=2");
    assert.ok(xml.includes(`voice="${voice}"`));
    assert.ok(xml.includes(`language="${locale}"`));
    assert.match(xml, /<Gather[^>]*input="dtmf"/);
    assert.match(xml, /numDigits="1"/);
    assert.match(xml, /actionOnEmptyResult="true"/);
    for (const text of dates) assert.ok(xml.includes(text), text);
    assert.match(xml, action);
    assert.match(xml, /皇后大道中1號/);
    assert.match(xml, /&amp; &lt;Centre&gt;/);
    assert.match(xml, /&lt;Hangup\s*\/&gt;/);
    assert.match(xml, /&amp;b=2/);
    assert.doesNotMatch(xml, /<Play|<Hangup\/>.*<Hangup\/>/);
    for (const kind of ["ack", "no_input", "unavailable"]) {
      const prompt = voiceMessage(value, kind);
      assert.ok(prompt.includes(`voice="${voice}"`));
      assert.match(prompt, /<Say[^>]+>[^<]+<\/Say>/);
      assert.doesNotMatch(prompt, /<Gather|<Play/);
    }
    for (const purpose of ["confirmation", "cancellation", "filled"]) {
      const follow = voiceTwiml(payload(language, purpose));
      assert.ok(follow.includes(`language="${locale}"`));
      assert.doesNotMatch(follow, /<Gather|<Play/);
      for (const text of dates) assert.ok(!follow.includes(text), text);
    }
  });
}
test("New Say content uses Hong Kong time regardless of historical site or execution host timezone", () => {
  const xml = voiceTwiml(payload("en", "offer", { ...site, timezone: "America/New_York" }));
  assert.match(xml, /10 November 2099/);
  assert.match(xml, /23:30/);
  assert.match(xml, /01:00/);
  assert.match(xml, /11 November/);
  assert.doesNotMatch(xml, /10:30|12:00/);
});
test("Say rejects unsupported employee language instead of silently speaking English", () => {
  assert.throws(() => payload("fr"), /language/i);
});
test("Submitted historical recording snapshots keep Play for prompts as well as the main message", () => {
  const value = { voice: { audio: { main: "https://voice.test/old.mp3", ack: "https://voice.test/ack.mp3", no_input: "https://voice.test/no-input.mp3", unavailable: "https://voice.test/full.mp3" } } };
  assert.match(voiceTwiml(value), /<Play>https:\/\/voice.test\/old.mp3<\/Play>/);
  assert.match(voiceMessage(value, "ack"), /<Play>https:\/\/voice.test\/ack.mp3<\/Play>/);
  assert.doesNotMatch(voiceMessage(value, "unavailable"), /<Say/);
});
test("A historical confirmation cancelled before answering hangs up when its snapshot has no unavailable recording", () => {
  const value = { voice: { audio: { main: "https://voice.test/old-confirmation.mp3" } } };
  assert.match(voiceMessage(value, "unavailable"), /<Hangup\s*\/>/);
  assert.doesNotMatch(voiceMessage(value, "unavailable"), /<Play|<Say/);
});
