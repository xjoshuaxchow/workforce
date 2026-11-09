import { Readable } from "node:stream";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { archiveStream, mediaRules } from "../src/media/download.js";

it("uses WhatsApp's decimal MB limits and removes an oversized upload", async () => {
  expect(mediaRules.image.max).toBe(5_000_000);
  expect(mediaRules.document.max).toBe(100_000_000);
  const directory = await mkdtemp(join(tmpdir(), "wa-size-"));
  try {
    await expect(archiveStream(Readable.from([Buffer.alloc(5_000_001)]), "image/png", { kind: "image", directory }))
      .rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
