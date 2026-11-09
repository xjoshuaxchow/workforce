import type pg from "pg";
import type { MetaGateway } from "../meta.js";
import type { MediaGateway } from "../media/store.js";
import { AppError } from "../errors.js";
export class TemplateService {
  constructor(
    private pool: pg.Pool,
    private meta: MetaGateway,
    private media: MediaGateway,
  ) {}
  private async save(value: any): Promise<any> {
    if (!value?.id)
      throw new AppError(
        502,
        "INVALID_META_RESPONSE",
        "Template response has no ID",
      );
    const result = await this.pool.query(
      `INSERT INTO templates(meta_id,name,language,status,category,payload) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(meta_id) DO UPDATE SET name=EXCLUDED.name,language=EXCLUDED.language,status=EXCLUDED.status,category=EXCLUDED.category,
      payload=EXCLUDED.payload || CASE WHEN EXCLUDED.payload ? 'defaultImageId' THEN '{}'::jsonb
        ELSE jsonb_strip_nulls(jsonb_build_object('defaultImageId', templates.payload->'defaultImageId')) END,
      updated_at=now() RETURNING payload`,
      [
        String(value.id),
        value.name ?? null,
        value.language ?? null,
        value.status ?? null,
        value.category ?? null,
        value,
      ],
    );
    return result.rows[0].payload;
  }
  async list(query: Record<string, any>) {
    const result = await this.meta.listTemplates(query);
    for (const [index, template] of (result.data ?? []).entries())
      result.data[index] = await this.save(template);
    return result;
  }
  async get(id: string) {
    const result = await this.meta.getTemplate(id);
    if (!result) throw new AppError(404, "NOT_FOUND", "Template not found");
    return this.save(result);
  }
  async create(body: Record<string, any>) {
    const defaultImageId = body.components?.find(
      (component: any) => component.type === "HEADER" && component.format === "IMAGE",
    )?.sampleMediaId;
    const prepared = (body.components ?? []).some(
      (x: any) => x.sampleUrl || x.sampleMediaId,
    )
      ? await this.media.prepareTemplate(body)
      : body;
    const result = await this.meta.createTemplate(prepared);
    return this.save({ ...prepared, ...result, ...(defaultImageId ? { defaultImageId } : {}) });
  }
  async update(id: string, body: Record<string, any>) {
    await this.get(id);
    const defaultImageId = body.components?.find(
      (component: any) => component.type === "HEADER" && component.format === "IMAGE",
    )?.sampleMediaId;
    const prepared = (body.components ?? []).some(
      (x: any) => x.sampleUrl || x.sampleMediaId,
    )
      ? await this.media.prepareTemplate(body)
      : body;
    await this.meta.updateTemplate(id, prepared);
    const result = await this.get(id);
    return defaultImageId
      ? this.save({ ...result, defaultImageId })
      : result;
  }
  async setDefaultImage(id: string, mediaId: string) {
    const template = await this.get(id);
    if (!template.components?.some((component: any) => component.type === "HEADER" && component.format === "IMAGE"))
      throw new AppError(422, "INVALID_TEMPLATE", "Template has no image header");
    const asset = (await this.pool.query("SELECT kind,filename FROM media WHERE id=$1", [mediaId])).rows[0];
    if (asset?.kind !== "image" || !asset.filename)
      throw new AppError(422, "INVALID_MEDIA", "Choose an uploaded image");
    const result = await this.pool.query(
      "UPDATE templates SET payload=jsonb_set(payload,'{defaultImageId}',to_jsonb($2::text),true),updated_at=now() WHERE meta_id=$1 RETURNING payload",
      [id, mediaId],
    );
    return result.rows[0].payload;
  }
  async delete(id: string) {
    const template = await this.get(id);
    const result = await this.meta.deleteTemplate(id, template.name);
    await this.pool.query(
      "UPDATE templates SET status='DELETED',updated_at=now() WHERE meta_id=$1",
      [id],
    );
    return result;
  }
}
