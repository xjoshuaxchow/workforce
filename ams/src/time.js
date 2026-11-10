import { Temporal } from "@js-temporal/polyfill";
export const HONG_KONG_TIMEZONE = "Asia/Hong_Kong";
export function localToUtc(value, timezone = HONG_KONG_TIMEZONE) {
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timezone, { disambiguation: "reject" })
    .toInstant()
    .toString({ smallestUnit: "second" });
}
export function utcToLocal(value, timezone = HONG_KONG_TIMEZONE) {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function dayAfter(value, days) {
  return Temporal.PlainDate.from(value).add({ days }).toString();
}
export function today(timezone = HONG_KONG_TIMEZONE) {
  return Temporal.Now.plainDateISO(timezone).toString();
}
