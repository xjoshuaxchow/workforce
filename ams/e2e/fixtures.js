import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const test = base.extend({
  isolatedWorkforce: [
    async ({}, use) => {
      const dir = resolve(
        process.env.WORKFORCE_API_DIR ?? "../api",
      );
      const env = parseEnv(await readFile(resolve(dir, ".env"), "utf8"));
      const url = new URL(env.TEST_DATABASE_URL);
      if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
        throw Error("E2E isolation requires the local dedicated test database");
      const [{ createPool }, { resetTestData }, { hashPassword }] =
        await Promise.all(
          ["src/db.js", "test/test-db.js", "src/security.js"].map(
            (p) => import(pathToFileURL(resolve(dir, p)).href),
          ),
        );
      const pool = createPool(url.toString());
      try {
        await resetTestData(pool);
        await pool.query(
          "INSERT INTO users(email,name,password_hash,role) VALUES('ui-admin@test.local','UI Admin',$1,'admin')",
          [await hashPassword("Local-test-password-123")],
        );
      } finally {
        await pool.end();
      }
      await use();
    },
    { auto: true },
  ],
});
export { expect };
