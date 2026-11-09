import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createPool } from "./dist/db.js";
const key = (await readFile("/run/service-config/api-key", "utf8")).trim();
const password = await readFile(
  "/run/service-config/postgres-password",
  "utf8",
);
const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};
const base = "http://127.0.0.1:3000";
assert.equal((await fetch(base + "/health/ready")).status, 200);
assert.equal((await fetch(base + "/v1/messages")).status, 401);
assert.equal((await fetch(base + "/v1/openapi.json", { headers })).status, 200);
const send = await fetch(base + "/v1/messages", {
  method: "POST",
  headers: { ...headers, "Idempotency-Key": "smoke" },
  body: JSON.stringify({
    to: "85291234567",
    type: "text",
    text: { body: "Queued smoke fixture" },
  }),
});
assert.equal(send.status, 202);
const queued = await send.json();
const pool = await createPool();
await pool.query("UPDATE jobs SET available_at=now()+interval '1 day'");
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "456",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "789" },
            messages: [
              {
                id: "wamid.smoke",
                from: "85291234567",
                timestamp: "1750000000",
                type: "text",
                text: { body: "Incoming smoke fixture" },
              },
            ],
          },
        },
      ],
    },
  ],
});
assert.equal(
  (
    await fetch(base + "/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256":
          "sha256=" +
          createHmac("sha256", "smoke-only-secret").update(body).digest("hex"),
      },
      body,
    })
  ).status,
  200,
);
const filename = randomUUID();
await writeFile("/data/media/" + filename, "persistent smoke media");
const media = (
  await pool.query(
    "INSERT INTO media(kind,status,filename,mime_type,size) VALUES('document','ready',$1,'text/plain',22) RETURNING id",
    [filename],
  )
).rows[0];
await pool.end();
await writeFile(
  "/data/media/smoke-state.json",
  JSON.stringify({
    keyHash: createHash("sha256").update(key).digest("hex"),
    passwordHash: createHash("sha256").update(password).digest("hex"),
    messageId: queued.messageIds[0],
    mediaId: media.id,
  }),
);
console.log("Seeded isolated smoke state without sending to Meta.");
