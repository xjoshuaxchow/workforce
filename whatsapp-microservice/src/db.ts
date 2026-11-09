import pg from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { storagePaths } from "./config.js";
export type Database = pg.Pool;
export type Client = pg.PoolClient;
export async function createPool(): Promise<pg.Pool> {
  const password = (
    await readFile(join(storagePaths().configPath, "postgres-password"), "utf8")
  ).trim();
  const pool = new pg.Pool({
    host: process.env.PGHOST ?? "db",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "whatsapp",
    database: process.env.PGDATABASE ?? "whatsapp",
    password,
    max: 15,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () => {
    console.error("PostgreSQL idle connection failed");
  });
  return pool;
}
export async function transaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
