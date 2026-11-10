import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateStaff,
  validateSite,
  validateRange,
  contactable,
  overlaps,
  mapResponse,
} from "../src/domain.js";

test("AC-S-01-01 defaults are applied and untrusted record timestamps are ignored", () => {
  const value = validateStaff({
    name: " Anna ",
    mobile: "+65 9123-4567",
    ctime: "2000-01-01T00:00:00Z",
  });
  assert.deepEqual(value, {
    name: "Anna",
    mobile: "+6591234567",
    landline: null,
    language: "en",
    preferred_channel: "whatsapp",
    status: "active",
    whatsapp_opt_in: false,
    whatsapp_opt_in_source: null,
  });
});
test("AC-S-02-01/03 rejects missing country code and invalid numbers", () => {
  for (const mobile of ["91234567", "hello", "+0001234567"])
    assert.throws(
      () => validateStaff({ name: "Anna", mobile }),
      (e) => e.status === 400 && e.errors.some((x) => x.field === "mobile"),
    );
});
test("AC-S-02-04/05 and AC-S-03-05 reject unsupported enum values", () => {
  for (const extra of [
    { preferred_channel: "sms" },
    { language: "english" },
    { language: "zz" },
    { status: "deleted" },
  ])
    assert.throws(
      () => validateStaff({ name: "Anna", mobile: "+6591234567", ...extra }),
      (e) => e.status === 400,
    );
});
test("Explicit WhatsApp consent can record the administrator as its source", async () => {
  const { validateStaff } = await import("../src/domain.js");
  const result = validateStaff({name:"Anna",mobile:"+6591234567",whatsapp_opt_in:true});
  assert.equal(result.whatsapp_opt_in_source,"admin_confirmation");
});

test("AC-S-04-04 inactive and non-opted-in staff are never WhatsApp contactable", () => {
  assert.deepEqual(
    contactable({
      status: "active",
      mobile: "+6591234567",
      whatsapp_opt_in: false,
    }),
    ["voice"],
  );
  assert.deepEqual(
    contactable({
      status: "on_leave",
      mobile: "+6591234567",
      whatsapp_opt_in: true,
    }),
    [],
  );
  assert.deepEqual(
    contactable({
      status: "active",
      mobile: "+6591234567",
      whatsapp_opt_in: true,
    }),
    ["whatsapp", "voice"],
  );
});
test("AC-SI-01-02/03 and AC-SI-02-01 normalize site code and validate IANA timezone", () => {
  assert.equal(
    validateSite({ code: "north", name: "North", timezone: "Asia/Singapore" })
      .code,
    "NORTH",
  );
  for (const extra of [{ code: "a b" }, { timezone: "Mars/Base" }])
    assert.throws(
      () =>
        validateSite({
          code: "NORTH",
          name: "North",
          timezone: "Asia/Singapore",
          ...extra,
        }),
      (e) => e.status === 400,
    );
});
test("AC-R-10-01/02/03 half-open overlap includes overnight ranges", () => {
  assert.equal(
    overlaps(
      "2026-11-03T07:00:00Z",
      "2026-11-03T15:00:00Z",
      "2026-11-03T14:00:00Z",
      "2026-11-03T22:00:00Z",
    ),
    true,
  );
  assert.equal(
    overlaps(
      "2026-11-03T07:00:00Z",
      "2026-11-03T15:00:00Z",
      "2026-11-03T15:00:00Z",
      "2026-11-03T23:00:00Z",
    ),
    false,
  );
  assert.equal(
    overlaps(
      "2026-11-03T22:00:00Z",
      "2026-11-04T06:00:00Z",
      "2026-11-04T05:00:00Z",
      "2026-11-04T09:00:00Z",
    ),
    true,
  );
});
test("AC-R-01-03/04 requires UTC Z and a positive duration no greater than 24h", () => {
  validateRange("2026-11-03T22:00:00Z", "2026-11-04T06:00:00Z");
  for (const [a, b] of [
    ["2026-11-03T07:00:00Z", "2026-11-03T07:00:00Z"],
    ["2026-11-03T07:00:00Z", "2026-11-04T08:00:00Z"],
    ["2026-11-03T07:00:00+08:00", "2026-11-03T08:00:00+08:00"],
  ])
    assert.throws(
      () => validateRange(a, b),
      (e) => e.status === 400,
    );
});
test("AC-RH-01-01 only known options produce business responses", () => {
  assert.equal(mapResponse("ACCEPT"), "accept");
  assert.equal(mapResponse("DECLINE"), "decline");
  for (const value of ["1", "Yes", "9", undefined, null])
    assert.equal(mapResponse(value), null);
});
test("G-01c impossible calendar dates are rejected rather than normalized", () =>
  assert.throws(
    () => validateRange("2026-02-31T07:00:00Z", "2026-02-31T15:00:00Z"),
    (e) => e.status === 400,
  ));
