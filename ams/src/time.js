import { Temporal } from "@js-temporal/polyfill";
export function localToUtc(value, timezone) {
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timezone, { disambiguation: "reject" })
    .toInstant()
    .toString({ smallestUnit: "second" });
}
export function utcToLocal(value, timezone) {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function dayAfter(value, days) {
  return Temporal.PlainDate.from(value).add({ days }).toString();
}
export function today(timezone) {
  return Temporal.Now.plainDateISO(timezone).toString();
}
