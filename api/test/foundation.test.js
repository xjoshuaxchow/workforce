import { test } from "node:test";
import assert from "node:assert/strict";

test("AC-S-02-02 normalizes a mobile before duplicate checks", async () => {
  const { validateStaff } = await import("../src/domain.js");
  assert.equal(
    validateStaff({ name: " Anna ", mobile: "+65 9123-4567" }).mobile,
    "+6591234567",
  );
});
test("AC-S-02-01 rejects a mobile without its country code", async () => {
  const { validateStaff } = await import("../src/domain.js");
  assert.throws(
    () => validateStaff({ name: "Anna", mobile: "91234567" }),
    (e) => e.status === 400 && e.errors[0].field === "mobile",
  );
});
test("Explicit WhatsApp consent can record the administrator as its source", async () => {
  const { validateStaff } = await import("../src/domain.js");
  const result = validateStaff({name:"Anna",mobile:"+6591234567",whatsapp_opt_in:true});
  assert.equal(result.whatsapp_opt_in_source,"admin_confirmation");
});

test("AC-S-01-01 applies profile defaults and trims the name", async () => {
  const { validateStaff } = await import("../src/domain.js");
  const s = validateStaff({ name: " Anna ", mobile: "+6591234567" });
  assert.deepEqual(
    [s.name, s.language, s.preferred_channel, s.status, s.whatsapp_opt_in],
    ["Anna", "en", "whatsapp", "active", false],
  );
});
test("AC-S-02-05 rejects non-ISO language codes", async () => {
  const { validateStaff } = await import("../src/domain.js");
  assert.throws(
    () =>
      validateStaff({ name: "A", mobile: "+6591234567", language: "english" }),
    (e) => e.status === 400,
  );
});
test("AC-SI-01-02 uppercases the site code", async () => {
  const { validateSite } = await import("../src/domain.js");
  assert.equal(
    validateSite({ code: "north", name: "North", timezone: "Asia/Singapore" })
      .code,
    "NORTH",
  );
});
test("AC-SI-02-01 rejects an unknown timezone", async () => {
  const { validateSite } = await import("../src/domain.js");
  assert.throws(
    () => validateSite({ code: "NORTH", name: "North", timezone: "Mars/Base" }),
    (e) => e.status === 400,
  );
});
test("AC-R-10-02 adjacent intervals do not overlap", async () => {
  const { overlaps } = await import("../src/domain.js");
  assert.equal(
    overlaps(
      "2026-11-03T07:00:00Z",
      "2026-11-03T15:00:00Z",
      "2026-11-03T15:00:00Z",
      "2026-11-03T23:00:00Z",
    ),
    false,
  );
});
test("AC-R-10-03 cross-midnight overlap is detected", async () => {
  const { overlaps } = await import("../src/domain.js");
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
test("AC-R-01-04 rejects shifts longer than 24 hours", async () => {
  const { validateRange } = await import("../src/domain.js");
  assert.throws(
    () => validateRange("2026-11-03T07:00:00Z", "2026-11-04T08:00:00Z"),
    (e) => e.status === 400,
  );
});
test("G-01c rejects local timestamps at the API boundary", async () => {
  const { validateRange } = await import("../src/domain.js");
  assert.throws(
    () => validateRange("2026-11-03T07:00:00", "2026-11-03T15:00:00"),
    (e) => e.status === 400,
  );
});
