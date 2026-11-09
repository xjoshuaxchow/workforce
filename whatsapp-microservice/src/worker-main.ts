import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { MetaClient } from "./meta.js";
import { MediaStore } from "./media/store.js";
import { Worker } from "./worker.js";
import { logger } from "./logger.js";
async function main() {
  const config = await loadConfig();
  const pool = await createPool();
  const meta = new MetaClient(config);
  const media = new MediaStore(pool, config, meta);
  const worker = new Worker({ pool, config, meta, media });
  let stopped = false;
  const heartbeat = async () => {
    await pool.query(
      "INSERT INTO worker_heartbeats(id,seen_at) VALUES($1,now()) ON CONFLICT(id) DO UPDATE SET seen_at=now()",
      [hostname()],
    );
  };
  await heartbeat();
  const timer = setInterval(() => {
    void heartbeat().catch(() => logger.error("Worker heartbeat failed"));
  }, 10000);
  const stop = () => {
    stopped = true;
    setTimeout(() => process.exit(1), 40000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  logger.info({ concurrency: config.concurrency }, "Worker started");
  await Promise.all(
    Array.from({ length: config.concurrency }, async () => {
      while (!stopped) {
        try {
          if (!(await worker.runOnce())) await delay(500);
        } catch {
          logger.error(
            "Worker iteration failed; outstanding leases will recover",
          );
          await delay(1000);
        }
      }
    }),
  );
  clearInterval(timer);
  await pool.query("DELETE FROM worker_heartbeats WHERE id=$1", [hostname()]);
  await pool.end();
}
main().catch(() => {
  logger.fatal(
    "Worker startup failed; check environment settings and database connectivity",
  );
  process.exit(1);
});
