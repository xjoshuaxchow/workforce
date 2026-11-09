import { test } from "node:test";
import assert from "node:assert/strict";
import * as client from "../src/api.js";

test("G-08 selector loader follows every page beyond 200 and preserves query filters", async () => {
  assert.equal(typeof client.loadAllPages, "function");
  const items = Array.from({ length: 451 }, (_, i) => ({
    id: String(i),
    name: "Staff " + i,
  }));
  const seen = [];
  const result = await client.loadAllPages(
    "/staff?site=abc&status=active",
    async (path) => {
      const u = new URL(path, "http://local");
      seen.push(u);
      const page = Number(u.searchParams.get("page")),
        limit = Number(u.searchParams.get("limit"));
      return {
        items: items.slice((page - 1) * limit, page * limit),
        total: items.length,
        page,
        limit,
      };
    },
  );
  assert.equal(result.items.length, 451);
  assert.equal(result.items.at(-1).id, "450");
  assert.equal(seen.length, 3);
  assert.ok(
    seen.every(
      (u) =>
        u.searchParams.get("site") === "abc" &&
        u.searchParams.get("status") === "active",
    ),
  );
});
test("G-08 failed or truncated pages cannot masquerade as a complete selector", async () => {
  assert.equal(typeof client.loadAllPages, "function");
  await assert.rejects(
    () =>
      client.loadAllPages("/staff", async (path) =>
        new URL(path, "http://local").searchParams.get("page") === "1"
          ? { items: [{ id: "1" }], total: 300, limit: 200 }
          : { items: [], total: 300, limit: 200 },
      ),
    /incomplete|完整|truncated/i,
  );
});
