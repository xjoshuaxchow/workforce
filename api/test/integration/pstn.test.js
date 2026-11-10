import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { createPool, migrate } from "../../src/db.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/security.js";
import { resetTestData } from "../test-db.js";
import { runJobs } from "../../src/messaging.js";
import * as provider from "../../src/twilio-pstn.js";
let implementation = {};
try {
  implementation = await import("../../src/pstn-adapter.js");
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test DB required");
const pool = createPool(url.toString());
const config = provider.parsePstnConfig({
  MESSAGING_MODE: "twilio-pstn",
  TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "a".repeat(32),
  TWILIO_FROM_NUMBER: "+15005550006",
  TWILIO_PUBLIC_BASE_URL: "https://voice.example.test",
});
let now,
  server,
  base,
  token,
  site,
  staff,
  pstn,
  client,
  created,
  records,
  updates,
  hooks;
before(() => migrate(pool));
after(() => pool.end());
beforeEach(async () => {
  await resetTestData(pool);
  now = new Date("2026-11-03T00:00:00Z");
  created = [];
  records = new Map();
  updates = [];
  hooks = {};
  const calls = (sid) => ({
    fetch: async () => {
      await hooks.onFetch?.(sid);
      return records.get(sid) ?? { sid, status: "queued" };
    },
    update: async (value) => {
      updates.push({ sid, ...value });
      const row = { sid, status: value.status };
      records.set(sid, row);
      return row;
    },
  });
  calls.create = async (options) => {
    created.push(options);
    if (hooks.error) {
      const e = hooks.error;
      hooks.error = null;
      throw e;
    }
    const call = {
      sid: "CA" + created.length.toString(16).padStart(32, "0"),
      status: "queued",
    };
    records.set(call.sid, call);
    if (hooks.onCreate) await hooks.onCreate(options, call);
    return call;
  };
  client = { calls };
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('pstn@test.local','PSTN Admin',$1,'admin')",
    [await hashPassword("Local-test-password-123")],
  );
});
afterEach(async () => {
  if (server) {
    await new Promise((r) => server.close(r));
    server = null;
  }
});
async function setup() {
  assert.equal(typeof implementation.createPstnAdapter, "function");
  pstn = implementation.createPstnAdapter({
    pool,
    clock: () => now,
    config,
    client,
  });
  server = createApp({
    pool,
    clock: () => now,
    messagingMode: "twilio-pstn",
    pstn,
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  token = (
    await api("POST", "/api/auth/login", {
      email: "pstn@test.local",
      password: "Local-test-password-123",
    })
  ).body.token;
  site = (
    await api("POST", "/api/sites", {
      code: "PSTN",
      name: "PSTN Site",
      address: "1 Test Road",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  staff = [];
  for (const [name, mobile] of [
    ["Anna", "+6591234567"],
    ["Ben", "+6591234568"],
  ])
    staff.push((await api("POST", "/api/staff", { name, mobile })).body.id);
  await api("POST", `/api/sites/${site}/staff`, { staff_ids: staff });
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
async function offer({ headcount = 1, direct = false } = {}) {
  const created = await api("POST", "/api/requests", {
    site_id: site,
    mode: direct ? "direct" : "broadcast",
    staff_id: direct ? staff[0] : undefined,
    headcount,
    channels: ["voice"],
    start_at: "2026-11-10T00:00:00Z",
    end_at: "2026-11-10T08:00:00Z",
  });
  assert.equal(created.status, 201);
  const sent = await api("POST", `/api/requests/${created.body.id}/send`, {});
  assert.equal(sent.status, 200);
  return sent.body;
}
async function callback(attempt, kind, params = {}, bad = false) {
  const path = `/integrations/twilio/voice/${attempt.id}/${kind}`;
  const sid =
    params.CallSid ??
    (
      await pool.query("SELECT external_id FROM attempts WHERE id=$1", [
        attempt.id,
      ])
    ).rows[0].external_id;
  const to = (
    await pool.query(
      "SELECT s.mobile FROM attempts a JOIN staff s ON s.id=a.staff_id WHERE a.id=$1",
      [attempt.id],
    )
  ).rows[0].mobile;
  const body = {
    AccountSid: config.accountSid,
    CallSid: sid,
    From: config.fromNumber,
    To: to,
    ...params,
  };
  const signature = twilio.getExpectedTwilioSignature(
    config.authToken,
    config.publicBaseUrl + path,
    body,
  );
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": bad ? "invalid" : signature,
    },
    body: new URLSearchParams(body).toString(),
  });
}
const run = () => runJobs(pool, () => now, { pstn });
const detail = (id) => api("GET", "/api/requests/" + id).then((r) => r.body);

test("PSTN sends a durable voice offer once and repeated jobs do not create a second call", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  assert.equal(created.length, 1);
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "sent");
  await pool.query(
    "UPDATE jobs SET status='queued',run_at=$1 WHERE payload->>'attempt_id'=$2",
    [now, a.id],
  );
  await run();
  assert.equal(created.length, 1);
  assert.equal(
    (
      await pool.query("SELECT count(*) FROM voice_calls WHERE attempt_id=$1", [
        a.id,
      ])
    ).rows[0].count,
    "1",
  );
});
test("PSTN callbacks require Twilio signatures and repeat/invalid digits never allocate slots", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  assert.equal(
    (await callback(a, "gather", { Digits: "1" }, true)).status,
    401,
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM message_deliveries")).rows[0].count,
    "0",
  );
  const xml = await (await callback(a, "twiml")).text();
  assert.match(xml, /<Gather/);
  assert.match(xml, /<Say[^>]*language="en-GB"/);
  assert.match(xml, /Press 1 to accept/);
  assert.doesNotMatch(xml, /<Play/);
  for (const Digits of ["9", "7"]) {
    const result = await callback(a, "gather", { Digits });
    assert.equal(result.status, 200);
    assert.match(await result.text(), /<Gather/);
  }
  assert.equal((await detail(r.id)).accepted, 0);
});
test("AC-V-02-02 PSTN digit 1 uses the existing acceptance transaction and duplicate callback is harmless", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  const reply = await callback(a, "gather", { Digits: "1" });
  assert.equal(reply.status, 200);
  assert.match(await reply.text(), /Your response has been received/);
  await callback(a, "gather", { Digits: "1" });
  await callback(a, "gather", { Digits: "2" });
  const d = await detail(r.id);
  assert.equal(d.accepted, 1);
  assert.equal(d.status, "filled");
  assert.equal(d.candidates[0].final_response, "accept");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM shifts WHERE staff_id=$1 AND status='confirmed'",
        [staff[0]],
      )
    ).rows[0].count,
    "1",
  );
});
test("PSTN parallel accepts for the last slot allocate exactly one and retain the other result", async () => {
  await setup();
  const r = await offer();
  await run();
  const a = r.candidates[0].attempts[0],
    b = r.candidates[1].attempts[0];
  const result = await Promise.all([
    callback(a, "gather", { Digits: "1" }),
    callback(b, "gather", { Digits: "1" }),
  ]);
  assert.ok(result.every((r) => r.status === 200));
  const d = await detail(r.id);
  assert.equal(d.accepted, 1);
  assert.deepEqual(d.candidates.map((c) => c.status).sort(), [
    "accepted",
    "too_late",
  ]);
});
test("AC-V-03-02/03 PSTN status callbacks map no answer and no input without inventing a response", async () => {
  await setup();
  const r = await offer();
  await run();
  const a = r.candidates[0].attempts[0],
    b = r.candidates[1].attempts[0];
  await callback(a, "status", { CallStatus: "no-answer", SequenceNumber: "3" });
  await callback(a, "status", { CallStatus: "ringing", SequenceNumber: "1" });
  await callback(b, "status", {
    CallStatus: "in-progress",
    SequenceNumber: "1",
  });
  await callback(b, "gather", { Digits: "" });
  await callback(b, "status", { CallStatus: "completed", SequenceNumber: "2" });
  const d = await detail(r.id);
  assert.equal(d.candidates[0].attempts[0].status, "no_answer");
  assert.equal(d.candidates[1].attempts[0].status, "no_input");
  assert.equal(d.accepted, 0);
});
test("PSTN uncertain create timeout is not blindly retried and a later callback recovers the Call SID", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  hooks.error = Object.assign(Error("timeout"), { code: "ETIMEDOUT" });
  await run();
  assert.equal(created.length, 1);
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
  now = new Date(+now + 60000);
  await pool.query(
    "UPDATE jobs SET status='queued',run_at=$1 WHERE payload->>'attempt_id'=$2",
    [now, a.id],
  );
  await run();
  assert.equal(created.length, 1);
  const sid = "CA" + "9".repeat(32);
  await callback(a, "status", {
    CallSid: sid,
    CallStatus: "ringing",
    SequenceNumber: "1",
  });
  const recovered = (await detail(r.id)).candidates[0].attempts[0];
  assert.equal(recovered.external_id, sid);
  assert.equal(recovered.status, "sent");
});
test("PSTN accepts a signed callback arriving before create returns without regressing a reply", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  hooks.onCreate = async (options, call) => {
    if (options.url.includes(a.id)) {
      await callback(a, "status", {
        CallSid: call.sid,
        CallStatus: "in-progress",
        SequenceNumber: "1",
      });
      await callback(a, "gather", { CallSid: call.sid, Digits: "1" });
      await callback(a, "status", {
        CallSid: call.sid,
        CallStatus: "completed",
        SequenceNumber: "2",
      });
    }
  };
  await run();
  const d = await detail(r.id);
  assert.equal(d.accepted, 1);
  assert.equal(
    d.candidates[0].attempts.find((x) => x.id === a.id).status,
    "replied",
  );
  assert.equal(created.filter((x) => x.url.includes(a.id)).length, 1);
});
test("PSTN cancels a ringing offer after request cancellation and remembers cancellation before SID recovery", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  const sid = (await detail(r.id)).candidates[0].attempts[0].external_id;
  await api("POST", `/api/requests/${r.id}/cancel`, {});
  await run();
  assert.ok(updates.some((x) => x.sid === sid && x.status === "canceled"));
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "cancelled",
  );
  const second = await offer({ direct: true }),
    b = second.candidates[0].attempts[0];
  hooks.error = Object.assign(Error("timeout"), { code: "ETIMEDOUT" });
  await run();
  await api("POST", `/api/requests/${second.id}/cancel`, {});
  await run();
  assert.equal(
    (
      await pool.query(
        "SELECT cancel_requested FROM voice_calls WHERE attempt_id=$1",
        [b.id],
      )
    ).rows[0].cancel_requested,
    true,
  );
  const recovered = "CA" + "8".repeat(32);
  await callback(b, "status", {
    CallSid: recovered,
    CallStatus: "ringing",
    SequenceNumber: "1",
  });
  await run();
  assert.ok(
    updates.some((x) => x.sid === recovered && x.status === "canceled"),
  );
});

