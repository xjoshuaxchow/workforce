import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import ipaddr from "ipaddr.js";
import { AppError, RetryableError } from "../errors.js";

function transientNetworkError(error: unknown): boolean {
  const e = error as NodeJS.ErrnoException;
  return (
    [
      "EAI_AGAIN",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ERR_STREAM_PREMATURE_CLOSE",
      "ABORT_ERR",
    ].includes(e?.code ?? "") ||
    ["AbortError", "TimeoutError"].includes(e?.name)
  );
}

export function assertPublicAddress(address: string): void {
  if (!ipaddr.isValid(address) || ipaddr.process(address).range() !== "unicast")
    throw new AppError(
      422,
      "UNSAFE_MEDIA_URL",
      "Media must resolve only to public addresses",
    );
}
export function validatePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(422, "INVALID_MEDIA_URL", "Invalid media URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  )
    throw new AppError(
      422,
      "UNSAFE_MEDIA_URL",
      "Media must use public HTTPS without credentials",
    );
  if (isIP(hostname)) assertPublicAddress(hostname);
  return url;
}
export const mediaRules: Record<string, { max: number; mimes: string[] }> = {
  image: { max: 5_000_000, mimes: ["image/jpeg", "image/png"] },
  audio: {
    max: 16 * 1024 ** 2,
    mimes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
  },
  video: { max: 16 * 1024 ** 2, mimes: ["video/mp4", "video/3gpp"] },
  document: {
    max: 100_000_000,
    mimes: [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  sticker: { max: 500 * 1024, mimes: ["image/webp"] },
};
export interface DownloadOptions {
  kind: string;
  directory: string;
  authorization?: string;
  expectedHash?: string;
  timeoutMs?: number;
}
export interface DownloadResult {
  filename: string;
  mime: string;
  size: number;
  sha256: string;
}
export function trustedMetaHost(hostname: string): boolean {
  return (
    hostname === "lookaside.fbsbx.com" ||
    hostname === "graph.facebook.com" ||
    hostname.endsWith(".fbcdn.net")
  );
}
export async function download(
  value: string,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const rules = mediaRules[options.kind];
  if (!rules)
    throw new AppError(422, "UNSUPPORTED_MEDIA", "Unsupported media type");
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60000);
  let url = validatePublicUrl(value);
  await mkdir(options.directory, { recursive: true });
  for (let redirects = 0; redirects <= 3; redirects++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (options.authorization && !trustedMetaHost(hostname))
      throw new AppError(
        422,
        "UNTRUSTED_MEDIA_HOST",
        "Meta media authentication is restricted to Meta download hosts",
      );
    const addresses = await lookup(hostname, { all: true }).catch((error) => {
      if (transientNetworkError(error))
        throw new RetryableError("Media DNS lookup temporarily failed");
      throw new AppError(
        422,
        "MEDIA_DNS_FAILED",
        "Media hostname could not be resolved",
      );
    });
    if (!addresses.length)
      throw new RetryableError("Media DNS lookup returned no addresses");
    addresses.forEach((a) => assertPublicAddress(a.address));
    const address = addresses[0];
    const response = await new Promise<import("node:http").IncomingMessage>(
      (resolve, reject) => {
        const req = https.get(
          url,
          {
            signal,
            headers: options.authorization
              ? { Authorization: options.authorization }
              : {},
            // Pin the validated address; HTTPS still validates the original hostname certificate.
            lookup: (_host, opts, cb) => {
              if (opts.all) cb(null, [address]);
              else cb(null, address.address, address.family);
            },
          },
          resolve,
        );
        req.on("error", () =>
          reject(new RetryableError("Media download connection failed")),
        );
      },
    );
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.resume();
      if (redirects === 3 || !response.headers.location)
        throw new AppError(
          422,
          "MEDIA_REDIRECT",
          "Too many or invalid media redirects",
        );
      url = validatePublicUrl(
        new URL(response.headers.location, url).toString(),
      );
      continue;
    }
    if (response.statusCode !== 200) {
      response.resume();
      if (response.statusCode === 429 || (response.statusCode ?? 0) >= 500)
        throw new RetryableError("Media server temporarily unavailable");
      throw new AppError(
        422,
        "MEDIA_DOWNLOAD_FAILED",
        "Media server did not return a file",
      );
    }
    const declared = String(response.headers["content-type"] ?? "")
      .split(";")[0]
      .toLowerCase()
      .trim();
    if (Number(response.headers["content-length"]) > rules.max) {
      response.destroy();
      throw new AppError(
        422,
        "MEDIA_TOO_LARGE",
        "Media exceeds its type size limit",
      );
    }
    return archiveStream(response, declared, options, signal);
  }
  throw new AppError(422, "MEDIA_REDIRECT", "Too many redirects");
}

export async function archiveStream(
  source: Readable,
  declared: string,
  options: DownloadOptions,
  signal = AbortSignal.timeout(options.timeoutMs ?? 120000),
): Promise<DownloadResult> {
  const rules = mediaRules[options.kind];
  if (!rules)
    throw new AppError(422, "UNSUPPORTED_MEDIA", "Unsupported media type");
  const filename = randomUUID();
  const temp = join(options.directory, filename + ".part");
  const hash = createHash("sha256");
  let size = 0;
  try {
    const guard = new Transform({
      transform(chunk, _, cb) {
        size += chunk.length;
        if (size > rules.max) {
          cb(
            new AppError(
              422,
              "MEDIA_TOO_LARGE",
              "Media exceeds its type size limit",
            ),
          );
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(
      source,
      guard,
      createWriteStream(temp, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    if (size === 0) throw new AppError(422, "EMPTY_MEDIA", "Media is empty");
    const detected = await fileTypeFromFile(temp);
    let mime = detected?.mime ?? declared;
    if (declared === "audio/mp4" && detected?.mime === "video/mp4")
      mime = "audio/mp4";
    if (
      detected?.mime === "application/x-cfb" &&
      rules.mimes.includes(declared)
    )
      mime = declared;
    if (!detected) {
      if (
        declared !== "text/plain" ||
        options.kind !== "document" ||
        (await readFile(temp)).includes(0)
      )
        throw new AppError(
          422,
          "INVALID_MEDIA_TYPE",
          "File signature is not a supported media type",
        );
      mime = "text/plain";
    }
    if (!rules.mimes.includes(mime))
      throw new AppError(
        422,
        "INVALID_MEDIA_TYPE",
        "File type does not match the message type",
      );
    const sha256 = hash.digest("hex");
    if (options.expectedHash) {
      const expected = /^[a-f0-9]{64}$/i.test(options.expectedHash)
        ? options.expectedHash.toLowerCase()
        : Buffer.from(options.expectedHash, "base64").toString("hex");
      if (expected !== sha256)
        throw new AppError(
          422,
          "MEDIA_HASH_MISMATCH",
          "Downloaded media checksum did not match Meta",
        );
    }
    await rename(temp, join(options.directory, filename));
    return { filename, mime, size, sha256 };
  } catch (error) {
    await rm(temp, { force: true });
    if (transientNetworkError(error))
      throw new RetryableError("Media transfer was interrupted");
    throw error;
  }
}
