import { describe, expect, it } from "vitest";
import { MetaClient } from "../src/meta.js";
import type { Config } from "../src/config.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const config = {
  graphVersion: "v25.0",
  phoneNumberId: "123",
  businessAccountId: "456",
  accessToken: "secret-token",
  requestTimeoutMs: 1000,
} as Config;
describe("Meta HTTP adapter", () => {
  it("preserves the signature query parameter in resumable upload sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "wa-sample-"));
    try {
      const path = join(root, "sample.txt");
      await writeFile(path, "sample");
      let calls = 0;
      const client = new MetaClient(
        { ...config, appId: "789" },
        async (url, init) => {
          if (++calls === 1)
            return Response.json({ id: "upload:session-id?sig=signed-value" });
          expect(new URL(String(url)).pathname).toBe(
            "/v25.0/upload:session-id",
          );
          expect(new URL(String(url)).searchParams.get("sig")).toBe(
            "signed-value",
          );
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "OAuth secret-token",
          );
          return Response.json({ h: "sample-handle" });
        },
      );
      expect(await client.uploadSample(path, "text/plain", 6)).toBe(
        "sample-handle",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("authenticates sends and preserves correlation data", async () => {
    const client = new MetaClient(config, async (url, init) => {
      expect(String(url)).toBe("https://graph.facebook.com/v25.0/123/messages");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer secret-token",
      );
      expect(JSON.parse(String(init?.body)).biz_opaque_callback_data).toBe(
        "local-id",
      );
      return Response.json({ messages: [{ id: "wamid.123" }] });
    });
    expect(
      (
        await client.send({
          type: "text",
          biz_opaque_callback_data: "local-id",
        })
      ).messages[0].id,
    ).toBe("wamid.123");
  });
  it("treats network failures and server errors as ambiguous sends", async () => {
    const timeout = new MetaClient(config, async () => {
      throw new Error("network timeout");
    });
    await expect(timeout.send({})).rejects.toMatchObject({ ambiguous: true });
    const server = new MetaClient(config, async () =>
      Response.json({ error: { code: 2 } }, { status: 500 }),
    );
    await expect(server.send({})).rejects.toMatchObject({ ambiguous: true });
  });
  it("distinguishes retryable throttling from permanent rejections and redacts tokens", async () => {
    const rateLimited = new MetaClient(config, async () =>
      Response.json(
        { error: { code: 130429, message: "secret-token" } },
        { status: 429 },
      ),
    );
    await expect(rateLimited.send({})).rejects.toMatchObject({
      retryable: true,
      ambiguous: false,
      details: { message: "[REDACTED]" },
    });
    const rejected = new MetaClient(config, async () =>
      Response.json({ error: { code: 100 } }, { status: 400 }),
    );
    await expect(rejected.send({})).rejects.toMatchObject({
      retryable: false,
      ambiguous: false,
    });
  });
  it("returns pagination cursors without exposing provider token-bearing URLs", async () => {
    const client = new MetaClient(config, async () =>
      Response.json({
        data: [],
        paging: {
          next: "https://graph.facebook.com/next?access_token=secret-token",
          cursors: { after: "cursor" },
        },
      }),
    );
    expect(await client.listTemplates()).toEqual({
      data: [],
      nextCursor: "cursor",
    });
  });
});
