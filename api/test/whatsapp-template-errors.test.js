import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { registerWhatsAppTemplates } from "../src/whatsapp-template-admin.js";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return "http://127.0.0.1:" + server.address().port;
}

async function requestTemplates(t, status, body, create = false) {
  const upstream = createServer((req, res) => {
    assert.equal(req.method, create ? "POST" : "GET");
    assert.equal(req.url, create ? "/v1/templates" : "/v1/templates?language=en_US&limit=50");
    assert.equal(req.headers.authorization, "Bearer fixture-service-key");
    if (status === 0) return res.destroy();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  const url = await listen(upstream);
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const settings = {
    async current() { return { config: { whatsapp: { mode: "mock", url, key: "fixture-service-key" } } }; },
    register(app) { registerWhatsAppTemplates(app, { settings }); },
  };
  const pool = {
    async query(sql) {
      assert.match(sql, /^SELECT u\.\*,s\.id AS session_id/);
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", role: "admin", active: true }] };
    },
  };
  const server = createApp({ pool, settings }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/settings/whatsapp/templates" + (create ? "" : "?language=en_US"), {
    method: create ? "POST" : "GET",
    headers: { authorization: "Bearer fixture-session", "content-type": "application/json" },
    ...(create ? { body: JSON.stringify({
      name: "invite_job", language: "en_US", category: "UTILITY",
      body: "Hello {{1}}, your shift at {{2}} is on {{3}}, from {{4}} to {{5}}.",
      examples: ["Anna", "North Depot", "10 Nov 2099", "07:00", "15:00"], offer: true,
    }) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

// Removing the WhatsApp error translation must fail these real HTTP route tests.
for (const scenario of [
  { name: "expired Meta token", expectedStatus: 400, status: 502, code: "META_ERROR", details: { code: 190, error_subcode: 463 }, reason: "whatsapp_access_token_invalid", hint: /WHATSAPP_ACCESS_TOKEN/ },
  { name: "wrong Meta resource", expectedStatus: 400, status: 422, code: "META_ERROR", details: { code: 100 }, reason: "whatsapp_meta_request_invalid", hint: /WABA/ },
  { name: "missing Meta permission", expectedStatus: 400, status: 502, code: "META_ERROR", details: { code: 200 }, reason: "whatsapp_meta_permission_denied", hint: /權限/ },
  { name: "microservice authentication failure", expectedStatus: 400, status: 401, code: "UNAUTHORIZED", reason: "whatsapp_service_auth_failed", hint: /API key/ },
  { name: "unreachable microservice", expectedStatus: 502, status: 0, code: "UNAVAILABLE", reason: "whatsapp_service_unavailable", hint: /服務網址/ },
  { name: "untrusted Meta error code", expectedStatus: 502, status: 502, code: "META_ERROR", details: { code: "190 fixture-private-token" }, reason: "whatsapp_meta_error", hint: /Meta/ },
  { name: "unclassified Meta failure", expectedStatus: 502, status: 502, code: "META_ERROR", details: { code: 987654 }, reason: "whatsapp_meta_error", hint: /Meta/ },
]) {
  test("Template listing explains " + scenario.name + " without exposing upstream secrets", async t => {
    const result = await requestTemplates(t, scenario.status, {
      error: {
        code: scenario.code,
        message: "fixture-private-token in untrusted upstream text",
        details: { ...scenario.details, message: "fixture-private-token", access_token: "fixture-private-token" },
      },
    });
    assert.equal(result.status, scenario.expectedStatus);
    assert.equal(result.body.reason, scenario.reason);
    assert.match(result.body.message, scenario.hint);
    assert.ok(!JSON.stringify(result).includes("fixture-private-token"));
    assert.ok(!JSON.stringify(result).includes("fixture-service-key"));
  });
}

test("Template listing remains available in mock mode and returns approved template data", async t => {
  const body = { data: [{ id: "123", name: "hello_world", language: "en_US", status: "APPROVED" }], nextCursor: null };
  const result = await requestTemplates(t, 200, body);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, body);
});


test("Template creation returns Meta's actionable variable-ratio rejection", async t => {
  const result = await requestTemplates(t, 422, { error: { code: "META_ERROR", message: "Meta rejected the operation", details: {
    code: 100,
    message: "Invalid parameter",
    error_user_title: "Parameters words ratio exceeds limit",
    error_user_msg: "This template has too many variables for its length. Reduce the number of variables or increase the message length.",
  } } }, true);
  assert.equal(result.status, 400);
  assert.equal(result.body.reason, "whatsapp_meta_request_invalid");
  assert.ok(Array.isArray(result.body.errors), "Meta rejection must include its actionable explanation");
  assert.ok(result.body.errors.some(error => error.message.includes("Parameters words ratio exceeds limit")));
  assert.ok(result.body.errors.some(error => error.message.includes("increase the message length")));
  assert.ok(!result.body.message.includes("WABA"));
});

test("Meta's user-facing template error excludes service keys, credential links and raw error data", async t => {
  const result = await requestTemplates(t, 422, { error: { code: "META_ERROR", details: {
    code: 100,
    message: "raw-fixture-private-data",
    error_user_title: "Invalid template fixture-service-key",
    error_user_msg: "Use more text. Bearer fixture-hidden-token See https://example.test/?access_token=fixture-url-token",
    access_token: "raw-fixture-private-data",
  } } }, true);
  assert.equal(result.status, 400);
  assert.ok(Array.isArray(result.body.errors), "Sanitized Meta explanation must be retained");
  assert.match(JSON.stringify(result.body.errors), /Use more text/);
  for (const secret of ["fixture-service-key", "fixture-hidden-token", "fixture-url-token", "raw-fixture-private-data"])
    assert.ok(!JSON.stringify(result).includes(secret));
});
