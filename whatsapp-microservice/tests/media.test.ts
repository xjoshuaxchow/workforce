import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { download } from "../src/media/download.js";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
let root: string;
let fixtures: {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  error?: Error;
}[] = [];
let pinned: any;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wa-download-"));
  fixtures = [];
  pinned = undefined;
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as any);
  vi.spyOn(https, "get").mockImplementation(((
    url: any,
    options: any,
    callback: any,
  ) => {
    options.lookup(
      url.hostname,
      { all: true },
      (_error: any, addresses: any) => {
        pinned = addresses;
      },
    );
    const fixture = fixtures.shift()!;
    const response: any = new PassThrough();
    response.statusCode = fixture.status;
    response.headers = fixture.headers;
    queueMicrotask(() => {
      callback(response);
      if (fixture.error) queueMicrotask(() => response.destroy(fixture.error));
      else response.end(fixture.body);
    });
    return new EventEmitter();
  }) as any);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
describe("streamed public downloads", () => {
  it("retries interrupted download streams and removes the partial file", async () => {
    fixtures.push({
      status: 200,
      headers: { "content-type": "image/png" },
      body: png,
      error: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    });
    await expect(
      download("https://example.com/photo", { kind: "image", directory: root }),
    ).rejects.toMatchObject({ name: "RetryableError" });
    expect(await readdir(root)).toEqual([]);
  });
  it("makes temporary DNS failures retryable before any request is sent", async () => {
    vi.mocked(lookup).mockRejectedValue(
      Object.assign(new Error("temporary DNS failure"), { code: "EAI_AGAIN" }),
    );
    await expect(
      download("https://example.com/photo", { kind: "image", directory: root }),
    ).rejects.toMatchObject({ name: "RetryableError" });
    expect(https.get).not.toHaveBeenCalled();
  });
  it("pins DNS and stores verified bytes using an opaque filename", async () => {
    fixtures.push({
      status: 200,
      headers: { "content-type": "image/png" },
      body: png,
    });
    const result = await download("https://example.com/photo.png", {
      kind: "image",
      directory: root,
    });
    expect(pinned).toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(result.mime).toBe("image/png");
    expect(await readFile(join(root, result.filename))).toEqual(png);
  });
  it("rejects redirects to private addresses before making another request", async () => {
    fixtures.push({
      status: 302,
      headers: { location: "https://169.254.169.254/latest" },
      body: Buffer.alloc(0),
    });
    await expect(
      download("https://example.com/photo", { kind: "image", directory: root }),
    ).rejects.toMatchObject({ code: "UNSAFE_MEDIA_URL" });
    expect(https.get).toHaveBeenCalledTimes(1);
  });
  it("rejects a DNS response containing any private address", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ] as any);
    await expect(
      download("https://example.com/photo", { kind: "image", directory: root }),
    ).rejects.toMatchObject({ code: "UNSAFE_MEDIA_URL" });
    expect(https.get).not.toHaveBeenCalled();
  });
  it("rejects oversized content and cleans up partial archives", async () => {
    fixtures.push({
      status: 200,
      headers: { "content-type": "image/png" },
      body: Buffer.alloc(6 * 1024 ** 2),
    });
    await expect(
      download("https://example.com/photo", { kind: "image", directory: root }),
    ).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
    expect(await readdir(root)).toEqual([]);
  });
  it("rejects MIME mismatches and corrupted Meta checksums", async () => {
    fixtures.push({
      status: 200,
      headers: { "content-type": "image/png" },
      body: Buffer.from("%PDF-1.7\nhello"),
    });
    await expect(
      download("https://example.com/photo", { kind: "image", directory: root }),
    ).rejects.toMatchObject({ code: "INVALID_MEDIA_TYPE" });
    fixtures.push({
      status: 200,
      headers: { "content-type": "image/png" },
      body: png,
    });
    await expect(
      download("https://example.com/photo", {
        kind: "image",
        directory: root,
        expectedHash: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "MEDIA_HASH_MISMATCH" });
    expect(await readdir(root)).toEqual([]);
  });
  it("never forwards Meta credentials to an untrusted download host", async () => {
    await expect(
      download("https://example.com/photo", {
        kind: "image",
        directory: root,
        authorization: "Bearer secret",
      }),
    ).rejects.toMatchObject({ code: "UNTRUSTED_MEDIA_HOST" });
    expect(https.get).not.toHaveBeenCalled();
  });
});
