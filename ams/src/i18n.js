import zhHantMessages from "./locales/zh-Hant/translation.json" with { type: "json" };
import enMessages from "./locales/en/translation.json" with { type: "json" };
import { HONG_KONG_TIMEZONE } from "./time.js";

export const catalogs = {
  "zh-Hant": { ...zhHantMessages },
  en: { ...enMessages },
};

const STORAGE_KEY = "ams.locale";
export const LOCALES = ["zh-Hant", "en"];

function readStoredLocale() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (LOCALES.includes(saved)) return saved;
  } catch {
    /* private mode or tests without storage */
  }
  return "zh-Hant";
}

let locale = readStoredLocale();
const listeners = new Set();

export function getLocale() {
  return locale;
}

export function subscribeLocale(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasMessage(key) {
  return Object.prototype.hasOwnProperty.call(catalogs["zh-Hant"], key);
}

export function t(key, vars) {
  const text = catalogs[locale][key] || catalogs["zh-Hant"][key] || key;
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ""));
}

export function dateLocale() {
  return locale === "en" ? "en-HK" : "zh-HK";
}

export function formatDate(value, options) {
  return new Intl.DateTimeFormat(dateLocale(), {
    timeZone: HONG_KONG_TIMEZONE,
    ...options,
  }).format(value instanceof Date ? value : new Date(value));
}

export function applyDocumentLocale() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
  const title = t("app.documentTitle");
  if (hasMessage("app.documentTitle")) document.title = title;
}

export function setLocale(next) {
  if (!LOCALES.includes(next) || next === locale) return;
  locale = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore unavailable storage */
  }
  applyDocumentLocale();
  for (const listener of listeners) listener();
}

export function voiceLabel(group, key, fallback) {
  const message = `voice.${group}.${key}`;
  return hasMessage(message) ? t(message) : fallback;
}
