import { test } from "node:test";
import assert from "node:assert/strict";
import { localToUtc, utcToLocal } from "../src/time.js";
test("AC-N-03-01 Singapore local input converts to previous UTC day", () =>
  assert.equal(
    localToUtc("2026-11-03T07:00", "Asia/Singapore"),
    "2026-11-02T23:00:00Z",
  ));
test("AC-N-03-02 Sydney DST end gives nine elapsed hours", () =>
  assert.equal(
    (Date.parse(localToUtc("2026-04-05T09:00", "Australia/Sydney")) -
      Date.parse(localToUtc("2026-04-05T01:00", "Australia/Sydney"))) /
      3600000,
    9,
  ));
test("AC-N-03-04 display uses site timezone", () =>
  assert.equal(
    utcToLocal("2026-11-02T23:00:00Z", "Asia/Singapore"),
    "2026-11-03T07:00",
  ));
test("ambiguous or nonexistent DST input must be clarified instead of silently moved", () => {
  for (const value of ["2026-04-05T02:30", "2026-10-04T02:30"])
    assert.throws(() => localToUtc(value, "Australia/Sydney"));
});
test('Hong Kong is the default for input and display without a timezone argument',()=>{
 assert.equal(localToUtc('2026-11-10T09:00'),'2026-11-10T01:00:00Z');
 assert.equal(utcToLocal('2026-11-10T01:00:00Z'),'2026-11-10T09:00');
});
