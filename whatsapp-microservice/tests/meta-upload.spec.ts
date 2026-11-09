import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { MetaClient } from "../src/meta.js";

it("uses Meta's signed upload session ID without changing its URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wa-sample-"));
  try {
    const file = join(directory, "sample.png");
    await writeFile(file, "sample");
    const uploadId = "upload:session-id==?sig=signed-value";
    let calls = 0;
    let uploadUrl = "";
    const client = new MetaClient(
      {
        graphVersion: "v26.0",
        appId: "789",
        accessToken: "secret-token",
        requestTimeoutMs: 1000,
      } as Config,
      async (url) => {
        if (++calls === 1) return Response.json({ id: uploadId });
        uploadUrl = String(url);
        return Response.json({ h: "sample-handle" });
      },
    );

    expect(await client.uploadSample(file, "image/png", 6)).toBe("sample-handle");
    expect(uploadUrl).toBe(`https://graph.facebook.com/v26.0/${uploadId}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
