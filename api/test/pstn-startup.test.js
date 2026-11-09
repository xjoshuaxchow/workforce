import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("PSTN startup rejects missing configuration before connecting to a database", () => {
  const result = spawnSync(process.execPath, ["src/index.js"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, MESSAGING_MODE: "twilio-pstn" },
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TWILIO_ACCOUNT_SID is required/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
});
