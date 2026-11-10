import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
let wa = {};
try {
  wa = await import("../src/whatsapp-client.js");
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
const names = [
  "shift_offer_v1",
  "shift_confirmed_v1",
  "shift_unavailable_v1",
  "shift_cancelled_v1",
  "roster_published_v1",
  "roster_changed_v1",
];
export const templates = Object.fromEntries(
  names.map((name) => [
    name,
    {
      name,
      language: "en",
      body: ["staff_name", "site_name"],
      ...(name === "shift_offer_v1"
        ? { buttons: { accept: 0, decline: 1 } }
        : {}),
    },
  ]),
);
const env = {
  WHATSAPP_MODE: "service",
  WHATSAPP_SERVICE_URL: "http://127.0.0.1:8080",
  WHATSAPP_SERVICE_API_KEY: "test-key",
};
test("WhatsApp config defaults to mock and explicit service mode requires safe URL key and complete templates", () => {
  assert.equal(typeof wa.parseWhatsAppConfig, "function");
  assert.deepEqual(wa.parseWhatsAppConfig({}), { mode: "mock" });
  const config = wa.parseWhatsAppConfig(env, templates);
  assert.equal(config.mode, "service");
  for (const key of ["WHATSAPP_SERVICE_URL", "WHATSAPP_SERVICE_API_KEY"])
    assert.throws(
      () => wa.parseWhatsAppConfig({ ...env, [key]: "" }, templates),
      new RegExp(key),
    );
  assert.throws(
    () =>
      wa.parseWhatsAppConfig(
        { ...env, WHATSAPP_SERVICE_URL: "https://user:password@wa.test" },
        templates,
      ),
    /WHATSAPP_SERVICE_URL/,
  );
  assert.throws(() => wa.parseWhatsAppConfig(env, {}), /template/i);
  assert.throws(
    () =>
      wa.parseWhatsAppConfig(env, {
        ...templates,
        shift_offer_v1: { ...templates.shift_offer_v1, body: ["password"] },
      }),
    /template/i,
  );
});
test("WhatsApp maps uniform payload into positional template and Attempt-specific quick replies", () => {
  assert.equal(typeof wa.buildWhatsAppMessage, "function");
  const id = "11111111-1111-4111-8111-111111111111";
  const payload = {
    correlation_id: id,
    to: "+6591234567",
    template: "shift_offer_v1",
    variables: { staff_name: "Anna", site_name: "Depot" },
    options: [{ id: "ACCEPT" }, { id: "DECLINE" }],
  };
  const message = wa.buildWhatsAppMessage(payload, templates);
  assert.equal(message.to, "6591234567");
  assert.equal(message.template.language, "en");
  assert.deepEqual(message.template.components[0], {
    type: "body",
    parameters: [
      { type: "text", text: "Anna" },
      { type: "text", text: "Depot" },
    ],
  });
  assert.equal(
    message.template.components[1].parameters[0].payload,
    "workforce:" + id + ":ACCEPT",
  );
  assert.equal(message.template.components[2].sub_type, "quick_reply");
  assert.equal(
    wa.buildWhatsAppMessage(
      { ...payload, template: "shift_confirmed_v1", options: undefined },
      templates,
    ).template.components.length,
    1,
  );
});
test("WhatsApp only maps scoped quick-reply payloads and leaves text replies uninterpreted", () => {
  assert.equal(typeof wa.parseWhatsAppReply, "function");
  const id = "11111111-1111-4111-8111-111111111111";
  const message = {
    from: "6591234567",
    type: "button",
    button: { payload: "workforce:" + id + ":ACCEPT" },
    context: { id: "wamid.offer" },
  };
  assert.deepEqual(wa.parseWhatsAppReply(message), {
    attemptId: id,
    optionId: "ACCEPT",
    sender: "6591234567",
    contextId: "wamid.offer",
  });
  assert.equal(
    wa.parseWhatsAppReply({ ...message, type: "text", text: { body: "Yes" } }),
    null,
  );
  assert.equal(
    wa.parseWhatsAppReply({ ...message, button: { payload: "ACCEPT" } }),
    null,
  );
});
test("WhatsApp status mapping keeps Meta unknown visible without claiming delivery", () => {
  assert.equal(typeof wa.whatsAppStatus, "function");
  assert.equal(
    wa.whatsAppStatus({ submission_status: "unknown" }),
    "submission_unknown",
  );
  for (const status of ["sent", "delivered", "read", "failed"])
    assert.equal(
      wa.whatsAppStatus({
        submission_status: "accepted",
        delivery_status: status,
      }),
      status,
    );
});
test("WhatsApp HTTP client follows the supplied Bearer v1 and idempotency contract without redirects or credential errors", async () => {
  assert.equal(typeof wa.createWhatsAppClient, "function");
  const received = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    received.push({ url: req.url, headers: req.headers, raw });
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/fail") {
      res.writeHead(503);
      res.end(
        JSON.stringify({
          error: { code: "SERVICE_DOWN", message: "contains-test-key" },
        }),
      );
    } else if (req.url === "/v1/redirect") {
      res.writeHead(302, { location: "/v1/unexpected" });
      res.end("{}");
    } else
      res.end(
        JSON.stringify({
          messageIds: ["11111111-1111-4111-8111-111111111111"],
        }),
      );
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const client = wa.createWhatsAppClient({
      ...env,
      url: "http://127.0.0.1:" + server.address().port,
      key: "test-key",
    });
    await client.request("POST", "/messages", {
      data: { to: "6591234567" },
      key: "workforce:attempt",
    });
    assert.equal(received[0].url, "/v1/messages");
    assert.equal(received[0].headers.authorization, "Bearer test-key");
    assert.equal(received[0].headers["idempotency-key"], "workforce:attempt");
    await assert.rejects(
      () => client.request("GET", "/fail"),
      (e) =>
        e.retryable === true &&
        !e.message.includes("test-key") &&
        !JSON.stringify(e).includes("test-key"),
    );
    await assert.rejects(() => client.request("GET", "/redirect"));
    assert.equal(received.length, 3);
  } finally {
    await new Promise((r) => server.close(r));
  }
});


