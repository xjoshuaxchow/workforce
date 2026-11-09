import { resetTestData } from '../test-db.js';
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/security.js";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test DB required");
const pool = createPool(url.toString());
let now = new Date("2026-11-02T06:00:00Z"),
  server,
  base,
  token,
  site,
  staff;
async function call(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
before(async () => {
  await migrate(pool);
  await resetTestData(pool);
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('mock@test.local','Admin',$1,'admin')",
    [await hashPassword("Local-test-password-123")],
  );
  server = createApp({ pool, clock: () => now }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (
    await call("POST", "/api/auth/login", {
      email: "mock@test.local",
      password: "Local-test-password-123",
    })
  ).body.token;
  site = (
    await call("POST", "/api/sites", {
      code: "MOCK",
      name: "Mock",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  staff = (
    await call("POST", "/api/staff", { name: "Anna", mobile: "+6591234567" })
  ).body.id;
  await call("POST", `/api/sites/${site}/staff`, { staff_ids: [staff] });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});
async function setup(outcomes) {
  await call("POST", "/api/mock/reset", {});
  const config = await call("POST", "/api/mock/config", { outcomes });
  assert.equal(config.status, 200);
  const r = await call("POST", "/api/requests", {
    site_id: site,
    mode: "direct",
    staff_id: staff,
    headcount: 1,
    channels: ["voice"],
    start_at: "2026-11-04T23:00:00Z",
    end_at: "2026-11-05T07:00:00Z",
  });
  assert.equal(r.status, 201);
  const detail = (await call("POST", `/api/requests/${r.body.id}/send`, {}))
    .body;
  return detail.candidates[0].attempts[0];
}
const run = async (seconds = 0) => {
  now = new Date(+now + seconds * 1000);
  return call("POST", "/api/mock/run-jobs", {});
};
test("AC-I-01-03 400 fails immediately without another send", async () => {
  const a = await setup([400]);
  await run();
  assert.equal(
    (await pool.query("SELECT status FROM attempts WHERE id=$1", [a.id]))
      .rows[0].status,
    "failed",
  );
  await run(180);
  assert.equal((await call("GET", "/api/mock/sent")).body.items.length, 1);
});
test("AC-I-01-04 retries 503 at 5 seconds then 30 seconds and succeeds", async () => {
  const a = await setup([503, 503, 202]);
  await run();
  await run(4);
  assert.equal((await call("GET", "/api/mock/sent")).body.items.length, 1);
  await run(1);
  await run(30);
  assert.equal(
    (await pool.query("SELECT status FROM attempts WHERE id=$1", [a.id]))
      .rows[0].status,
    "sent",
  );
  const calls = (await call("GET", "/api/mock/sent")).body.items;
  assert.equal(calls.length, 3);
  assert.ok(calls.every((x) => x.correlation_id === a.id));
});
test("AC-I-01-05 four failed sends exhaust retries", async () => {
  const a = await setup([503, 503, 503, 503]);
  await run();
  await run(5);
  await run(30);
  await run(120);
  assert.equal(
    (await pool.query("SELECT status FROM attempts WHERE id=$1", [a.id]))
      .rows[0].status,
    "failed",
  );
  await run(180);
  assert.equal((await call("GET", "/api/mock/sent")).body.items.length, 4);
});
test("AC-I-01-06 timeout retry preserves the correlation ID", async () => {
  const a = await setup(["timeout", 202]);
  await run();
  await run(5);
  const calls = (await call("GET", "/api/mock/sent")).body.items;
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((x) => x.correlation_id),
    [a.id, a.id],
  );
});
