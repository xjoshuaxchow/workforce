import { test } from "node:test";
import assert from "node:assert/strict";

for (const status of [200, 502, 503]) {
  test(`HTML response with HTTP ${status} shows a safe HTTP error instead of a JSON SyntaxError`, async t => {
    const { api } = await import(`../src/api.js?html-${status}`);
    t.mock.method(globalThis, "fetch", async () => new Response("<!DOCTYPE html><p>untrusted-fixture-content</p>", { status }));
    await assert.rejects(() => api("/settings/whatsapp/templates"), error => {
      assert.equal(error.status, status);
      assert.equal(error.reason, "invalid_api_response");
      assert.match(error.message, new RegExp(String(status)));
      assert.ok(!error.message.includes("Unexpected token"));
      assert.ok(!error.message.includes("untrusted-fixture-content"));
      return true;
    });
  });
}

for (const failure of ["html", "network"]) {
  test(`A ${failure} failure refreshing messaging mode blocks later mutations`, async t => {
    const { api } = await import(`../src/api.js?mode-failure-${failure}`);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      if (requests === 1) return Response.json({ mode: "mock", configuration_revision: "fixture-version" });
      if (failure === "network") throw new TypeError("fixture network failure");
      return new Response("<!DOCTYPE html>", { status: 502 });
    });
    await api("/messaging/status");
    await assert.rejects(() => api("/messaging/status"));
    await assert.rejects(() => api("/staff", { method: "POST", body: {} }), /傳送模式未確認/);
    assert.equal(requests, 2);
  });
}

test("An HTML 401 response still triggers the sign-in event", async t => {
  const { api } = await import("../src/api.js?unauthorized-html");
  const events = [];
  const previous = globalThis.window;
  globalThis.window = { dispatchEvent(event) { events.push(event.type); } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  t.mock.method(globalThis, "fetch", async () => new Response("<!DOCTYPE html>", { status: 401 }));
  await assert.rejects(() => api("/staff"), error => error.status === 401);
  assert.deepEqual(events, ["workforce:unauthorized"]);
});

test("JSON channel errors retain their actionable message and reason", async t => {
  const { api } = await import("../src/api.js?json-channel-error");
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Meta Access Token 已過期", reason: "whatsapp_access_token_invalid" }, { status: 400 }));
  await assert.rejects(() => api("/settings/whatsapp/templates"), error => {
    assert.equal(error.message, "Meta Access Token 已過期");
    assert.equal(error.reason, "whatsapp_access_token_invalid");
    assert.equal(error.status, 400);
    return true;
  });
});
