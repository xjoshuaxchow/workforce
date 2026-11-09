import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../../src/db.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/security.js";
import { resetTestData } from "../test-db.js";
import { runJobs } from "../../src/messaging.js";
import { parseWhatsAppConfig } from "../../src/whatsapp-client.js";
let implementation = {};
try {
  implementation = await import("../../src/whatsapp-adapter.js");
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test DB required");
const pool = createPool(url.toString());
before(() => migrate(pool));
after(() => pool.end());
const definitions = Object.fromEntries(
  [
    "shift_offer_v1",
    "shift_confirmed_v1",
    "shift_unavailable_v1",
    "shift_cancelled_v1",
    "roster_published_v1",
    "roster_changed_v1",
  ].map((name) => [
    name,
    {
      name,
      language: "en",
      body: ["staff_name", "site_name"],
      ...(name === "shift_offer_v1"
        ? { buttons: { accept: 0, decline: 1 } }
        : {}),
    },
  ]),
);
let now,
  server,
  service,
  base,
  token,
  site,
  staff,
  wa,
  requests,
  submissions,
  messages,
  incoming,
  hooks,
  serviceUrl;
beforeEach(async () => {
  await resetTestData(pool);
  now = new Date("2026-11-03T00:00:00Z");
  requests = [];
  submissions = new Map();
  messages = new Map();
  incoming = [];
  hooks = {};
  service = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const url = new URL(req.url, "http://test");
    requests.push({
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    res.setHeader("content-type", "application/json");
    const reply = (status, data) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== "Bearer local-service-key")
      return reply(401, { error: { code: "UNAUTHORIZED" } });
    if (url.pathname.startsWith("/v1/message-requests/")) {
      const value = submissions.get(
        decodeURIComponent(url.pathname.slice("/v1/message-requests/".length)),
      );
      return reply(
        value ? 200 : 404,
        value ?? { error: { code: "NOT_FOUND" } },
      );
    }
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      if (hooks.postError) {
        const status = hooks.postError;
        hooks.postError = null;
        return reply(status, { error: { code: "REJECTED" } });
      }
      const key = req.headers["idempotency-key"];
      let result = submissions.get(key);
      if (!result) {
        const id = randomUUID(),
          content = JSON.parse(raw);
        result = { messageIds: [id], batchId: null, status: "queued" };
        submissions.set(key, result);
        messages.set(id, {
          id,
          direction: "outbound",
          contact_id: content.to,
          content,
          meta_id: "wamid." + id,
          submission_status: "accepted",
          delivery_status: "sent",
          created_at: now.toISOString(),
        });
      }
      if (hooks.drop) {
        hooks.drop = false;
        return req.socket.destroy();
      }
      if (hooks.malformed) {
        hooks.malformed = false;
        return reply(202, { status: "queued" });
      }
      return reply(202, result);
    }
    if (url.pathname === "/v1/messages") {
      const data = incoming
        .filter((x) => x.contact_id === url.searchParams.get("contact"))
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        );
      const offset = Number(url.searchParams.get("cursor") ?? 0),
        limit = hooks.pageSize ?? 100;
      return reply(200, {
        data: data.slice(offset, offset + limit),
        nextCursor:
          offset + limit < data.length ? String(offset + limit) : null,
      });
    }
    const message = messages.get(url.pathname.slice("/v1/messages/".length));
    return reply(
      message ? 200 : 404,
      message ?? { error: { code: "NOT_FOUND" } },
    );
  });
  service.listen(0, "127.0.0.1");
  await new Promise((r) => service.once("listening", r));
  serviceUrl = "http://127.0.0.1:" + service.address().port;
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('wa@test.local','WA Admin',$1,'admin')",
    [await hashPassword("Local-test-password-123")],
  );
});
afterEach(async () => {
  if (server) {
    await new Promise((r) => server.close(r));
    server = null;
  }
  if (service) {
    await new Promise((r) => service.close(r));
    service = null;
  }
});
async function setup() {
  assert.equal(typeof implementation.createWhatsAppAdapter, "function");
  wa = implementation.createWhatsAppAdapter({
    pool,
    clock: () => now,
    config: parseWhatsAppConfig(
      {
        WHATSAPP_MODE: "service",
        WHATSAPP_SERVICE_URL: serviceUrl,
        WHATSAPP_SERVICE_API_KEY: "local-service-key",
      },
      definitions,
    ),
  });
  server = createApp({
    pool,
    clock: () => now,
    whatsapp: wa,
    whatsappMode: "service",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  token = (
    await api("POST", "/api/auth/login", {
      email: "wa@test.local",
      password: "Local-test-password-123",
    })
  ).body.token;
  site = (
    await api("POST", "/api/sites", {
      code: "WA",
      name: "WA Site",
      address: "Test Road",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  staff = [];
  for (const [name, mobile] of [
    ["Anna", "+6591234567"],
    ["Ben", "+6591234568"],
  ])
    staff.push(
      (
        await api("POST", "/api/staff", {
          name,
          mobile,
          whatsapp_opt_in: true,
          whatsapp_opt_in_source: "test",
        })
      ).body.id,
    );
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
async function offer({ direct = true } = {}) {
  const r = await api("POST", "/api/requests", {
    site_id: site,
    mode: direct ? "direct" : "broadcast",
    staff_id: direct ? staff[0] : undefined,
    headcount: 1,
    channels: ["whatsapp"],
    start_at: "2026-11-10T00:00:00Z",
    end_at: "2026-11-10T08:00:00Z",
  });
  assert.equal(r.status, 201);
  return (await api("POST", `/api/requests/${r.body.id}/send`, {})).body;
}
const run = () => runJobs(pool, () => now, { whatsapp: wa });
const detail = (id) => api("GET", "/api/requests/" + id).then((x) => x.body);
async function poll(ms = 3000) {
  now = new Date(+now + ms);
  await wa.poll();
}
async function reply(attempt, option = "ACCEPT", override = {}) {
  const saved = (
      await pool.query(
        "SELECT * FROM whatsapp_submissions WHERE attempt_id=$1",
        [attempt.id],
      )
    ).rows[0],
    out = messages.get(saved.message_id),
    id = randomUUID();
  const content = {
    id: "wamid.in." + id,
    from: out.contact_id,
    type: "button",
    button: { payload: `workforce:${attempt.id}:${option}` },
    context: { id: out.meta_id },
    ...override,
  };
  const row = {
    id,
    meta_id: content.id,
    contact_id: content.from,
    direction: "inbound",
    type: content.type,
    content,
    created_at: new Date(+now + incoming.length).toISOString(),
  };
  incoming.push(row);
  return row;
}

test("AC-I-01-01/02 WhatsApp directly calls microservice v1 with one stable idempotency key", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  await run();
  const posts = requests.filter((x) => x.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].headers["idempotency-key"], "workforce:" + a.id);
  assert.equal(posts[0].body.to, "6591234567");
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "sent");
});
test("AC-I-01-06 WhatsApp recovers a persisted submission after the HTTP response is lost", async () => {
  await setup();
  const r = await offer();
  hooks.drop = true;
  await run();
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
  await poll(5000);
  await run();
  assert.equal(requests.filter((x) => x.method === "POST").length, 1);
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "sent");
});
test("WhatsApp retries an unchanged snapshot after 429 even if staff or templates change", async () => {
  await setup();
  const r = await offer();
  hooks.postError = 429;
  await run();
  await api("PATCH", `/api/staff/${staff[0]}`, {
    name: "Updated",
    mobile: "+6592345678",
  });
  await poll(5000);
  await run();
  const posts = requests.filter((x) => x.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "sent");
});
test("AC-W-03-01/02 WhatsApp polls status without moving read backwards", async () => {
  await setup();
  const r = await offer();
  await run();
  const outgoing = [...messages.values()][0];
  outgoing.delivery_status = "read";
  await poll();
  outgoing.delivery_status = "delivered";
  await poll();
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "read");
});
test("AC-W-04-01 AC-RH-02-01 WhatsApp accepts once through unified inbox and preserves first response", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  await reply(a);
  await poll();
  await poll();
  await reply(a, "DECLINE");
  await poll();
  const d = await detail(r.id);
  assert.equal(d.accepted, 1);
  assert.equal(d.candidates[0].final_response, "accept");
  assert.equal(d.candidates[0].attempts[0].status, "replied");
  assert.equal(
    (await pool.query("SELECT count(*) FROM assignments")).rows[0].count,
    "1",
  );
});
test("WhatsApp ignores wrong sender context unscoped buttons and free text", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  await reply(a, "ACCEPT", { context: { id: "wamid.wrong" } });
  await reply(a, "ACCEPT", { from: "6591234568" });
  await reply(a, "ACCEPT", { button: { payload: "ACCEPT" } });
  await reply(a, "ACCEPT", { type: "text", text: { body: "Yes" } });
  await poll();
  assert.equal((await detail(r.id)).accepted, 0);
});
test("WhatsApp paginates inbound history and processes first received response first", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  hooks.pageSize = 1;
  await reply(a, "ACCEPT");
  await reply(a, "DECLINE");
  await poll();
  assert.equal((await detail(r.id)).candidates[0].final_response, "accept");
  assert.ok(requests.some((x) => x.path === "/v1/messages"));
});
test("AC-RH-03-01 WhatsApp simultaneous pollers cannot overfill the last slot", async () => {
  await setup();
  const r = await offer({ direct: false });
  await run();
  for (const c of r.candidates) await reply(c.attempts[0]);
  now = new Date(+now + 3000);
  await Promise.all([wa.poll(), wa.poll()]);
  assert.equal((await detail(r.id)).accepted, 1);
  assert.deepEqual(
    (await detail(r.id)).candidates.map((c) => c.status).sort(),
    ["accepted", "too_late"],
  );
});
test("AC-I-01-07 WhatsApp cancelled queued offer sends nothing and live mode identifies both channels", async () => {
  await setup();
  const r = await offer();
  await api("POST", `/api/requests/${r.id}/cancel`, {});
  await run();
  assert.equal(requests.filter((x) => x.method === "POST").length, 0);
  assert.deepEqual((await api("GET", "/api/messaging/status")).body, {
    mode: "mock+whatsapp-service",
    voice: "mock",
    whatsapp: "service",
  });
});
test("AC-I-01-03 WhatsApp permanent rejection fails without retry while Meta unknown is visible", async () => {
  await setup();
  const r = await offer();
  hooks.postError = 422;
  await run();
  await poll(60000);
  await run();
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "failed");
  assert.equal(requests.filter((x) => x.method === "POST").length, 1);
  const second = await offer();
  await run();
  const out = [...messages.values()][0];
  out.delivery_status = null;
  out.submission_status = "unknown";
  await poll();
  assert.equal(
    (await detail(second.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
  out.submission_status = "accepted";
  out.delivery_status = "read";
  await poll();
  assert.equal(
    (await detail(second.id)).candidates[0].attempts[0].status,
    "read",
  );
});

test("AC-RH-04-01 WhatsApp stores the complete incoming service record including future provider fields", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  const incoming = await reply(a);
  incoming.future_provider_field = { source: "handoff" };
  await poll();
  const row = (
    await pool.query(
      "SELECT raw_body FROM message_deliveries WHERE event_id=$1",
      ["whatsapp:incoming:" + incoming.id],
    )
  ).rows[0];
  assert.deepEqual(JSON.parse(row.raw_body).future_provider_field, {
    source: "handoff",
  });
});
test("WhatsApp invalid create response remains unknown and recovers through its stable request key", async () => {
  await setup();
  const r = await offer();
  hooks.malformed = true;
  await run();
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
  await poll(5000);
  await run();
  assert.equal(requests.filter((x) => x.method === "POST").length, 1);
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "sent");
});
test("WhatsApp partial-live mode blocks stale browser mode and hides mock mutation endpoints", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  const response = await fetch(base + `/api/requests/${r.id}/cancel`, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "X-Workforce-Messaging-Mode": "mock",
    },
    body: "{}",
  });
  assert.equal(response.status, 409);
  assert.equal((await detail(r.id)).status, "open");
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

