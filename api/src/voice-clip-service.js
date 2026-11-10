import { z } from "zod";
import { clipCatalog, clipManifest } from "./voice-clips.js";
import { fail } from "./domain.js";
import { admin } from "./service.js";
import { requestAccess, eligible } from "./dispatch.js";
import { resolveSynthesisPlan } from "./voice-synthesis-service.js";
import { generatedVoiceMode, localVoices } from "./voice-synthesis-content.js";

const purposes = ["offer", "confirmation", "cancellation", "filled"];
export async function resolveClipPlan(db, config, language, site, request, { activeOnly = false } = {}) {
  const neededPurposes = request.channels.includes("voice") ? purposes : purposes.filter(p => p !== "offer");
  const manifests = Object.fromEntries(neededPurposes.map(p => [p, clipManifest(p, language, site, request)]));
  const keys = [...new Set(Object.values(manifests).flatMap(m => Object.values(m).flat()))];
  const library = config.voiceClips.library[language];
  const message = (await db.query("SELECT asset_id FROM request_voice_bindings WHERE request_id=$1 AND language=$2 AND purpose='message'", [request.id, language])).rows[0]?.asset_id;
  const ids = keys.map(key => key === "message" ? message : library[key]).filter(Boolean);
  const assets = new Map((await db.query("SELECT id,public_token,name,language,active,request_id FROM voice_assets WHERE id=ANY($1::uuid[])", [ids])).rows.map(a => [a.id, a]));
  const catalog = new Map(clipCatalog(language, [site]).map(item => [item.key, item]));
  const required = keys.map(key => {
    const asset = assets.get(key === "message" ? message : library[key]);
    const valid = asset && asset.language === language && (!activeOnly || asset.active) && (key === "message" ? asset.request_id === request.id : !asset.request_id);
    return {
      ...(catalog.get(key) ?? { key, category: "補充說明", label: "本次補充說明", sample: request.message }),
      ...(valid ? { asset_id: asset.id, name: asset.name, playback_path: `/media/voice/${asset.public_token}` } : {}),
    };
  });
  const byKey = new Map(required.map(item => [item.key, item]));
  const missing = required.filter(item => !item.asset_id);
  const sequences = Object.fromEntries(Object.entries(manifests).map(([purpose, manifest]) => [purpose, manifest.main.map(key => byKey.get(key))]));
  const voices = missing.length ? {} : Object.fromEntries(Object.entries(manifests).map(([purpose, manifest]) => [purpose, {
    language,
    audio: Object.fromEntries(Object.entries(manifest).map(([kind, sequence]) => [kind, sequence.map(key => config.voice.publicBaseUrl + byKey.get(key).playback_path)])),
    ...(purpose === "offer" ? { repeat_dtmf: "9" } : {}),
  }]));
  return { language, required, missing, sequences, voices };
}
export function requireCompletePlans(plans) {
  const missing = plans.flatMap(plan => plan.missing.map(item => ({ language: plan.language, ...item })));
  if (missing.length) fail(409, `尚欠 ${missing.length} 段電話錄音，請在「調度電話語音」查看清單。`, { reason: "missing_voice_clips", missing });
}
export async function recordedVoice(db, config, purpose, language, site, request, settingsVersion) {
  const pinned = (await db.query("SELECT plan FROM request_voice_plans WHERE request_id=$1 AND language=$2 AND settings_version_id=$3", [request.id, language, settingsVersion])).rows[0]?.plan;
  if (!pinned && generatedVoiceMode(config.voiceClips.mode)) fail(409, "Missing generated voice snapshot");
  const plan = pinned ?? await resolveClipPlan(db, config, language, site, request);
  requireCompletePlans([plan]);
  if (!plan.voices[purpose]) throw Error("Unsupported recorded voice purpose");
  return plan.voices[purpose];
}
export function registerClipRoutes(app, { pool, settings }) {
  app.get("/api/settings/voice-clips/catalog", async (req, res) => {
    admin(req.user);
    const parsed = z.enum(["en", "yue", "zh"]).safeParse(req.query.language ?? "yue");
    if (!parsed.success) fail(400, "Unsupported voice language");
    const sites = (await pool.query("SELECT id,name,address,timezone FROM sites ORDER BY name,id")).rows;
    res.json({ items: clipCatalog(parsed.data, sites) });
  });
  app.get("/api/requests/:id/voice-preview", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success) fail(404, "Request not found");
    const request = await requestAccess(pool, req.user, req.params.id);
    const old = request.status === "draft" ? null : (await pool.query("SELECT settings_version_id FROM attempts WHERE request_id=$1 AND purpose='offer' ORDER BY ctime,id LIMIT 1", [request.id])).rows[0]?.settings_version_id;
    const profile = old ? await settings.get(old) : await settings.current();
    const mode = profile.config.voiceClips.mode;
    const requested = req.query.language === undefined ? null : z.enum(["en", "yue"]).safeParse(req.query.language);
    if (requested && !requested.success) fail(400, "Unsupported audition language");
    const audition = requested?.data;
    if (audition && (request.status !== "draft" || mode !== "local-mp3")) fail(409, "只有本機語音草稿可切換試聽語言。");
    if (mode === "say") return res.json({ mode: "say", languages: [] });
    const saved = request.status === "draft" ? [] : (await pool.query("SELECT plan FROM request_voice_plans WHERE request_id=$1 ORDER BY language", [request.id])).rows.map(row => row.plan);
    let plans = saved;
    let requiredLanguages = saved.map(plan => plan.language);
    if (!plans.length) {
      const site = (await pool.query("SELECT * FROM sites WHERE id=$1", [request.site_id])).rows[0];
      const candidates = (await pool.query("SELECT s.* FROM candidates c JOIN staff s ON s.id=c.staff_id WHERE c.request_id=$1 AND c.selected ORDER BY s.language,s.id", [request.id])).rows;
      plans = [];
      const languages = new Set();
      for (const staff of candidates) {
        if (await eligible(pool, request, staff)) continue;
        languages.add(staff.language);
      }
      requiredLanguages = [...languages];
      if (audition) languages.add(audition);
      for (const language of languages) {
        if (!["en", "yue", "zh"].includes(language) || (mode === "local-mp3" && !Object.hasOwn(localVoices, language))) {
          plans.push({ language, required: [], missing: [{ key: "language", label: "不支援的員工語言", sample: language }], sequences: {} });
          continue;
        }
        const plan = generatedVoiceMode(mode) ? await resolveSynthesisPlan(pool, profile.config, language, site, request)
          : await resolveClipPlan(pool, profile.config, language, site, request, { activeOnly: request.status === "draft" });
        plans.push({ ...plan, previewOnly: !requiredLanguages.includes(language) });
      }
    }
    // Preview paths stay on this origin; provider URLs and credentials are unnecessary.
    const configured = mode === "local-mp3" ? (await settings.localStatus()).installed : false;
    res.json({ mode, configured, requiredLanguages, settings_version_id: profile.id, languages: plans.map(({ voices, ...plan }) => plan) });
  });
}
