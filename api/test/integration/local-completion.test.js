import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/security.js";
import { resetTestData } from "../test-db.js";
import { readFile } from "node:fs/promises";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test database required");
const pool = createPool(url.toString());
let server, base, adminToken, managerToken, site, other, staff;
let now = new Date("2026-11-03T00:00:00Z");
async function call(method, path, body, token = adminToken) {
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
async function makeRequest(siteId = site, extra = {}) {
  const r = await call("POST", "/api/requests", {
    site_id: siteId,
    mode: "broadcast",
    headcount: 2,
    channels: ["whatsapp", "voice"],
    start_at: "2026-11-10T00:00:00Z",
    end_at: "2026-11-10T08:00:00Z",
    ...extra,
  });
  assert.equal(r.status, 201);
  return r.body;
}
before(async () => {
  await migrate(pool);
  await resetTestData(pool);
  const hash = await hashPassword("Local-test-password-123");
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('completion-admin@test.local','Admin',$1,'admin'),('completion-manager@test.local','Manager',$1,'site_manager')",
    [hash],
  );
  server = createApp({
    pool,
    clock: () => new Date(now),
    messagingMode: "mock",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = (
    await call(
      "POST",
      "/api/auth/login",
      {
        email: "completion-admin@test.local",
        password: "Local-test-password-123",
      },
      null,
    )
  ).body.token;
  const login = (
    await call(
      "POST",
      "/api/auth/login",
      {
        email: "completion-manager@test.local",
        password: "Local-test-password-123",
      },
      null,
    )
  ).body;
  managerToken = login.token;
  site = (
    await call("POST", "/api/sites", {
      code: "COMPLETE",
      name: "Completion Site",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  other = (
    await call("POST", "/api/sites", {
      code: "OTHER",
      name: "Other Site",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  await call("POST", `/api/users/${login.user.id}/sites`, { site_id: site });
  staff = (
    await call("POST", "/api/staff", {
      name: "Reply Time Anna",
      mobile: "+6591234567",
      whatsapp_opt_in: true,
      whatsapp_opt_in_source: "paper",
    })
  ).body.id;
  await call("POST", `/api/sites/${site}/staff`, { staff_ids: [staff] });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});

test("AC-R-01-10 open request PATCH returns 409 without changing the request or audit", async () => {
  const r = await makeRequest();
  await call("POST", `/api/requests/${r.id}/send`, {});
  const before = (await call("GET", `/api/requests/${r.id}`)).body;
  const count = Number(
    (await pool.query("SELECT count(*) FROM audit_log")).rows[0].count,
  );
  const changed = await call("PATCH", `/api/requests/${r.id}`, {
    headcount: 9,
    start_at: "2026-11-11T00:00:00Z",
  });
  assert.equal(changed.status, 409);
  assert.deepEqual((await call("GET", `/api/requests/${r.id}`)).body, before);
  assert.equal(
    Number((await pool.query("SELECT count(*) FROM audit_log")).rows[0].count),
    count,
  );
  const foreign = await makeRequest(other);
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/requests/${foreign.id}`,
        { headcount: 3 },
        managerToken,
      )
    ).status,
    404,
  );
});

test("AC-D-04-02 each offer channel retains its first valid reply receipt time and response", async () => {
  const r = await makeRequest();
  const sent = (await call("POST", `/api/requests/${r.id}/send`, {})).body;
  const candidate = sent.candidates[0];
  const wa = candidate.attempts.find((a) => a.channel === "whatsapp"),
    voice = candidate.attempts.find((a) => a.channel === "voice");
  assert.ok(wa && voice);
  now = new Date("2026-11-03T00:01:00Z");
  await call("POST", `/api/mock/attempts/${wa.id}/events`, {
    type: "reply",
    option_id: "UNKNOWN",
  });
  let detail = (await call("GET", `/api/requests/${r.id}`)).body;
  assert.equal(
    detail.candidates[0].attempts.find((a) => a.id === wa.id).response_at,
    null,
  );
  now = new Date("2026-11-03T00:02:00Z");
  await call("POST", `/api/mock/attempts/${wa.id}/events`, {
    type: "reply",
    option_id: "ACCEPT",
  });
  now = new Date("2026-11-03T00:03:00Z");
  await call("POST", `/api/mock/attempts/${voice.id}/events`, {
    type: "reply",
    option_id: "DECLINE",
  });
  now = new Date("2026-11-03T00:04:00Z");
  await call("POST", `/api/mock/attempts/${wa.id}/events`, {
    type: "reply",
    option_id: "DECLINE",
  });
  detail = (await call("GET", `/api/requests/${r.id}`)).body;
  const c = detail.candidates[0];
  assert.equal(c.final_response, "accept");
  assert.equal(detail.accepted, 1);
  const a = c.attempts.find((a) => a.id === wa.id),
    b = c.attempts.find((a) => a.id === voice.id);
  assert.equal(a.response_at, "2026-11-03T00:02:00.000Z");
  assert.equal(a.response, "accept");
  assert.equal(b.response_at, "2026-11-03T00:03:00.000Z");
  assert.equal(b.response, "decline");
});

test("AC-N-01-06 entity audit filters hide inaccessible requests with 404", async () => {
  const a = await makeRequest(),
    b = await makeRequest(other);
  const own = await call(
    "GET",
    `/api/audit?entity_type=request&entity_id=${a.id}`,
    undefined,
    managerToken,
  );
  assert.equal(own.status, 200);
  assert.ok(own.body.total > 0);
  assert.ok(
    own.body.items.every(
      (row) => row.entity_type === "request" && row.entity_id === a.id,
    ),
  );
  assert.equal(
    (
      await call(
        "GET",
        `/api/audit?entity_type=request&entity_id=${b.id}`,
        undefined,
        managerToken,
      )
    ).status,
    404,
  );
  const global = await call(
    "GET",
    `/api/audit?entity_type=request&entity_id=${b.id}`,
  );
  assert.equal(global.status, 200);
  assert.ok(global.body.items.every((row) => row.entity_id === b.id));
  assert.equal(
    (await call("GET", "/api/audit?entity_type=request")).status,
    400,
  );
  assert.equal(
    (await call("GET", "/api/audit?entity_type=request&entity_id=not-a-uuid"))
      .status,
    400,
  );
});

test("Migration 005 backfills a legacy response and timestamp from the same first valid event", async () => {
  const r = await makeRequest(site, {
    start_at: "2026-11-12T00:00:00Z",
    end_at: "2026-11-12T08:00:00Z",
  });
  const sentResult = await call("POST", `/api/requests/${r.id}/send`, {});
  assert.equal(sentResult.status, 200);
  const sent = sentResult.body;
  const attempt = sent.candidates[0].attempts.find(
    (a) => a.channel === "whatsapp",
  );
  await pool.query(
    "UPDATE attempts SET status='replied',response='decline',response_at=NULL WHERE id=$1",
    [attempt.id],
  );
  for (const [option, time] of [
    ["ACCEPT", "2026-11-03T00:05:00Z"],
    ["DECLINE", "2026-11-03T00:06:00Z"],
  ]) {
    await pool.query(
      "INSERT INTO message_events(event_id,correlation_id,payload,processed,received_at) VALUES($1,$2,$3,true,$4)",
      [
        "legacy-" + option + "-" + attempt.id,
        attempt.id,
        JSON.stringify({ type: "reply", option_id: option }),
        time,
      ],
    );
  }
  const sql = await readFile(
    new URL("../../sql/005-attempt-response-time.sql", import.meta.url),
    "utf8",
  );
  await pool.query(sql);
  let row = (
    await pool.query("SELECT response,response_at FROM attempts WHERE id=$1", [
      attempt.id,
    ])
  ).rows[0];
  assert.equal(row.response, "accept");
  assert.equal(row.response_at.toISOString(), "2026-11-03T00:05:00.000Z");
  await pool.query(sql);
  const again = (
    await pool.query("SELECT response,response_at FROM attempts WHERE id=$1", [
      attempt.id,
    ])
  ).rows[0];
  assert.deepEqual(again, row);
});
