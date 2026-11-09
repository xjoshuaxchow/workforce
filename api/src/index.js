import { createPool, migrate } from "./db.js";
import { createApp } from "./app.js";
import { startWorker } from "./worker.js";
import { parsePstnConfig } from "./twilio-pstn.js";
import {
  createChannelSettings,
  loadSettingsKey,
  initialChannelConfig,
} from "./channel-settings.js";
import { createChannelRuntime } from "./channel-runtime.js";
import { parseWhatsAppConfig } from "./whatsapp-client.js";

if (!process.env.DATABASE_URL) {
  parseWhatsAppConfig();
  parsePstnConfig();
}
const pool = createPool(process.env.DATABASE_URL);
await migrate(pool);
const key = await loadSettingsKey(pool);
const settings = createChannelSettings({
  pool,
  key,
  initial: () => initialChannelConfig(),
});
const current = await settings.current();
// Legacy pending work inherits the bootstrap configuration, never a later enable.
for (const table of ["attempts", "voice_calls", "whatsapp_submissions"])
  await pool.query(
    `UPDATE ${table} SET settings_version_id=$1 WHERE settings_version_id IS NULL`,
    [current.id],
  );
await pool.query(
  "UPDATE attempts SET language_snapshot=coalesce(payload->>'language',(SELECT language FROM staff WHERE id=attempts.staff_id)) WHERE language_snapshot IS NULL",
);
const runtime = createChannelRuntime({ pool, settings });
const pstn = runtime.pstn,
  whatsapp = runtime.whatsapp;
const port = Number(process.env.PORT ?? 8310),
  host = process.env.HOST ?? "127.0.0.1";
let stopWorker = async () => {};
const server = createApp({
  pool,
  settings,
  runtime,
  origin: process.env.AMS_ORIGIN,
  pstn,
}).listen(port, host);
server.once("listening", async () => {
  const state = await runtime.status();
  stopWorker = startWorker({ pool, pstn, whatsapp });
  console.log(
    JSON.stringify({
      level: "info",
      event: "server.started",
      host,
      port,
      messaging: state.mode,
      whatsapp: state.whatsapp,
    }),
  );
});
server.on("error", async (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "server.failed",
      code: error.code,
    }),
  );
  await stopWorker();
  await pool.end();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close(async () => {
      await stopWorker();
      await pool.end();
      process.exit(0);
    });
  });
