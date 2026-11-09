import { resetTestData } from "../test/test-db.js";
import { createPool, migrate } from "../src/db.js";
import { hashPassword } from "../src/security.js";
import { createApp } from "../src/app.js";
import { createChannelSettings } from "../src/channel-settings.js";
import { createChannelRuntime } from "../src/channel-runtime.js";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("E2E requires dedicated local test database");
const pool = createPool(url.toString());
await migrate(pool);
await resetTestData(pool);
await pool.query(
  "INSERT INTO users(email,name,password_hash,role) VALUES('ui-admin@test.local','UI Admin',$1,'admin')",
  [await hashPassword("Local-test-password-123")],
);
// External synthesis is replaced only at its provider boundary in browser tests.
const testMp3 = Buffer.concat(Array.from({ length: 2 }, () => {
  const frame = Buffer.alloc(417); Buffer.from([0xff, 0xfb, 0x90, 0]).copy(frame); return frame;
}));
const uncertain = new Set();
const localFailures = new Set();
const settings = createChannelSettings({ pool, key: Buffer.alloc(32, 7), localClientFactory: () => ({
  status: async () => ({ installed: true, languages: ["yue", "en"] }),
  synthesize: async descriptor => {
    if (descriptor.script.includes("LOCAL_TEST_FAILURE") && !localFailures.has(descriptor.hash)) {
      localFailures.add(descriptor.hash); throw Error("Private local failure");
    }
    return testMp3;
  },
}), azureClientFactory: () => ({ synthesize: async descriptor => {
  if (descriptor.script.includes("AZURE_TEST_UNCERTAIN") && !uncertain.has(descriptor.hash)) {
    uncertain.add(descriptor.hash);
    throw Object.assign(Error("Fake interrupted generation"), { uncertain: true });
  }
  return testMp3;
} }) });
const runtime = createChannelRuntime({ pool, settings });
const server = createApp({
  pool,
  settings,
  runtime,
  pstn: runtime.pstn,
}).listen(8311, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
