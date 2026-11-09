let observedMessagingMode = null;
let observedSettingsRevision = null;
export async function api(path, { method = "GET", body } = {}) {
  const mutation =
    !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) &&
    !path.startsWith("/auth/");
  if (mutation && !observedMessagingMode)
    throw Error("傳送模式未確認，請稍後重試");
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
  const value = await response.json();
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
    const error = new Error(value.message ?? "操作失敗");
    Object.assign(error, value, { status: response.status });
    if (response.status === 401 && !path.includes("/auth/"))
      window.dispatchEvent(new Event("workforce:unauthorized"));
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
    if (!Array.isArray(data.items)) throw Error("無法載入完整清單");
    if (total === undefined) total = data.total ?? data.items.length;
    const previous = items.size;
    for (const item of data.items) items.set(item.id, item);
    if (items.size >= total)
      return { items: [...items.values()], total: items.size };
    if (items.size === previous)
      throw Error("清單未完整載入，請重新整理後再試");
  }
}
