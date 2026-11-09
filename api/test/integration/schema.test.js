import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
const url = new URL(process.env.TEST_DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Integration tests require a local dedicated *_test database");
const pool = createPool(url.toString());
before(() => migrate(pool));
after(() => pool.end());
test("AC-G-01b-04 business schema uses timestamptz and required record times", async () => {
  const { rows } = await pool.query(
    "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public'",
  );
  for (const name of [
    "users",
    "sessions",
    "sites",
    "site_managers",
    "staff",
    "site_staff",
    "audit_log",
  ]) {
    for (const field of ["ctime", "utime"]) {
      const found = rows.find(
        (x) => x.table_name === name && x.column_name === field,
      );
      assert.ok(found, `${name}.${field} must exist`);
      assert.equal(found.data_type, "timestamp with time zone");
      assert.equal(found.is_nullable, "NO");
    }
  }
});
