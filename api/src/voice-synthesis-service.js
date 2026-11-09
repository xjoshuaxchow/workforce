import { z } from "zod";
import { transaction } from "./db.js";
import { mutate, audit } from "./service.js";
import { fail, validation } from "./domain.js";
import { requestAccess, eligible } from "./dispatch.js";
import { generatedVoiceMode, localVoices } from "./voice-synthesis-content.js";
import { requestSynthesisDescriptors } from "./voice-text-service.js";
import { createAzureSpeechClient } from "./azure-speech.js";
import { insertAudio } from "./voice-assets.js";
import { validMp3 } from "./audio-validation.js";

function itemStatus(descriptor, row, clock) {
  let state = row?.state ?? "missing";
  if (state === "submitting" && clock() - new Date(row.started_at) > 90000) state = "unknown";
  if (state === "ready" && !row.active) state = "archived";
  if (descriptor.issues?.length) state = "blocked";
  return { ...descriptor, key: descriptor.purpose, sample: descriptor.script, state, generation: row?.generation,
    ...(state === "ready" ? { asset_id: row.asset_id, playback_path: `/media/voice/${row.public_token}` } : {}) };
}
export async function synthesisItems(db, config, language, site, request, clock = () => new Date()) {
  const descriptors = await requestSynthesisDescriptors(db, config, language, site, request);
  const rows = (await db.query("SELECT s.*,a.public_token,a.active FROM voice_syntheses s LEFT JOIN voice_assets a ON a.id=s.asset_id WHERE s.hash=ANY($1::text[])", [descriptors.map(d => d.hash)])).rows;
  const byHash = new Map(rows.map(row => [row.hash, row]));
  return descriptors.map(d => itemStatus(d, byHash.get(d.hash), clock));
}
export async function resolveSynthesisPlan(db, config, language, site, request, clock) {
  const required = await synthesisItems(db, config, language, site, request, clock);
  const missing = required.filter(item => item.state !== "ready"), byKind = new Map(required.map(item => [item.purpose, item]));
  const voices = {};
  if (!missing.length) {
    for (const purpose of ["offer", "confirmation", "cancellation", "filled"]) {
      if (purpose === "offer" && !request.channels.includes("voice")) continue;
      const main = byKind.get(purpose === "filled" ? "unavailable" : purpose);
      voices[purpose] = { language, audio: { main: config.voice.publicBaseUrl + main.playback_path,
        ...Object.fromEntries(["ack", "no_input", "unavailable"].map(kind => [kind, config.voice.publicBaseUrl + byKind.get(kind).playback_path])) },
        ...(purpose === "offer" ? { repeat_dtmf: "9" } : {}) };
    }
  }
  return { mode: config.voiceClips.mode, language, required, missing, voices };
}
const inputSchema = z.object({ language: z.enum(["en", "yue", "zh"]), purpose: z.enum(["offer", "confirmation", "cancellation", "ack", "no_input", "unavailable"]), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), retryGeneration: z.number().int().min(1).optional(), previewOnly: z.boolean().optional() }).strict();

