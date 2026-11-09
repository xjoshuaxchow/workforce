import { test } from "node:test";
import assert from "node:assert/strict";
test("Browser mutations require a known mode and include the observed mode header", async () => {
  const { api } = await import("../src/api.js?mode-guard");
  const previous = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () =>
        path.endsWith("/messaging/status") ? { mode: "mock" } : { ok: true },
    };
  };
  try {
    await assert.rejects(
      () => api("/staff", { method: "POST", body: {} }),
      /傳送模式未確認/,
    );
    assert.equal(calls.length, 0);
    await api("/auth/login", { method: "POST", body: {} });
    assert.equal(calls.length, 1);
    await api("/messaging/status");
    await api("/staff", { method: "POST", body: {} });
    assert.equal(
      calls.at(-1).options.headers["X-Workforce-Messaging-Mode"],
      "mock",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
