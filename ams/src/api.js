import { t } from "./i18n.js";

let observedMessagingMode = null;
let observedSettingsRevision = null;
export async function api(path, { method = "GET", body } = {}) {
  const mutation =
    !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) &&
    !path.startsWith("/auth/");
  if (mutation && !observedMessagingMode)
    throw Error(t("api.modeUnconfirmed"));
  if (path === "/messaging/status") {
    observedMessagingMode = null;
    observedSettingsRevision = null;
  }
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(mutation
        ? {
            "X-Workforce-Messaging-Mode": observedMessagingMode,
            ...(observedSettingsRevision
              ? { "X-Workforce-Settings-Revision": observedSettingsRevision }
              : {}),
          }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401 && !path.includes("/auth/"))
    window.dispatchEvent(new Event("workforce:unauthorized"));
  let value;
  try {
    value = await response.json();
  } catch {
    const error = new Error(
      response.ok
        ? t("api.invalidResponse", { status: response.status })
        : t("api.unavailable", { status: response.status }),
    );
    Object.assign(error, { status: response.status, reason: "invalid_api_response" });
    throw error;
  }
  if (path === "/messaging/status") {
    observedSettingsRevision = response.ok
      ? (value.configuration_revision ?? null)
      : null;
    observedMessagingMode =
      response.ok &&
      [
        "mock",
        "twilio-pstn",
        "mock+whatsapp-service",
        "twilio-pstn+whatsapp-service",
      ].includes(value.mode)
        ? value.mode
        : null;
  }
  if (!response.ok) {
    const error = new Error(value.message ?? t("api.failed"));
    Object.assign(error, value, { status: response.status });
    throw error;
  }
  return value;
}

export async function loadAllPages(path, request = api) {
  const url = new URL(path, "http://workforce.local");
  const items = new Map();
  let total;
  for (let page = 1; ; page++) {
    url.searchParams.set("limit", "200");
    url.searchParams.set("page", String(page));
    const data = await request(url.pathname + url.search);
    if (!Array.isArray(data.items)) throw Error(t("api.listIncomplete"));
    if (total === undefined) total = data.total ?? data.items.length;
    const previous = items.size;
    for (const item of data.items) items.set(item.id, item);
    if (items.size >= total)
      return { items: [...items.values()], total: items.size };
    if (items.size === previous)
      throw Error(t("api.listStalled"));
  }
}