export function registerSynthesisRoutes(app, { pool, clock, settings, azureClientFactory = createAzureSpeechClient, localClientFactory }) {
  app.post("/api/requests/:id/voice-synthesis", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success) fail(404, "Request not found");
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) validation("voiceSynthesis", "Invalid synthesis request");
    const input = parsed.data;
    const reserved = await mutate(pool, clock, async db => {
      const request = await requestAccess(db, req.user, req.params.id, 404, true);
      if (request.status !== "draft") fail(409, "只有草稿可生成語音");
      const version = (await db.query("SELECT version_id FROM messaging_settings_active WHERE singleton FOR SHARE")).rows[0];
      const profile = await settings.get(version.version_id), config = profile.config;
      if (!generatedVoiceMode(config.voiceClips.mode)) fail(409, "請先選擇完整 MP3 生成模式");
      const local = config.voiceClips.mode === "local-mp3";
      if (local && !Object.hasOwn(localVoices, input.language)) fail(409, "本機語音只支援粵語及英語。");
      const candidates = (await db.query("SELECT s.* FROM candidates c JOIN staff s ON s.id=c.staff_id WHERE c.request_id=$1 AND c.selected AND s.language=$2", [request.id, input.language])).rows;
      let needed = false;
      for (const staff of candidates) if (!await eligible(db, request, staff)) needed = true;
      if (!needed && !(local && input.previewOnly === true)) fail(409, "本次工作沒有需要此語言的合資格員工");
      const site = (await db.query("SELECT * FROM sites WHERE id=$1 FOR SHARE", [request.site_id])).rows[0];
      const descriptor = (await requestSynthesisDescriptors(db, config, input.language, site, request)).find(item => item.purpose === input.purpose);
      if (!descriptor || descriptor.hash !== input.expectedHash) fail(409, "講稿或聲線已改變，請重新檢查語音");
      if (descriptor.issues?.length) fail(409, descriptor.issues.join(" "), { reason: "missing_english_voice_text" });
      const old = (await db.query("SELECT s.*,a.public_token,a.active FROM voice_syntheses s LEFT JOIN voice_assets a ON a.id=s.asset_id WHERE s.hash=$1 FOR UPDATE OF s", [descriptor.hash])).rows[0];
      if (old) {
        const item = itemStatus(descriptor, old, clock);
        if (item.state === "ready" || item.state === "submitting") return { existing: item, local };
        if (["unknown", "archived"].includes(item.state) && input.retryGeneration !== old.generation) return { existing: item, local };
        if (input.retryGeneration !== undefined && input.retryGeneration !== old.generation) fail(409, "生成狀態已改變，請重新檢查語音");
      }
      if (local) {
        if (!(await settings.localStatus()).installed) fail(409, "請由管理員先在後端安裝本機語音模型。", { reason: "local_not_installed" });
      } else if (!config.voiceSynthesis.key || !config.voiceSynthesis.region) fail(409, "請由管理員先填入 Azure Key 和 Region", { reason: "azure_not_configured" });
      let row;
      if (old) row = (await db.query("UPDATE voice_syntheses SET state='submitting',generation=generation+1,started_at=$2,settings_version_id=$3,last_error=NULL WHERE hash=$1 RETURNING *", [descriptor.hash, clock(), profile.id])).rows[0];
      else {
        row = (await db.query("INSERT INTO voice_syntheses(hash,request_id,site_id,language,purpose,voice,script,settings_version_id,state,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'submitting',$9) ON CONFLICT(hash) DO NOTHING RETURNING *", [descriptor.hash, descriptor.shared ? null : request.id, descriptor.shared ? null : request.site_id, descriptor.language, descriptor.purpose, descriptor.voice, descriptor.script, profile.id, clock()])).rows[0];
        // Another request can reserve the same shared prompt while this request waits.
        if (!row) {
          const found = (await db.query("SELECT s.*,a.public_token,a.active FROM voice_syntheses s LEFT JOIN voice_assets a ON a.id=s.asset_id WHERE s.hash=$1", [descriptor.hash])).rows[0];
          return { existing: itemStatus(descriptor, found, clock), local };
        }
      }
      await audit(db, clock, req.user, "voice_synthesis.requested", "voice_synthesis", request.id, null, { hash: row.hash, purpose: row.purpose, generation: row.generation }, request.site_id);
      return { row, descriptor, request, config };
    });
    if (reserved.existing) return sendResult(res, reserved.existing, reserved.local);
    const { row, descriptor, request, config } = reserved;
    const local = config.voiceClips.mode === "local-mp3";
    let result;
    try {
      const bytes = await (local ? localClientFactory() : azureClientFactory(config.voiceSynthesis)).synthesize(descriptor);
      if (!Buffer.isBuffer(bytes) || bytes.length > 3 * 1024 * 1024 || !validMp3(bytes)) throw Object.assign(Error("Invalid generated MP3"), { uncertain: true });
      // Completion must persist even if another admin changed settings during Azure I/O.
      result = await transaction(pool, async db => {
        // Reservation and asset foreign-key checks use request -> synthesis order.
        await db.query("SELECT id FROM requests WHERE id=$1 FOR KEY SHARE", [request.id]);
        const locked = (await db.query("SELECT * FROM voice_syntheses WHERE hash=$1 FOR UPDATE", [row.hash])).rows[0];
        if (locked.state !== "submitting" || locked.generation !== row.generation) fail(409, "生成狀態已改變");
        const asset = await insertAudio(db, clock, req.user, { name: `AI ${descriptor.language} ${descriptor.label}`, language: descriptor.language, content_type: "audio/mpeg", data: bytes.toString("base64") }, descriptor.shared ? null : request);
        await db.query("UPDATE voice_syntheses SET state='ready',asset_id=$2,last_error=NULL WHERE hash=$1 AND generation=$3", [row.hash, asset.id, row.generation]);
        await audit(db, clock, req.user, "voice_synthesis.ready", "voice_synthesis", request.id, null, { hash: row.hash, asset_id: asset.id, generation: row.generation }, request.site_id);
        return itemStatus(descriptor, { ...row, state: "ready", asset_id: asset.id, public_token: asset.public_token, active: true }, clock);
      });
    } catch (error) {
      const uncertain = !local && error.uncertain !== false;
      const message = local ? (error.userMessage ?? "本機語音生成失敗，請檢查講稿及後端模型後重試。") : uncertain ? "生成結果未能確定，系統不會自動重試。重新生成可能再次收費。" : "Azure 未能生成，請檢查 Key、Region 或服務額度後重試。";
      await pool.query("UPDATE voice_syntheses SET state=$3,last_error=$4 WHERE hash=$1 AND generation=$2 AND state='submitting'", [row.hash, row.generation, uncertain ? "unknown" : "failed", message]);
      const current = (await pool.query("SELECT s.*,a.public_token,a.active FROM voice_syntheses s LEFT JOIN voice_assets a ON a.id=s.asset_id WHERE s.hash=$1", [row.hash])).rows[0];
      result = { ...itemStatus(descriptor, current, clock), message };
    }
    return sendResult(res, result, local);
  });
}
function sendResult(res, result, local = false) {
  const status = { ready: 200, submitting: 202, failed: 422, unknown: 409, archived: 409 }[result.state];
  return res.status(status ?? 409).json({ ...result, message: result.message ?? (local ? { unknown: "上次本機生成未完成，請重新生成。", archived: "此音檔已封存，可在本機重新生成。" } : { unknown: "生成結果未能確定；重新生成可能再次收費。", archived: "此音檔已封存；重新生成將使用 Azure 額度。" })[result.state] });
}
