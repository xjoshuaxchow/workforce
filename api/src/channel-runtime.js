import express from "express";
import { createPstnAdapter } from "./pstn-adapter.js";
import { createWhatsAppAdapter } from "./whatsapp-adapter.js";
import { sendMock } from "./messaging.js";
import { eligible } from "./dispatch.js";
import { voiceProfile } from "./voice-content.js";
import { fail } from "./domain.js";
import { resolveClipPlan, requireCompletePlans } from "./voice-clip-service.js";
import { resolveSynthesisPlan } from "./voice-synthesis-service.js";
import { generatedVoiceMode, localVoices } from "./voice-synthesis-content.js";
export function createChannelRuntime({
  pool,
  settings,
  clock = () => new Date(),
  pstnClientFactory,
  whatsappClientFactory,
}) {
  const profiles = new Map();
  async function profile(id) {
    const current = id ? await settings.get(id) : await settings.current();
    const active = await settings.current(),
      cacheKey = current.id + ":" + active.id;
    if (profiles.has(cacheKey)) return profiles.get(cacheKey);
    const { config } = current,
      credentials = await settings.credentials(config);
    const voice = {
      mode: config.voice.mode,
      accountSid: config.voice.accountSid,
      authToken: credentials.voiceToken,
      fromNumber: config.voice.fromNumber,
      publicBaseUrl: config.voice.publicBaseUrl,
      prompts: config.prompts,
      voiceTexts: config.voiceTexts,
      voiceClips: config.voiceClips,
      settingsVersion: current.id,
    };
    const whatsapp = {
      ...config.whatsapp,
      key: credentials.whatsappKey,
      templates: config.templates.en,
      templatesByLanguage: config.templates,
      settingsVersion: current.id,
    };
    const result = {
      id: current.id,
      config,
      pstn:
        voice.mode === "twilio-pstn"
          ? createPstnAdapter({
              pool,
              clock,
              config: voice,
              client: pstnClientFactory?.(voice),
            })
          : null,
      whatsapp:
        whatsapp.mode === "service"
          ? createWhatsAppAdapter({
              pool,
              clock,
              config: whatsapp,
              client: whatsappClientFactory?.(whatsapp),
            })
          : null,
    };
    if (result.pstn) {
      result.router = express.Router();
      result.pstn.register(result.router);
    }
    profiles.set(cacheKey, result);
    return result;
  }
  async function status() {
    const p = await profile();
    return {
      mode:
        p.config.whatsapp.mode === "service"
          ? p.config.voice.mode + "+whatsapp-service"
          : p.config.voice.mode,
      voice: p.config.voice.mode === "twilio-pstn" ? "twilio" : "mock",
      whatsapp: p.config.whatsapp.mode,
      configuration_revision: p.id,
    };
  }
  async function forAttempt(id) {
    const a = (
      await pool.query("SELECT settings_version_id FROM attempts WHERE id=$1", [
        id,
      ])
    ).rows[0];
    return profile(a?.settings_version_id);
  }
  async function activeProfiles(table, where) {
    const rows = (
      await pool.query(
        `SELECT DISTINCT settings_version_id FROM ${table} WHERE ${where}`,
      )
    ).rows;
    const result = [];
    for (const row of rows)
      if (row.settings_version_id)
        result.push(await profile(row.settings_version_id));
    return result;
  }
  const pstn = {
    async sendAttempt(id) {
      const p = await forAttempt(id);
      return p.pstn ? p.pstn.sendAttempt(id) : sendMock(pool, clock, id, p.config.voiceTexts, { voiceClips: p.config.voiceClips, publicBaseUrl: p.config.voice.publicBaseUrl, settingsVersion: p.id });
    },
    async reconcile() {
      for (const p of await activeProfiles(
        "voice_calls",
        "state IN ('submitting','submitted','unknown')",
      ))
        if (p.pstn) await p.pstn.reconcile();
    },
    register(app) {
      app.use(async (req, res, next) => {
        const match =
          /^\/integrations\/twilio\/voice\/([a-f0-9-]{36})\/(twiml|gather|status)$/.exec(
            req.path,
          );
        if (!match) return next();
        const row = (
          await pool.query(
            "SELECT settings_version_id FROM voice_calls WHERE attempt_id=$1",
            [match[1]],
          )
        ).rows[0];
        const p = await profile(row?.settings_version_id);
        if (!p.router) return next();
        return p.router(req, res, next);
      });
    },
  };
  const whatsapp = {
    async sendAttempt(id) {
      const p = await forAttempt(id);
      return p.whatsapp
        ? p.whatsapp.sendAttempt(id)
        : sendMock(pool, clock, id);
    },
    async poll() {
      for (const p of await activeProfiles(
        "whatsapp_submissions",
        "state<>'rejected'",
      ))
        if (p.whatsapp) await p.whatsapp.poll();
    },
  };
  async function validateDispatch(db, request, candidates) {
    // Keep validation and all queued attempts on the same active settings version.
    await db.query("SELECT version_id FROM messaging_settings_active WHERE singleton FOR SHARE");
    const current = await settings.current();
    const plans = [], languages = new Set();
    for (const candidate of candidates) {
      const staff = candidate.staff;
      if (await eligible(db, request, staff)) continue;
      if (current.config.voiceClips.mode === "local-mp3" && !Object.hasOwn(localVoices, staff.language)) fail(409, "本機語音只支援粵語及英語，請檢查候選員工語言。", { reason: "missing_voice_language" });
      if (current.config.voice.mode === "twilio-pstn" || current.config.voiceClips.mode !== "say") {
        try {
          voiceProfile(staff.language);
        } catch (error) {
          fail(409, error.message, { reason: error.code });
        }
      }
      if (current.config.voiceClips.mode !== "say") languages.add(staff.language);
      if (
        request.channels.includes("whatsapp") &&
        staff.whatsapp_opt_in &&
        current.config.whatsapp.mode === "service" &&
        !current.config.templates[staff.language]?.shift_offer_v1?.name
      )
        fail(409, "Missing employee language WhatsApp template", {
          reason: "missing_whatsapp_language",
        });
    }
    if (languages.size) {
      const site = (await db.query("SELECT * FROM sites WHERE id=$1", [request.site_id])).rows[0];
      for (const language of languages) plans.push(generatedVoiceMode(current.config.voiceClips.mode)
        ? await resolveSynthesisPlan(db, current.config, language, site, request, clock)
        : await resolveClipPlan(db, current.config, language, site, request, { activeOnly: true }));
      requireCompletePlans(plans);
      for (const plan of plans) await db.query("INSERT INTO request_voice_plans(request_id,language,settings_version_id,plan) VALUES($1,$2,$3,$4)", [request.id, plan.language, current.id, plan]);
    }
  }
  return { status, pstn, whatsapp, validateDispatch };
}
