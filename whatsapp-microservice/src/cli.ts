import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { initialize } from "./bootstrap.js";
import { storagePaths } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
async function main() {
  const command = process.argv[2];
  const paths = storagePaths();
  if (command === "init") {
    await initialize(paths.configPath, paths.mediaPath);
    return;
  }
  if (command === "api-key") {
    process.stdout.write(
      await readFile(join(paths.configPath, "api-key"), "utf8"),
    );
    return;
  }
  if (command === "health") {
    const response = await fetch("http://127.0.0.1:3000/health/ready", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Not ready");
    return;
  }
  const pool = await createPool();
  try {
    if (command === "migrate") {
      await migrate(pool);
      return;
    }
    if (command === "worker-health") {
      const result = await pool.query(
        "SELECT 1 FROM worker_heartbeats WHERE id=$1 AND seen_at>now()-interval '45 seconds'",
        [hostname()],
      );
      if (!result.rowCount) throw new Error("Worker heartbeat missing");
      return;
    }
    throw new Error("Unknown command");
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    `Command failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