test("PSTN provider cancellation is final and completed informational calls show completed", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  await callback(a, "status", { CallStatus: "canceled", SequenceNumber: "4" });
  await callback(a, "status", { CallStatus: "ringing", SequenceNumber: "1" });
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "cancelled",
  );
});
test("PSTN explicit 429 rejection safely retries but 400 fails permanently and 503 stays uncertain", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  hooks.error = Object.assign(Error("rate limited"), { status: 429 });
  await run();
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "queued");
  now = new Date(+now + 5000);
  await run();
  assert.equal(created.length, 2);
  const second = await offer({ direct: true });
  hooks.error = Object.assign(Error("rejected"), { status: 400, code: 21211 });
  await run();
  assert.equal(
    (await detail(second.id)).candidates[0].attempts[0].status,
    "failed",
  );
  const third = await offer({ direct: true });
  hooks.error = Object.assign(Error("server error"), { status: 503 });
  await run();
  assert.equal(
    (await detail(third.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
});
test("PSTN confirmation waits for the offer to end and completes without changing the reply", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  const sid = (await detail(r.id)).candidates[0].attempts[0].external_id;
  records.set(sid, { sid, status: "in-progress" });
  await callback(a, "gather", { Digits: "1" });
  await run();
  assert.equal(created.length, 1);
  records.set(sid, { sid, status: "completed" });
  await callback(a, "status", { CallStatus: "completed", SequenceNumber: "4" });
  now = new Date(+now + 2000);
  await run();
  assert.equal(created.length, 2);
  const d = await detail(r.id),
    confirmation = d.candidates[0].attempts.find(
      (x) => x.purpose === "confirmation",
    );
  assert.ok(confirmation);
  const xml = await (await callback(confirmation, "twiml")).text();
  assert.doesNotMatch(xml, /<Gather/);
  assert.match(xml, /Your shift has been confirmed/);
  await callback(confirmation, "status", {
    CallStatus: "completed",
    SequenceNumber: "4",
  });
  const final = await detail(r.id);
  assert.equal(
    final.candidates[0].attempts.find((x) => x.id === confirmation.id).status,
    "completed",
  );
  assert.equal(
    final.candidates[0].attempts.find((x) => x.id === a.id).status,
    "replied",
  );
});
test("PSTN rejects signed callback endpoint or SID mismatches before recording events", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  for (const params of [
    { To: "+6598765432" },
    { From: "+6598765432" },
    { CallSid: "CA" + "7".repeat(32) },
  ])
    assert.equal(
      (await callback(a, "gather", { Digits: "1", ...params })).status,
      409,
    );
  assert.equal(
    (await pool.query("SELECT count(*) FROM message_deliveries")).rows[0].count,
    "0",
  );
  assert.equal((await detail(r.id)).accepted, 0);
  assert.deepEqual((await api("GET", "/api/messaging/status")).body, {
    mode: "twilio-pstn",
    voice: "twilio",
    whatsapp: "mock",
  });
  assert.equal(
    (
      await api("POST", `/api/mock/attempts/${a.id}/events`, {
        type: "reply",
        option_id: "ACCEPT",
      })
    ).status,
    404,
  );
});
test("PSTN retry of a terminal callback recovers an inbox write interrupted after binding", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  // Simulate a process stopping between persisted provider state and durable inbox receipt.
  await pool.query(
    "UPDATE voice_calls SET state='finished',last_status='no-answer',last_sequence=4 WHERE attempt_id=$1",
    [a.id],
  );
  await callback(a, "status", { CallStatus: "no-answer", SequenceNumber: "4" });
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "no_answer",
  );
  await callback(a, "status", { CallStatus: "completed", SequenceNumber: "5" });
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "no_answer",
  );
});

