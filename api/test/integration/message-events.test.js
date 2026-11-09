import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createPool, migrate } from "../../src/db.js";
import { createApp } from "../../src/app.js";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test database required");
const pool = createPool(url.toString()),
  secret = "local-test-message-secret";
let server, base;
const now = new Date("2026-11-02T06:00:00Z");
before(async () => {
  await migrate(pool);
  server = createApp({
    pool,
    clock: () => now,
    messagingSecret: secret,
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});
async function send(body, { offset = 0, bad = false, missing = false } = {}) {
  const raw = JSON.stringify(body),
    timestamp = String(Math.floor(now.getTime() / 1000) + offset);
  const signature = createHmac("sha256", secret)
    .update(timestamp + "." + raw)
    .digest("hex");
  return fetch(base + "/integrations/messaging/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(!missing
        ? {
            "X-Timestamp": timestamp,
            "X-Signature": bad ? "00".repeat(32) : signature,
          }
        : {}),
    },
    body: raw,
  });
}
test("AC-I-03-01 and AC-W-04-04 signed unmatched event is persisted and acknowledged without user login", async () => {
  const event_id = randomUUID();
  assert.equal(
    (
      await send({
        event_id,
        type: "reply",
        correlation_id: "not-known",
        option_id: "ACCEPT",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT processed FROM message_events WHERE event_id=$1",
        [event_id],
      )
    ).rows[0].processed,
    true,
  );
});
test("AC-I-03-02/03/04 invalid signatures never become business events", async () => {
  for (const options of [{ bad: true }, { missing: true }, { offset: -360 }]) {
    const event_id = randomUUID();
    assert.equal(
      (
        await send(
          { event_id, type: "reply", correlation_id: "not-known" },
          options,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await pool.query("SELECT 1 FROM message_deliveries WHERE event_id=$1", [
          event_id,
        ])
      ).rowCount,
      0,
    );
  }
});
test("AC-RH-04-01 duplicate deliveries keep both raw receipts and one logical event", async () => {
  const event_id = randomUUID(),
    body = { event_id, type: "unknown", correlation_id: "not-known" };
  for (let i = 0; i < 2; i++) assert.equal((await send(body)).status, 200);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM message_deliveries WHERE event_id=$1",
        [event_id],
      )
    ).rows[0].count,
    "2",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM message_events WHERE event_id=$1",
        [event_id],
      )
    ).rows[0].count,
    "1",
  );
});
test("AC-I-02-02 malformed event returns field validation error", async () =>
  assert.equal(
    (await send({ type: "reply", correlation_id: "not-known" })).status,
    400,
  ));
