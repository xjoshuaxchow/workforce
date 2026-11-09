import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const state = JSON.parse(
  await readFile("/data/media/smoke-state.json", "utf8"),
);
const key = (await readFile("/run/service-config/api-key", "utf8")).trim();
const password = await readFile(
  "/run/service-config/postgres-password",
  "utf8",
);
assert.equal(createHash("sha256").update(key).digest("hex"), state.keyHash);
assert.equal(
  createHash("sha256").update(password).digest("hex"),
  state.passwordHash,
);
const headers = { Authorization: `Bearer ${key}` };
const base = "http://127.0.0.1:3000";
const message = await fetch(base + "/v1/messages/" + state.messageId, {
  headers,
});
assert.equal(message.status, 200);
assert.equal((await message.json()).submission_status, "queued");
const listing = await fetch(base + "/v1/messages?direction=inbound", {
  headers,
});
assert.equal((await listing.json()).data.length, 1);
const file = await fetch(base + "/v1/media/" + state.mediaId + "/content", {
  headers,
});
assert.equal(file.status, 200);
assert.equal(await file.text(), "persistent smoke media");
console.log(
  "Verified database, queued jobs, media, and credentials survived container recreation.",
);
