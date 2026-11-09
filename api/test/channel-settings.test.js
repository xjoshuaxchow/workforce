import { test } from "node:test";
import assert from "node:assert/strict";
let impl = {};
try {
  impl = await import("../src/channel-settings.js");
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
test("Channel secret encryption hides contents and rejects tampering or the wrong key", () => {
  assert.equal(typeof impl.sealSettings, "function");
  const key = Buffer.alloc(32, 1),
    value = { token: "test-secret-value" };
  const sealed = impl.sealSettings(key, value);
  assert.ok(!JSON.stringify(sealed).includes("test-secret-value"));
  assert.deepEqual(impl.openSettings(key, sealed), value);
  assert.throws(() => impl.openSettings(Buffer.alloc(32, 2), sealed));
  assert.throws(() =>
    impl.openSettings(key, {
      ...sealed,
      data: Buffer.from("corrupted").toString("base64"),
    }),
  );
});