async function queueInfo(purpose, extra = {}) {
  const { queueAttempt } = await import("../../src/outbox.js"),
    { mutate } = await import("../../src/service.js");
  const shift = {
    start_at: "2026-11-10T00:00:00Z",
    end_at: "2026-11-10T08:00:00Z",
  };
  return mutate(
    pool,
    () => now,
    (db) =>
      queueAttempt(db, () => now, {
        siteId: site,
        staffId: staff[0],
        channel: "whatsapp",
        purpose,
        key: "test:" + randomUUID(),
        payload: {
          ...shift,
          shifts: [shift],
          old: shift,
          change: "time_changed",
        },
        ...extra,
      }),
  );
}
test("Review WhatsApp roster publish and change safely retry their original snapshot after 429", async () => {
  await setup();
  for (const purpose of ["roster_publish", "roster_change"]) {
    const attempt = await queueInfo(purpose);
    hooks.postError = 429;
    await run();
    const before = requests.filter((x) => x.method === "POST").at(-1);
    now = new Date(+now + 5000);
    await run();
    const after = requests.filter((x) => x.method === "POST").at(-1);
    assert.equal(
      (
        await pool.query("SELECT status FROM attempts WHERE id=$1", [
          attempt.id,
        ])
      ).rows[0].status,
      "sent",
    );
    assert.deepEqual(after.body, before.body);
    assert.equal(
      after.headers["idempotency-key"],
      before.headers["idempotency-key"],
    );
  }
});
test("Review WhatsApp processes pending earlier decline before later accept across restart and overlapping pollers", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  const old = await reply(a, "DECLINE");
  await reply(a, "ACCEPT");
  const eventId = "whatsapp:incoming:" + old.id;
  await pool.query(
    "INSERT INTO message_events(event_id,correlation_id,payload,received_at) VALUES($1,$2,$3,$4)",
    [
      eventId,
      a.id,
      {
        event_id: eventId,
        correlation_id: a.id,
        type: "reply",
        option_id: "DECLINE",
      },
      now,
    ],
  );
  await pool.query(
    "INSERT INTO jobs(kind,payload,run_at,dedupe_key) VALUES('process-event',$1,$2,$3)",
    [{ event_id: eventId }, new Date(+now + 60000), "event:" + eventId],
  );
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT 1 FROM message_events WHERE event_id=$1 FOR UPDATE",
    [eventId],
  );
  let first, second;
  try {
    now = new Date(+now + 3000);
    first = run();
    await new Promise((r) => setTimeout(r, 50));
    now = new Date(+now + 4000);
    second = wa.poll();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    await blocker.query("COMMIT");
    blocker.release();
  }
  await Promise.all([first, second]);
  const d = await detail(r.id);
  assert.equal(d.candidates[0].final_response, "decline");
  assert.equal(d.accepted, 0);
});
test("Review WhatsApp sent unknown sent reflects provider recovery without another submission", async () => {
  await setup();
  const r = await offer();
  await run();
  const out = [...messages.values()][0];
  await poll();
  out.submission_status = "unknown";
  out.delivery_status = null;
  await poll();
  assert.equal(
    (await detail(r.id)).candidates[0].attempts[0].status,
    "submission_unknown",
  );
  out.submission_status = "accepted";
  out.delivery_status = "sent";
  await poll();
  assert.equal((await detail(r.id)).candidates[0].attempts[0].status, "sent");
  assert.equal(requests.filter((x) => x.method === "POST").length, 1);
});
test("Review WhatsApp consent withdrawn after enqueue blocks every information purpose", async () => {
  await setup();
  const r = await offer(),
    a = r.candidates[0].attempts[0];
  await run();
  await reply(a);
  await poll();
  const extra = { requestId: r.id, candidateId: r.candidates[0].id };
  for (const purpose of [
    "roster_publish",
    "roster_change",
    "filled",
    "cancellation",
  ])
    await queueInfo(purpose, purpose.startsWith("roster") ? {} : extra);
  await api("PATCH", `/api/staff/${staff[0]}`, { whatsapp_opt_in: false });
  await run();
  assert.equal(requests.filter((x) => x.method === "POST").length, 1);
  const infos = (
    await pool.query("SELECT * FROM attempts WHERE purpose<>'offer'")
  ).rows;
  assert.equal(infos.length, 5);
  assert.ok(infos.every((a) => a.status === "cancelled"));
});
test("Review WhatsApp consent withdrawal also blocks a reserved snapshot retry", async () => {
  await setup();
  const a = await queueInfo("roster_publish");
  hooks.postError = 429;
  await run();
  await api("PATCH", `/api/staff/${staff[0]}`, { whatsapp_opt_in: false });
  now = new Date(+now + 5000);
  await run();
  assert.equal(requests.filter((x) => x.method === "POST").length, 1);
  assert.equal(
    (await pool.query("SELECT status FROM attempts WHERE id=$1", [a.id]))
      .rows[0].status,
    "cancelled",
  );
});
test("Review WhatsApp known offers stop polling after shift end while future offers keep updating", async () => {
  await setup();
  const ids = [];
  for (const status of ["sent", "delivered", "read", "replied"]) {
    const r = await offer();
    await run();
    const a = r.candidates[0].attempts[0];
    await pool.query("UPDATE attempts SET status=$2 WHERE id=$1", [
      a.id,
      status,
    ]);
    ids.push(
      (
        await pool.query(
          "SELECT message_id FROM whatsapp_submissions WHERE attempt_id=$1",
          [a.id],
        )
      ).rows[0].message_id,
    );
  }
  now = new Date("2026-11-10T08:00:01Z");
  token = (
    await api("POST", "/api/auth/login", {
      email: "wa@test.local",
      password: "Local-test-password-123",
    })
  ).body.token;
  const checkpoint = requests.length;
  const future = (
    await api("POST", "/api/requests", {
      site_id: site,
      mode: "direct",
      staff_id: staff[0],
      headcount: 1,
      channels: ["whatsapp"],
      start_at: "2026-11-11T00:00:00Z",
      end_at: "2026-11-11T08:00:00Z",
    })
  ).body;
  await api("POST", `/api/requests/${future.id}/send`, {});
  await run();
  await poll();
  assert.ok(
    !requests
      .slice(checkpoint)
      .some((x) => ids.some((id) => x.path === "/v1/messages/" + id)),
  );
  const d = await detail(future.id);
  assert.equal(d.candidates[0].attempts[0].status, "sent");
  assert.ok(
    requests
      .slice(checkpoint)
      .some(
        (x) =>
          x.path === "/v1/messages/" + d.candidates[0].attempts[0].external_id,
      ),
  );
});