test("WhatsApp real connection can be configured independently of template mappings", () => {
  assert.equal(typeof wa.parseWhatsAppConnection, "function");
  assert.deepEqual(wa.parseWhatsAppConnection({}), { mode: "mock" });
  assert.deepEqual(wa.parseWhatsAppConnection(env), { mode: "service", url: "http://127.0.0.1:8080", key: "test-key" });
  for (const missing of ["WHATSAPP_SERVICE_URL", "WHATSAPP_SERVICE_API_KEY"])
    assert.throws(() => wa.parseWhatsAppConnection({ ...env, [missing]: "" }));
  assert.throws(() => wa.parseWhatsAppConnection({ ...env, WHATSAPP_SERVICE_URL: "http://wa.test/v1" }));
  assert.throws(() => wa.parseWhatsAppConnection({ ...env, WHATSAPP_SERVICE_API_KEY: "key\nheader" }));
});

test("Missing template names stop message construction before provider submission", () => {
  const incomplete = { ...templates, shift_offer_v1: { ...templates.shift_offer_v1, name: "" } };
  assert.throws(() => wa.buildWhatsAppMessage({ template: "shift_offer_v1", to: "+15005550006", variables: { staff_name: "Anna", site_name: "Depot" }, options: [] }, incomplete), error => {
    assert.equal(error.code, "missing_whatsapp_template");
    assert.equal(error.retryable, false);
    return true;
  });
});


test("Configured WhatsApp mappings still require distinct offer buttons and information-only notifications", () => {
  assert.equal(typeof wa.parseWhatsAppTemplate, "function");
  assert.throws(() => wa.parseWhatsAppTemplate("shift_offer_v1", { ...templates.shift_offer_v1, buttons: { accept: 0, decline: 0 } }), /distinct/);
  assert.throws(() => wa.parseWhatsAppTemplate("shift_confirmed_v1", { ...templates.shift_confirmed_v1, buttons: { accept: 0, decline: 1 } }), /Info-only/);
  assert.equal(wa.parseWhatsAppTemplate("shift_offer_v1", templates.shift_offer_v1).name, "shift_offer_v1");
});
