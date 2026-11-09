import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { mutate, audit, admin } from "./service.js";
import { fail, validation } from "./domain.js";
import { parsePstnConfig } from "./twilio-pstn.js";
import { parseWhatsAppConfig } from "./whatsapp-client.js";
import { registerVoiceAssets } from "./voice-assets.js";
import { registerWhatsAppTemplates } from "./whatsapp-template-admin.js";
import { defaultVoiceTexts, voiceTextLayout } from "./voice-content.js";
import { defaultVoiceClips, clipCatalog } from "./voice-clips.js";
import { registerClipRoutes } from "./voice-clip-service.js";
import { defaultVoiceSynthesis, azureVoiceChoices, defaultLocalSpeech } from "./voice-synthesis-content.js";
import { createLocalSpeechClient } from "./local-speech.js";
import { registerSynthesisRoutes } from "./voice-synthesis-service.js";
import { registerVoiceTextRoutes } from "./voice-text-service.js";
import { voicePartsSchema } from "./voice-text-schema.js";
export const channelLanguages = ["en", "yue", "zh"];
export const channelPurposes = [
  "offer",
  "confirmation",
  "filled",
  "cancellation",
  "roster_publish",
  "roster_change",
];
export const templateNames = {
  offer: "shift_offer_v1",
  confirmation: "shift_confirmed_v1",
  filled: "shift_unavailable_v1",
  cancellation: "shift_cancelled_v1",
  roster_publish: "roster_published_v1",
  roster_change: "roster_changed_v1",
};
const variables = z.enum([
  "staff_name",
  "site_name",
  "site_address",
  "date",
  "start_time",
  "end_time",
  "message",
  "shifts",
  "old_date",
  "old_start_time",
  "old_end_time",
  "change",
]);
const template = z
  .object({
    name: z.string().regex(/^[a-z0-9_]{0,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
    body: z.array(variables).max(100),
    buttons: z
      .object({
        accept: z.number().int().min(0).max(9),
        decline: z.number().int().min(0).max(9),
      })
      .strict()
      .optional(),
  })
  .strict();
const byLanguage = (schema) =>
  z
    .object(Object.fromEntries(channelLanguages.map((l) => [l, schema])))
    .strict();
const settingsSchema = z
  .object({
    voice: z
      .object({
        mode: z.enum(["mock", "twilio-pstn"]),
        accountSid: z.string().max(80),
        authToken: z.string().max(500).optional(),
        fromNumber: z.string().max(30),
        publicBaseUrl: z.string().max(2000),
      })
      .strict(),
    whatsapp: z
      .object({
        mode: z.enum(["mock", "service"]),
        url: z.string().max(2000),
        key: z.string().max(1000).optional(),
      })
      .strict(),
    templates: byLanguage(
      z
        .object(
          Object.fromEntries(
            Object.values(templateNames).map((name) => [name, template]),
          ),
        )
        .strict(),
    ),
    prompts: byLanguage(
      z
        .object({
          ack: z.uuid().nullable(),
          no_input: z.uuid().nullable(),
          unavailable: z.uuid().nullable(),
        })
        .strict(),
    ),
    voiceTexts: byLanguage(
      z.object(Object.fromEntries(Object.keys(voiceTextLayout).map(name => [name, voicePartsSchema(name)]))).strict(),
    ).optional(),
    voiceClips: z.object({ mode: z.enum(["say", "clips", "azure-mp3", "local-mp3"]), library: byLanguage(z.record(z.string().max(160), z.uuid())) }).strict().optional(),
    localSpeech: z.object({ speed: z.number().min(0.7).max(1.3) }).strict().optional(),
    voiceSynthesis: z.object({
      region: z.string().trim().regex(/^$|^[a-z][a-z0-9]{1,31}$/),
      key: z.string().trim().max(500).regex(/^[^\r\n]*$/).optional(),
      keyConfigured: z.boolean().optional(),
      voices: z.object(Object.fromEntries(Object.entries(azureVoiceChoices).map(([language, choices]) => [language, z.enum(choices)]))).strict(),
    }).strict().transform(({ keyConfigured, ...value }) => value).optional(),
  })
  .strict();
export function defaultChannelConfig() {
  return {
    voice: {
      mode: "mock",
      accountSid: "",
      authToken: "",
      fromNumber: "",
      publicBaseUrl: "",
    },
    whatsapp: { mode: "mock", url: "", key: "" },
    voiceTexts: defaultVoiceTexts(),
    voiceClips: defaultVoiceClips(),
    voiceSynthesis: defaultVoiceSynthesis(),
    localSpeech: defaultLocalSpeech(),
    templates: Object.fromEntries(
      channelLanguages.map((language) => [
        language,
        Object.fromEntries(
          Object.values(templateNames).map((name, index) => [
            name,
            {
              name: "",
              language:
                language === "yue"
                  ? "zh_HK"
                  : language === "zh"
                    ? "zh_CN"
                    : "en",
              body:
                index === 0
                  ? [
                      "staff_name",
                      "site_name",
                      "date",
                      "start_time",
                      "end_time",
                      "message",
                    ]
                  : [
                      "staff_name",
                      "site_name",
                      "date",
                      "start_time",
                      "end_time",
                    ],
              ...(index === 0 ? { buttons: { accept: 0, decline: 1 } } : {}),
            },
          ]),
        ),
      ]),
    ),
    prompts: Object.fromEntries(
      channelLanguages.map((l) => [
        l,
        { ack: null, no_input: null, unavailable: null },
      ]),
    ),
  };
}
export function sealSettings(key, value) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
export function openSettings(key, value) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64"),
  );
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(value.data, "base64")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
export async function loadSettingsKey(pool, env = process.env) {
  if (env.WORKFORCE_SETTINGS_KEY) {
    const key = Buffer.from(env.WORKFORCE_SETTINGS_KEY, "base64");
    if (key.length !== 32)
      throw Error("WORKFORCE_SETTINGS_KEY must encode 32 bytes");
    return key;
  }
  const folder = new URL("../.local/", import.meta.url),
    path = new URL("settings.key", folder);
  try {
    const key = await readFile(path);
    if (key.length !== 32) throw Error("Settings encryption key is invalid");
    return key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    Number(
      (await pool.query("SELECT count(*) FROM messaging_settings_versions"))
        .rows[0].count,
    )
  )
    throw Error("Settings encryption key is missing; restore the original key");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  try {
    await writeFile(path, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readFile(path);
  }
}
export function publicChannelConfig(config) {
  const copy = structuredClone(config);
  copy.voiceTexts ??= defaultVoiceTexts();
  copy.voiceClips ??= defaultVoiceClips();
  copy.voiceSynthesis ??= defaultVoiceSynthesis();
  copy.localSpeech ??= defaultLocalSpeech();
  copy.voiceSynthesis.keyConfigured = Boolean(copy.voiceSynthesis.key);
  delete copy.voiceSynthesis.key;
  copy.voice.authTokenConfigured = Boolean(copy.voice.authToken);
  delete copy.voice.authToken;
  copy.whatsapp.keyConfigured = Boolean(copy.whatsapp.key);
  delete copy.whatsapp.key;
  return copy;
}
export function createChannelSettings({
  pool,
  key,
  initial = defaultChannelConfig(),
  clock = () => new Date(),
  azureClientFactory,
  localClientFactory = createLocalSpeechClient,
}) {
  const localStatus = () => localClientFactory().status();
  async function get(id) {
    const row = (
      await pool.query(
        "SELECT * FROM messaging_settings_versions WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row) fail(404, "Settings version not found");
    const config = openSettings(key, row.encrypted_config);
    config.voiceTexts ??= defaultVoiceTexts();
    config.voiceClips ??= defaultVoiceClips();
    config.voiceSynthesis ??= defaultVoiceSynthesis();
    config.localSpeech ??= defaultLocalSpeech();
    return { id: row.id, config };
  }
  async function current() {
    let row = (
      await pool.query(
        "SELECT version_id FROM messaging_settings_active WHERE singleton",
      )
    ).rows[0];
    if (!row) {
      await mutate(pool, clock, async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(8310002)");
        if (
          (await db.query("SELECT 1 FROM messaging_settings_active")).rowCount
        )
          return;
        const version = (
          await db.query(
            "INSERT INTO messaging_settings_versions(encrypted_config) VALUES($1) RETURNING id",
            [
              sealSettings(
                key,
                typeof initial === "function" ? await initial() : initial,
              ),
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO messaging_settings_active(version_id) VALUES($1)",
          [version.id],
        );
      });
      row = (
        await pool.query(
          "SELECT version_id FROM messaging_settings_active WHERE singleton",
        )
      ).rows[0];
    }
    return get(row.version_id);
  }
  async function publicView() {
    const value = await current();
    return { id: value.id, config: publicChannelConfig(value.config), voiceTextLayout, azureVoiceChoices, localSpeechStatus: await localStatus() };
  }
  async function save(user, input) {
    admin(user);
    const parsed = z
      .object({ expectedVersion: z.uuid(), config: settingsSchema })
      .strict()
      .safeParse(input);
    if (!parsed.success) {
      const invalidText = parsed.error.issues.some((issue) => issue.path.includes("voiceTexts"));
      validation("settings", invalidText
        ? "電話講稿格式不正確。不能全為空白或含無效字元，每段最多 400 字，每份最多 1200 字。"
        : "Invalid channel settings");
    }
    await current();
    return mutate(pool, clock, async (db) => {
      const active = (
        await db.query(
          "SELECT * FROM messaging_settings_active WHERE singleton FOR UPDATE",
        )
      ).rows[0];
      if (active.version_id !== parsed.data.expectedVersion)
        fail(409, "Settings changed; reload before saving");
      const previous = (
          await db.query(
            "SELECT * FROM messaging_settings_versions WHERE id=$1",
            [active.version_id],
          )
        ).rows[0],
        before = openSettings(key, previous.encrypted_config),
        config = parsed.data.config;
      config.voice.authToken ??= before.voice.authToken;
      config.whatsapp.key ??= before.whatsapp.key;
      config.voiceTexts ??= before.voiceTexts ?? defaultVoiceTexts();
      config.voiceClips ??= before.voiceClips ?? defaultVoiceClips();
      config.voiceSynthesis ??= before.voiceSynthesis ?? defaultVoiceSynthesis();
      config.localSpeech ??= before.localSpeech ?? defaultLocalSpeech();
      config.voiceSynthesis.key ||= before.voiceSynthesis?.key ?? "";
      if (/[\r\n]/.test(config.voice.authToken + config.whatsapp.key))
        validation("credentials", "Credential contains invalid characters");
      for (const name of [
        "accountSid",
        "authToken",
        "fromNumber",
        "publicBaseUrl",
      ])
        config.voice[name] = config.voice[name].trim();
      config.whatsapp.url = config.whatsapp.url.trim();
      config.whatsapp.key = config.whatsapp.key.trim();
      try {
        for (const [obj, field, https] of [
          [config.voice, "publicBaseUrl", true],
          [config.whatsapp, "url", false],
        ])
          if (obj[field]) {
            const url = new URL(obj[field]);
            if (
              !["http:", "https:"].includes(url.protocol) ||
              (https && url.protocol !== "https:") ||
              url.username ||
              url.password ||
              url.pathname !== "/" ||
              url.search ||
              url.hash
            )
              throw Error(
                "Service URL must be an origin without a path or credentials",
              );
            obj[field] = url.origin;
          }
        if (config.voice.mode === "twilio-pstn")
          parsePstnConfig({
            MESSAGING_MODE: config.voice.mode,
            TWILIO_ACCOUNT_SID: config.voice.accountSid,
            TWILIO_AUTH_TOKEN: config.voice.authToken,
            TWILIO_FROM_NUMBER: config.voice.fromNumber,
            TWILIO_PUBLIC_BASE_URL: config.voice.publicBaseUrl,
          });
        if (config.whatsapp.mode === "service")
          for (const language of channelLanguages)
            parseWhatsAppConfig(
              {
                WHATSAPP_MODE: "service",
                WHATSAPP_SERVICE_URL: config.whatsapp.url,
                WHATSAPP_SERVICE_API_KEY: config.whatsapp.key,
              },
              config.templates[language],
            );
      } catch (error) {
        validation("channels", error.message);
      }
      for (const [language, prompts] of Object.entries(config.prompts))
        for (const id of Object.values(prompts))
          if (id) {
            const asset = (
              await db.query(
                "SELECT 1 FROM voice_assets WHERE id=$1 AND language=$2 AND active AND request_id IS NULL",
                [id, language],
              )
            ).rowCount;
            if (!asset)
              validation(
                "prompts",
                "Prompt must be an active global audio file of the same language",
              );
          }
      const sites = (await db.query("SELECT id,name,address,timezone FROM sites")).rows;
      for (const [language, mappings] of Object.entries(config.voiceClips.library)) {
        const allowed = new Set(clipCatalog(language, sites).map(item => item.key));
        for (const [clipKey, id] of Object.entries(mappings)) {
          // Stale Site keys may remain in history, but cannot satisfy a new manifest.
          const staleSite = /^site:[a-f0-9-]{36}:[a-f0-9]{16}$/.test(clipKey) && before.voiceClips?.library?.[language]?.[clipKey] === id;
          if (!allowed.has(clipKey) && !staleSite) validation("voiceClips", "Unknown recording slot; reload the library after Site changes");
          const asset = (await db.query("SELECT 1 FROM voice_assets WHERE id=$1 AND language=$2 AND request_id IS NULL AND active", [id, language])).rowCount;
          if (!asset) validation("voiceClips", "錄音必須是同一語言、仍啟用的共用檔案");
        }
      }
      const next = (
        await db.query(
          "INSERT INTO messaging_settings_versions(encrypted_config) VALUES($1) RETURNING id",
          [sealSettings(key, config)],
        )
      ).rows[0];
      await db.query(
        "UPDATE messaging_settings_active SET version_id=$1 WHERE singleton",
        [next.id],
      );
      await audit(
        db,
        clock,
        user,
        "channel_settings.updated",
        "channel_settings",
        next.id,
        publicChannelConfig(before),
        publicChannelConfig(config),
      );
      return { id: next.id, config: publicChannelConfig(config), voiceTextLayout, azureVoiceChoices, localSpeechStatus: await localStatus() };
    });
  }
  function register(app) {
    registerVoiceAssets(app, { pool, clock });
    registerClipRoutes(app, { pool, settings: { current, get, localStatus } });
    registerSynthesisRoutes(app, { pool, clock, settings: { current, get, localStatus }, azureClientFactory, localClientFactory });
    registerVoiceTextRoutes(app, { pool, clock, settings: { current, get } });
    registerWhatsAppTemplates(app, { settings: { current } });
    app.get("/api/settings/channels", async (req, res) => {
      admin(req.user);
      res.json(await publicView());
    });
    app.patch("/api/settings/channels", async (req, res) =>
      res.json(await save(req.user, req.body)),
    );
  }
  async function credentials(snapshot) {
    const rows = (
      await pool.query(
        "SELECT encrypted_config FROM messaging_settings_versions ORDER BY sequence DESC",
      )
    ).rows;
    let voiceToken, whatsappKey;
    const origin = (value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    };
    for (const row of rows) {
      const c = openSettings(key, row.encrypted_config);
      if (
        voiceToken === undefined &&
        c.voice.accountSid.trim() === snapshot.voice.accountSid.trim()
      )
        voiceToken = c.voice.authToken;
      if (
        whatsappKey === undefined &&
        origin(c.whatsapp.url) === origin(snapshot.whatsapp.url)
      )
        whatsappKey = c.whatsapp.key;
      if (voiceToken !== undefined && whatsappKey !== undefined) break;
    }
    return {
      voiceToken: voiceToken ?? snapshot.voice.authToken,
      whatsappKey: whatsappKey ?? snapshot.whatsapp.key,
    };
  }
  return { current, get, publicView, save, register, credentials };
}
export async function initialChannelConfig(env = process.env) {
  const config = defaultChannelConfig();
  const legacyVoice = parsePstnConfig(env),
    legacyWhatsApp = parseWhatsAppConfig(env);
  Object.assign(config.voice, {
    mode: env.MESSAGING_MODE ?? "mock",
    accountSid: env.TWILIO_ACCOUNT_SID ?? "",
    authToken: env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: env.TWILIO_FROM_NUMBER ?? "",
    publicBaseUrl: env.TWILIO_PUBLIC_BASE_URL ?? "",
  });
  Object.assign(config.whatsapp, {
    mode: env.WHATSAPP_MODE ?? "mock",
    url: env.WHATSAPP_SERVICE_URL ?? "",
    key: env.WHATSAPP_SERVICE_API_KEY ?? "",
  });
  if (env.WHATSAPP_TEMPLATES_FILE) {
    try {
      config.templates.en = JSON.parse(
        await readFile(env.WHATSAPP_TEMPLATES_FILE, "utf8"),
      );
    } catch {
      if (config.whatsapp.mode === "service")
        throw Error("WHATSAPP_TEMPLATES_FILE is invalid");
    }
  }
  if (legacyVoice.mode === "twilio-pstn")
    Object.assign(config.voice, {
      accountSid: legacyVoice.accountSid,
      authToken: legacyVoice.authToken,
      fromNumber: legacyVoice.fromNumber,
      publicBaseUrl: legacyVoice.publicBaseUrl,
    });
  if (legacyWhatsApp.mode === "service") {
    Object.assign(config.whatsapp, {
      url: legacyWhatsApp.url,
      key: legacyWhatsApp.key,
    });
    config.templates.en = legacyWhatsApp.templates;
  }
  return config;
}
