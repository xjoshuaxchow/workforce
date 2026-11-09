import { join } from "node:path";
import { rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import type pg from "pg";
import type { Config } from "../config.js";
import type { MetaGateway } from "../meta.js";
import {
  download,
  archiveStream,
  type DownloadResult,
  type DownloadOptions,
} from "./download.js";
import { AppError, errorRecord } from "../errors.js";
export interface MediaGateway {
  upload?(source: Readable, kind: string, mime: string): Promise<any>;
  prepare(id: string): Promise<any>;
  prepareTemplate(body: Record<string, any>): Promise<Record<string, any>>;
}
export class MediaStore implements MediaGateway {
  constructor(
    private pool: pg.Pool,
    private config: Config,
    private meta: MetaGateway,
    private downloader: (
      url: string,
      options: DownloadOptions,
    ) => Promise<DownloadResult> = download,
  ) {}
  async upload(source: Readable, kind: string, mime: string): Promise<any> {
    const file = await archiveStream(source, mime, {
      kind,
      directory: this.config.mediaPath,
      timeoutMs: 240000,
    });
    try {
      const result = await this.pool.query(
        "INSERT INTO media(kind,filename,mime_type,size,sha256,status) VALUES($1,$2,$3,$4,$5,'ready') RETURNING id,kind,mime_type,size,status",
        [kind, file.filename, file.mime, file.size, file.sha256],
      );
      return result.rows[0];
    } catch (error) {
      await rm(join(this.config.mediaPath, file.filename), { force: true });
      throw error;
    }
  }
  async prepare(id: string): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
        `media:${id}`,
      ]);
      const asset = (
        await client.query("SELECT * FROM media WHERE id=$1", [id])
      ).rows[0];
      if (!asset) throw new AppError(404, "NOT_FOUND", "Media not found");
      if (!asset.filename) {
        const remote = asset.source_url
          ? null
          : await this.meta.getMedia(asset.meta_id);
        const result = await this.downloader(asset.source_url ?? remote.url, {
          kind: asset.kind,
          directory: this.config.mediaPath,
          authorization: remote
            ? `Bearer ${this.config.accessToken}`
            : undefined,
          expectedHash: asset.expected_sha256 ?? remote?.sha256,
        });
        await client.query(
          "UPDATE media SET filename=$2,mime_type=$3,size=$4,sha256=$5,last_error=NULL WHERE id=$1",
          [id, result.filename, result.mime, result.size, result.sha256],
        );
        Object.assign(asset, {
          filename: result.filename,
          mime_type: result.mime,
          size: result.size,
          sha256: result.sha256,
        });
      }
      const mediaUploadAge = Date.now() - new Date(asset.updated_at).getTime();
      if (!asset.meta_id || mediaUploadAge >= 25 * 24 * 60 * 60 * 1000) {
        asset.meta_id = await this.meta.uploadMedia(
          join(this.config.mediaPath, asset.filename),
          asset.mime_type,
        );
        await client.query("UPDATE media SET meta_id=$2,updated_at=now() WHERE id=$1", [
          id,
          asset.meta_id,
        ]);
      }
      await client.query(
        "UPDATE media SET status='ready',last_error=NULL WHERE id=$1 AND (status<>'ready' OR last_error IS NOT NULL)",
        [id],
      );
      return { ...asset, status: "ready" };
    } catch (error) {
      await client
        .query(
          "UPDATE media SET status='failed',last_error=$2 WHERE id=$1",
          [id, errorRecord(error)],
        )
        .catch(() => {});
      throw error;
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          `media:${id}`,
        ])
        .catch(() => {});
      client.release();
    }
  }
  async prepareTemplate(
    body: Record<string, any>,
  ): Promise<Record<string, any>> {
    const result = structuredClone(body);
    for (const component of result.components ?? []) {
      if (!component.sampleUrl && !component.sampleMediaId) continue;
      if (component.sampleUrl && component.sampleMediaId)
        throw new AppError(422, "INVALID_SAMPLE", "Choose one sample source");
      if (
        component.type !== "HEADER" ||
        !["IMAGE", "VIDEO", "DOCUMENT"].includes(component.format)
      )
        throw new AppError(
          422,
          "INVALID_SAMPLE",
          "sampleUrl requires a media HEADER",
        );
      const asset = component.sampleMediaId
        ? (
            await this.pool.query("SELECT id,kind FROM media WHERE id=$1", [
              component.sampleMediaId,
            ])
          ).rows[0]
        : (
            await this.pool.query(
              "INSERT INTO media(kind,source_url) VALUES($1,$2) RETURNING id,kind",
              [component.format.toLowerCase(), component.sampleUrl],
            )
          ).rows[0];
      if (!asset || asset.kind !== component.format.toLowerCase())
        throw new AppError(
          422,
          "INVALID_SAMPLE",
          "Sample does not match the header format",
        );
      const prepared = await this.prepare(asset.id);
      const handle = await this.meta.uploadSample(
        join(this.config.mediaPath, prepared.filename),
        prepared.mime_type,
        Number(prepared.size),
      );
      component.example = { ...component.example, header_handle: [handle] };
      delete component.sampleUrl;
      delete component.sampleMediaId;
    }
    return result;
  }
}
