import { test } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
let provider = {};
try {
  provider = await import("../src/twilio-pstn.js");
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
const env = {
  MESSAGING_MODE: "twilio-pstn",
  TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "a".repeat(32),
  TWILIO_FROM_NUMBER: "+6591234567",
  TWILIO_PUBLIC_BASE_URL: "https://voice.example.test",
};

test("PSTN config keeps mock as the default and requires explicit valid Twilio settings", () => {
  assert.equal(typeof provider.parsePstnConfig, "function");
  assert.deepEqual(provider.parsePstnConfig({}), { mode: "mock" });
  assert.equal(
    provider.parsePstnConfig(env).publicBaseUrl,
    "https://voice.example.test",
  );
  for (const key of [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "TWILIO_PUBLIC_BASE_URL",
  ])
    assert.throws(
      () => provider.parsePstnConfig({ ...env, [key]: "" }),
      new RegExp(key),
    );
  for (const url of [
    "http://voice.example.test",
    "https://user:pass@voice.example.test",
    "https://voice.example.test/path",
    "https://voice.example.test?token=secret",
  ])
    assert.throws(
      () => provider.parsePstnConfig({ ...env, TWILIO_PUBLIC_BASE_URL: url }),
      /TWILIO_PUBLIC_BASE_URL/,
    );
  assert.throws(
    () => provider.parsePstnConfig({ ...env, MESSAGING_MODE: "live" }),
    /MESSAGING_MODE/,
  );
});
test("AC-V-01-01 AC-V-02-01 PSTN TwiML plays uploaded audio and safely escapes its URL without TTS", () => {
  assert.equal(typeof provider.voiceTwiml, "function");
  const xml = provider.voiceTwiml(
    {
      voice: {
        audio: { main: "https://voice.example.test/offer.mp3?a=1&b=2" },
      },
      options: [
        { id: "ACCEPT", dtmf: "1" },
        { id: "DECLINE", dtmf: "2" },
      ],
    },
    "https://voice.example.test/gather",
  );
  assert.match(xml, /<Gather[^>]*numDigits="1"/);
  assert.match(xml, /actionOnEmptyResult="true"/);
  assert.match(xml, /action="https:\/\/voice.example.test\/gather"/);
  assert.match(xml, /<Play>https:/);
  assert.match(xml, /&amp;b=2/);
  assert.doesNotMatch(xml, /<Say/);
  const info = provider.voiceTwiml(
    {
      voice: { audio: { main: "https://voice.example.test/confirmation.mp3" } },
    },
    "https://voice.example.test/gather",
  );
  assert.doesNotMatch(info, /<Gather/);
  assert.match(info, /<Hangup\s*\/>/);
});
test("AC-V-02-01 PSTN digits map to accept decline repeat and no input", () => {
  assert.equal(typeof provider.mapDigits, "function");
  assert.deepEqual(provider.mapDigits("1"), {
    type: "reply",
    option_id: "ACCEPT",
  });
  assert.deepEqual(provider.mapDigits("2"), {
    type: "reply",
    option_id: "DECLINE",
  });
  assert.deepEqual(provider.mapDigits("9"), { type: "repeat" });
  assert.deepEqual(provider.mapDigits(""), { type: "no_input" });
  assert.deepEqual(provider.mapDigits("7"), { type: "invalid" });
});
test("AC-V-03-01/02/03/04 Twilio status maps to existing voice events", () => {
  assert.equal(typeof provider.mapTwilioStatus, "function");
  for (const [from, to] of [
    ["queued", "sent"],
    ["initiated", "sent"],
    ["ringing", "sent"],
    ["in-progress", "answered"],
    ["no-answer", "no_answer"],
    ["busy", "busy"],
    ["failed", "failed"],
    ["completed", "completed"],
    ["canceled", "cancelled"],
  ])
    assert.equal(provider.mapTwilioStatus(from), to);
  assert.equal(provider.mapTwilioStatus("unrecognized"), null);
});

test("PSTN SDK gateway creates a call with explicit voice and status callbacks", async () => {
  assert.equal(typeof provider.createPstnGateway, "function");
  const calls = [];
  const client = {
    calls: {
      create: async (options) => {
        calls.push(options);
        return { sid: "CA" + "2".repeat(32), status: "queued" };
      },
    },
  };
  const gateway = provider.createPstnGateway(
    provider.parsePstnConfig(env),
    client,
  );
  const payload = {
    correlation_id: "11111111-1111-4111-8111-111111111111",
    to: "+6592345678",
  };
  const result = await gateway.createCall(payload);
  assert.equal(result.sid, "CA" + "2".repeat(32));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, env.TWILIO_FROM_NUMBER);
  assert.equal(calls[0].to, payload.to);
  assert.equal(
    calls[0].url,
    env.TWILIO_PUBLIC_BASE_URL +
      "/integrations/twilio/voice/" +
      payload.correlation_id +
      "/twiml",
  );
  assert.equal(
    calls[0].statusCallback,
    env.TWILIO_PUBLIC_BASE_URL +
      "/integrations/twilio/voice/" +
      payload.correlation_id +
      "/status",
  );
  assert.deepEqual(calls[0].statusCallbackEvent, [
    "initiated",
    "ringing",
    "answered",
    "completed",
  ]);
});
test("PSTN callback validation uses the canonical public URL and every form parameter", () => {
  assert.equal(typeof provider.validateTwilioWebhook, "function");
  const config = provider.parsePstnConfig(env),
    path = "/integrations/twilio/voice/test/status?x=%2F";
  const body = {
    AccountSid: env.TWILIO_ACCOUNT_SID,
    CallSid: "CA" + "2".repeat(32),
    CallStatus: "ringing",
    NewProviderField: "future value",
  };
  const signature = twilio.getExpectedTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    env.TWILIO_PUBLIC_BASE_URL + path,
    body,
  );
  assert.equal(
    provider.validateTwilioWebhook(config, signature, path, body),
    true,
  );
  assert.equal(
    provider.validateTwilioWebhook(config, signature, path, {
      ...body,
      NewProviderField: "changed",
    }),
    false,
  );
  assert.equal(
    provider.validateTwilioWebhook(config, signature, path, {
      ...body,
      AccountSid: "AC" + "9".repeat(32),
    }),
    false,
  );
  assert.equal(provider.validateTwilioWebhook(config, "", path, body), false);
});
