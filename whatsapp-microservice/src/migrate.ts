import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type pg from "pg";
export async function migrate(
  pool: pg.Pool,
  directory = resolve("migrations"),
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(734928102)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const filename of (await readdir(directory))
      .filter((x) => /^\d+_[a-z0-9_]+\.sql$/.test(x))
      .sort()) {
      const sql = await readFile(join(directory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version=$1",
        [filename],
      );
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum)
          throw new Error(`Applied migration checksum changed: ${filename}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
          [filename, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(734928102)").catch(() => {});
    client.release();
  }
}
