import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyMetaSignature,
  signNotification,
  canonicalJson,
} from "../src/security.js";
import {
  assertPublicAddress,
  validatePublicUrl,
} from "../src/media/download.js";
import {
  messageSchema,
  batchSchema,
  templateBatchSchema,
} from "../src/validation.js";
import { initialize } from "../src/bootstrap.js";
import { nextDeliveryStatus, retryDelay } from "../src/domain.js";

describe("signature handling", () => {
  it("authenticates original bytes and rejects modified JSON, bad lengths, and invalid hex", () => {
    const body = Buffer.from('{ "object": "whatsapp_business_account" }');
    const signature =
      "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, signature, "secret")).toBe(true);
    expect(
      verifyMetaSignature(
        Buffer.from(JSON.stringify(JSON.parse(body.toString()))),
        signature,
        "secret",
      ),
    ).toBe(false);
    expect(verifyMetaSignature(body, "sha256=ff", "secret")).toBe(false);
    expect(
      verifyMetaSignature(body, "sha256=" + "z".repeat(64), "secret"),
    ).toBe(false);
  });
  it("signs notifications over timestamp and exact body", () => {
    expect(signNotification("123", '{"a":1}', "secret")).toBe(
      "sha256=" +
        createHmac("sha256", "secret").update('123.{"a":1}').digest("hex"),
    );
  });
  it("canonicalizes object keys without changing array order", () => {
    expect(canonicalJson({ b: 2, a: { z: 1, b: 2 } })).toBe(
      canonicalJson({ a: { b: 2, z: 1 }, b: 2 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("public media boundaries", () => {
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("rejects non-public address %s", (address) => {
    expect(() => assertPublicAddress(address)).toThrow();
  });
  it("accepts global addresses and public HTTPS URLs only", () => {
    expect(() => assertPublicAddress("8.8.8.8")).not.toThrow();
    expect(() => assertPublicAddress("2606:4700:4700::1111")).not.toThrow();
    expect(validatePublicUrl("https://example.com/a.png").hostname).toBe(
      "example.com",
    );
    for (const url of [
      "http://example.com/a",
      "file:///etc/passwd",
      "https://user:pass@example.com/a",
      "https://127.1/a",
      "https://[::1]/a",
      "https://localhost/a",
    ]) {
      expect(() => validatePublicUrl(url)).toThrow();
    }
  });
});

describe("message contracts", () => {
  it("normalizes phone numbers and validates text/media payloads", () => {
    expect(
      messageSchema.parse({
        to: "+85291234567",
        type: "text",
        text: { body: "Hello" },
      }).to,
    ).toBe("85291234567");
    expect(
      messageSchema.safeParse({
        to: "abc",
        type: "text",
        text: { body: "Hello" },
      }).success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        to: "85291234567",
        type: "image",
        media: { url: "http://example.com/x" },
      }).success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        to: "85291234567",
        type: "image",
        media: { url: "https://127.0.0.1/x" },
      }).success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        to: "85291234567",
        type: "text",
        text: { body: "" },
      }).success,
    ).toBe(false);
  });
  it("limits batches and accepts individual template parameters", () => {
    const message = {
      to: "85291234567",
      type: "text",
      text: { body: "Hello" },
    };
    expect(
      batchSchema.safeParse({ messages: Array(1000).fill(message) }).success,
    ).toBe(true);
    expect(
      batchSchema.safeParse({ messages: Array(1001).fill(message) }).success,
    ).toBe(false);
    expect(
      templateBatchSchema.safeParse({
        name: "order_update",
        language: "en_US",
        recipients: [
          {
            to: "85291234567",
            components: [
              { type: "body", parameters: [{ type: "text", text: "Alice" }] },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("durable state defaults", () => {
  it("never downgrades confirmed delivery and permits recovery from a reported failure", () => {
    expect(nextDeliveryStatus("read", "sent")).toBe("read");
    expect(nextDeliveryStatus("delivered", "failed")).toBe("delivered");
    expect(nextDeliveryStatus("failed", "delivered")).toBe("delivered");
    expect(nextDeliveryStatus(null, "sent")).toBe("sent");
    expect(retryDelay(4, () => 0)).toBeGreaterThan(retryDelay(1, () => 0));
  });
  it("generates credentials once and preserves them across initialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "wa-init-"));
    try {
      await initialize(join(root, "config"), join(root, "media"));
      const key = await readFile(join(root, "config", "api-key"), "utf8");
      const password = await readFile(
        join(root, "config", "postgres-password"),
        "utf8",
      );
      await initialize(join(root, "config"), join(root, "media"));
      expect(await readFile(join(root, "config", "api-key"), "utf8")).toBe(key);
      expect(
        await readFile(join(root, "config", "postgres-password"), "utf8"),
      ).toBe(password);
      expect(key.trim().length).toBeGreaterThanOrEqual(64);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
