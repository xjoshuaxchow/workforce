import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
export function createPool(connectionString) {
  if (!connectionString) throw Error("DATABASE_URL is required");
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
}
export async function transaction(pool, operation) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await operation(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function migrate(pool) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(8310001)");
    for (const file of (await readdir(new URL("../sql/", import.meta.url)))
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await db.query(
        await readFile(new URL(`../sql/${file}`, import.meta.url), "utf8"),
      );
  });
}
