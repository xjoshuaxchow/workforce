import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mutate, audit } from "./service.js";
import { fail, validation } from "./domain.js";
import { requestAccess } from "./dispatch.js";
import { descriptorsForConfig, generatedVoiceMode, localVoices } from "./voice-synthesis-content.js";
import { voicePartsSchema } from "./voice-text-schema.js";

export async function requestSynthesisDescriptors(db, config, language, site, request) {
  const edits = (await db.query("SELECT purpose,parts,revision FROM request_voice_texts WHERE request_id=$1 AND language=$2", [request.id, language])).rows;
  const byPurpose = new Map(edits.map(edit => [edit.purpose, edit]));
  const texts = structuredClone(config.voiceTexts);
  for (const edit of edits) texts[language][edit.purpose] = edit.parts;
  return descriptorsForConfig({ ...config, voiceTexts: texts }, language, site, request, [...byPurpose.keys()])
    .map(item => ({ ...item, customized: byPurpose.has(item.purpose), textRevision: byPurpose.get(item.purpose)?.revision ?? null }));
}
const inputSchema = z.object({
  language: z.enum(["en", "yue", "zh"]),
  purpose: z.enum(["offer", "confirmation", "cancellation", "ack", "no_input", "unavailable"]),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedTextRevision: z.uuid().nullable(),
  parts: z.array(z.string()).nullable(),
}).strict();
export function registerVoiceTextRoutes(app, { pool, clock, settings }) {
  app.patch("/api/requests/:id/voice-text", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success) fail(404, "Request not found");
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) validation("voiceText", "單段講稿格式不正確");
    const input = parsed.data;
    if (input.parts !== null && !voicePartsSchema(input.purpose).safeParse(input.parts).success)
      validation("voiceText", "固定字句不能全為空白，每段最多400字、合計1200字；系統資料及按鍵位置不能改動。");
    const result = await mutate(pool, clock, async db => {
      const request = await requestAccess(db, req.user, req.params.id, 404, true);
      if (request.status !== "draft") fail(409, "只有草稿可以修改電話講稿。");
      const active = (await db.query("SELECT version_id FROM messaging_settings_active WHERE singleton FOR SHARE")).rows[0];
      const { config } = await settings.get(active.version_id);
      if (!generatedVoiceMode(config.voiceClips.mode)) fail(409, "請先選擇完整 MP3 生成模式。");
      if (config.voiceClips.mode === "local-mp3" && !Object.hasOwn(localVoices, input.language)) fail(409, "本機語音只支援粵語及英語。");
      const site = (await db.query("SELECT * FROM sites WHERE id=$1 FOR SHARE", [request.site_id])).rows[0];
      const current = (await requestSynthesisDescriptors(db, config, input.language, site, request)).find(item => item.purpose === input.purpose);
      if (!current) fail(409, "這份工作不需要此段語音。");
      if (current.hash !== input.expectedHash || current.textRevision !== input.expectedTextRevision) fail(409, "講稿或工作資料已改變，請重新檢查後再修改。");
      const restore = input.parts === null || JSON.stringify(input.parts) === JSON.stringify(config.voiceTexts[input.language][input.purpose]);
      if (restore) await db.query("DELETE FROM request_voice_texts WHERE request_id=$1 AND language=$2 AND purpose=$3", [request.id, input.language, input.purpose]);
      else await db.query("INSERT INTO request_voice_texts(request_id,language,purpose,parts,revision,updated_by,utime) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT(request_id,language,purpose) DO UPDATE SET parts=excluded.parts,revision=excluded.revision,updated_by=excluded.updated_by,utime=excluded.utime", [request.id, input.language, input.purpose, JSON.stringify(input.parts), randomUUID(), req.user.id, clock()]);
      const changed = (await requestSynthesisDescriptors(db, config, input.language, site, request)).find(item => item.purpose === input.purpose);
      await audit(db, clock, req.user, "request.voice_text.changed", "request", request.id, { language: input.language, purpose: input.purpose, parts: current.parts }, { language: input.language, purpose: input.purpose, parts: changed.parts, customized: changed.customized }, request.site_id);
      return changed;
    });
    res.json(result);
  });
}
