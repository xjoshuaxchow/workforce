import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("WhatsApp service startup requires its own configuration before connecting to database", () => {
  const r = spawnSync(process.execPath, ["src/index.js"], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      PATH: process.env.PATH,
      MESSAGING_MODE: "mock",
      WHATSAPP_MODE: "service",
    },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /WHATSAPP_SERVICE_URL/);
  assert.doesNotMatch(r.stderr, /ECONNREFUSED/);
});
