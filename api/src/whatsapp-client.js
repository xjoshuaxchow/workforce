import { readFileSync } from "node:fs";
import { z } from "zod";
const templateNames = [
  "shift_offer_v1",
  "shift_confirmed_v1",
  "shift_unavailable_v1",
  "shift_cancelled_v1",
  "roster_published_v1",
  "roster_changed_v1",
];
const variable = z.enum([
  "staff_name",
  "site_name",
  "site_address",
  "date",
  "start_time",
  "end_time",
  "message",
  "shifts",
  "old_date",
  "old_start_time",
  "old_end_time",
  "change",
]);
const definition = z
  .object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
    body: z.array(variable).max(100),
    buttons: z
      .object({
        accept: z.number().int().min(0).max(9),
        decline: z.number().int().min(0).max(9),
      })
      .strict()
      .optional(),
  })
  .strict();
export function parseWhatsAppConfig(env = process.env, definitions) {
  const mode = env.WHATSAPP_MODE ?? "mock";
  if (mode === "mock") return { mode };
  if (mode !== "service") throw Error("WHATSAPP_MODE must be mock or service");
  const required = (name) => {
    const value = env[name]?.trim();
    if (!value) throw Error(name + " is required");
    return value;
  };
  let url;
  try {
    url = new URL(required("WHATSAPP_SERVICE_URL"));
  } catch {
    throw Error("WHATSAPP_SERVICE_URL must be a service origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error(
      "WHATSAPP_SERVICE_URL must be a service origin without credentials",
    );
  const key = required("WHATSAPP_SERVICE_API_KEY");
  if (/[\r\n]/.test(key)) throw Error("WHATSAPP_SERVICE_API_KEY is invalid");
  if (definitions === undefined) {
    try {
      definitions = JSON.parse(
        readFileSync(required("WHATSAPP_TEMPLATES_FILE"), "utf8"),
      );
    } catch {
      throw Error(
        "WHATSAPP_TEMPLATES_FILE must contain valid template configuration",
      );
    }
  }
  const parsed = z
    .object(Object.fromEntries(templateNames.map((name) => [name, definition])))
    .strict()
    .safeParse(definitions);
  if (!parsed.success)
    throw Error("WhatsApp template configuration is invalid or incomplete");
  const offer = parsed.data.shift_offer_v1.buttons;
  if (!offer || offer.accept === offer.decline)
    throw Error(
      "WhatsApp offer template needs distinct accept and decline buttons",
    );
  for (const name of templateNames.slice(1))
    if (parsed.data[name].buttons)
      throw Error(
        "Info-only WhatsApp templates must not contain reply buttons",
      );
  return { mode, url: url.origin, key, templates: parsed.data };
}
export function buildWhatsAppMessage(payload, templates) {
  const template = templates[payload.template];
  if (!template) throw Error("WhatsApp template is not configured");
  const components = [];
  if (template.body.length)
    components.push({
      type: "body",
      parameters: template.body.map((name) => {
        const value = payload.variables[name];
        if (typeof value !== "string")
          throw Error("WhatsApp template variable is unavailable: " + name);
        return { type: "text", text: value };
      }),
    });
  if (payload.options?.length) {
    if (!template.buttons)
      throw Error("WhatsApp offer template needs reply buttons");
    for (const [option, index] of [
      ["ACCEPT", template.buttons.accept],
      ["DECLINE", template.buttons.decline],
    ])
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [
          {
            type: "payload",
            payload: `workforce:${payload.correlation_id}:${option}`,
          },
        ],
      });
  }
  return {
    to: payload.to.replace(/^\+/, ""),
    type: "template",
    template: { name: template.name, language: template.language, components },
  };
}
export function parseWhatsAppReply(message) {
  const payload =
    message?.type === "button"
      ? message.button?.payload
      : message?.type === "interactive"
        ? message.interactive?.button_reply?.id
        : null;
  if (typeof payload !== "string") return null;
  const match = /^workforce:([^:]+):(ACCEPT|DECLINE)$/.exec(payload);
  if (
    !match ||
    !z.uuid().safeParse(match[1]).success ||
    typeof message.from !== "string" ||
    typeof message.context?.id !== "string"
  )
    return null;
  return {
    attemptId: match[1],
    optionId: match[2],
    sender: message.from.replace(/^\+/, ""),
    contextId: message.context.id,
  };
}
export function whatsAppStatus(message) {
  if (["read", "delivered"].includes(message.delivery_status))
    return message.delivery_status;
  if (
    message.submission_status === "failed" ||
    message.delivery_status === "failed"
  )
    return "failed";
  if (message.submission_status === "unknown") return "submission_unknown";
  return "sent";
}
export class WhatsAppServiceError extends Error {
  constructor(status, code, retryable, metaCode) {
    super(`WhatsApp service request failed (${status || "network"} / ${code}${metaCode === undefined ? "" : " / Meta " + metaCode})`);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.metaCode = metaCode;
  }
}
export function createWhatsAppClient(
  { url, key, timeout = 10000 },
  fetcher = fetch,
) {
  return {
    async request(method, path, { data, key: requestKey, params } = {}) {
      const endpoint = new URL("/v1" + path, url);
      if (params)
        for (const [k, v] of Object.entries(params))
          if (v !== undefined && v !== null)
            endpoint.searchParams.set(k, String(v));
      let response, body;
      try {
        response = await fetcher(endpoint, {
          method,
          redirect: "manual",
          signal: AbortSignal.timeout(timeout),
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            ...(requestKey ? { "Idempotency-Key": requestKey } : {}),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        body = await response.json();
      } catch {
        throw new WhatsAppServiceError(0, "UNAVAILABLE", true);
      }
      if (!response.ok) {
        const code =
          typeof body?.error?.code === "string" &&
          /^[A-Z0-9_]{1,80}$/.test(body.error.code)
            ? body.error.code
            : "HTTP_ERROR";
        throw new WhatsAppServiceError(
          response.status,
          code,
          response.status === 429 || response.status >= 500,
          code === "META_ERROR" && Number.isSafeInteger(body?.error?.details?.code)
            ? body.error.details.code
            : undefined,
        );
      }
      return body;
    },
  };
}
export async function requireApprovedTemplate(client, message) {
  const result = await client.request("GET", "/templates", {
    params: {
      name: message.template.name,
      language: message.template.language,
      status: "APPROVED",
      limit: 100,
    },
  });
  if (!Array.isArray(result?.data))
    throw new WhatsAppServiceError(502, "INVALID_TEMPLATE_RESPONSE", true);
  const template = result.data.find(
    (row) =>
      row.name === message.template.name &&
      row.language === message.template.language &&
      row.status === "APPROVED",
  );
  if (!template)
    throw new WhatsAppServiceError(400, "TEMPLATE_NOT_APPROVED", false);
  const components = template.components ?? [],
    text = components.find((c) => c.type === "BODY")?.text ?? "",
    matches = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1])),
    count = matches.length ? Math.max(...matches) : 0;
  const body =
      message.template.components.find((c) => c.type === "body")?.parameters ??
      [],
    buttons = components.find((c) => c.type === "BUTTONS")?.buttons ?? [],
    sentButtons = message.template.components.filter(
      (c) => c.type === "button",
    );
  if (
    template.parameter_format === "NAMED" ||
    components.some((c) => !["BODY", "BUTTONS"].includes(c.type)) ||
    count !== body.length ||
    new Set(matches).size !== count ||
    (sentButtons.length
      ? buttons.length !== 2 ||
        sentButtons.length !== 2 ||
        sentButtons.some(
          (c) => buttons[Number(c.index)]?.type !== "QUICK_REPLY",
        )
      : buttons.length !== 0)
  )
    throw new WhatsAppServiceError(400, "TEMPLATE_SHAPE_MISMATCH", false);
}
