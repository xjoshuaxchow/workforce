import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { MetaClient } from "./meta.js";
import { MediaStore } from "./media/store.js";
import { logger } from "./logger.js";
async function main() {
  const config = await loadConfig();
  const pool = await createPool();
  const meta = new MetaClient(config);
  const media = new MediaStore(pool, config, meta);
  await pool.query("SELECT 1");
  const server = createApp({ pool, config, meta, media }).listen(
    config.port,
    "0.0.0.0",
    () => logger.info({ port: config.port }, "API listening"),
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 40000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
main().catch(() => {
  logger.fatal(
    "API startup failed; check environment settings, generated credentials, and database connectivity",
  );
  process.exit(1);
});