test("PSTN 429 retry snapshots changed caller and destination and accepts their authentic callbacks", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  hooks.error = Object.assign(Error("rate limited"), { status: 429 });
  await run();
  const mobile = "+6592345678",
    from = "+15005550007";
  assert.equal(
    (await api("PATCH", `/api/staff/${staff[0]}`, { mobile })).status,
    200,
  );
  pstn = implementation.createPstnAdapter({
    pool,
    clock: () => now,
    config: { ...config, fromNumber: from },
    client,
  });
  now = new Date(+now + 5000);
  await run();
  const attempt = (await detail(r.id)).candidates[0].attempts[0];
  assert.equal(attempt.status, "sent");
  assert.equal(created[1].to, mobile);
  assert.equal(created[1].from, from);
  assert.equal((await callback(a, "twiml", { From: from })).status, 200);
  assert.equal(
    (await callback(a, "gather", { From: from, Digits: "1" })).status,
    200,
  );
  assert.equal((await detail(r.id)).accepted, 1);
});
test("PSTN Gather acknowledgment does not wait for unrelated slow cancellation requests", async () => {
  await setup();
  const r = await offer();
  await run();
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  hooks.onFetch = () => blocked;
  const pending = callback(r.candidates[0].attempts[0], "gather", {
    Digits: "1",
  });
  try {
    const response = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve(null), 300)),
    ]);
    assert.ok(
      response,
      "Gather must respond before an unrelated provider fetch resolves",
    );
    assert.equal(response.status, 200);
    assert.equal((await detail(r.id)).accepted, 1);
  } finally {
    release();
    await pending;
  }
  await run();
  assert.ok(updates.some((x) => x.status === "canceled"));
});
test("PSTN interrupted submission defers lease recovery until it can expose unknown outcome", async () => {
  await setup();
  const r = await offer({ direct: true }),
    a = r.candidates[0].attempts[0];
  await run();
  const elapsed = new Date(+now - 26000);
  await pool.query(
    "UPDATE voice_calls SET state='submitting',call_sid=NULL,last_status=NULL,submission_started_at=$2 WHERE attempt_id=$1",
    [a.id, elapsed],
  );
  await pool.query(
    "UPDATE attempts SET status='submitting',external_id=NULL WHERE id=$1",
    [a.id],
  );
  await pool.query(
    "UPDATE jobs SET status='running',locked_at=$2 WHERE payload->>'attempt_id'=$1",
    [a.id, new Date(+now - 31000)],
  );
  const count = created.length;
  await run();
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM jobs WHERE payload->>'attempt_id'=$1",
        [a.id],
      )
    ).rows[0].status,
    "queued",
  );
  now = new Date(+now + 5000);
  await run();
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
  assert.equal(created.length, count);
});
test("PSTN rejects browser mutations carrying a stale observed mode without data or audit changes", async () => {
  await setup();
  const before = (await pool.query("SELECT count(*) FROM audit_log")).rows[0]
    .count;
  const response = await fetch(base + "/api/sites", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
      "X-Workforce-Messaging-Mode": "mock",
    },
    body: JSON.stringify({
      code: "STALE",
      name: "Stale Mode",
      timezone: "Asia/Singapore",
    }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "messaging_mode_changed");
  assert.equal(
    (await pool.query("SELECT count(*) FROM sites WHERE code='STALE'")).rows[0]
      .count,
    "0",
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM audit_log")).rows[0].count,
    before,
  );
});
