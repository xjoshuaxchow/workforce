import { createHash } from "node:crypto";
import { buildVoiceContent, defaultVoiceTexts, voiceTextLayout, voiceTextValues } from "./voice-content.js";

export const azureVoiceChoices = {
  en: ["en-GB-SoniaNeural", "en-GB-RyanNeural"],
  yue: ["zh-HK-HiuMaanNeural", "zh-HK-WanLungNeural", "zh-HK-HiuGaaiNeural"],
  zh: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
};
export const azureOutputFormat = "audio-16khz-32kbitrate-mono-mp3";
export const localVoices = { yue: "vits-cantonese-xiaomaiiwn", en: "piper-en-US-lessac-medium" };
export const localModelVersion = "vits-27e0da1-piper-323261600-mixed-v4";
export function defaultLocalSpeech() { return { speed: 1 }; }
export function localSynthesisDescriptors(config, language, site, request, voiceTexts = defaultVoiceTexts(), options) {
  if (!Object.hasOwn(localVoices, language)) throw Error("Unsupported local voice language");
  const spokenSite = language === "en" ? { ...site, name: site.voice_name_en || site.name, address: site.voice_address_en || site.address } : site;
  const items = synthesisDescriptors(defaultVoiceSynthesis(), language, spokenSite, request, voiceTexts, { ...options, includeOffset: false });
  return items.map(item => {
    const voice = localVoices[language], speed = config.speed;
    const hash = createHash("sha256").update(JSON.stringify(["local-v1", localModelVersion, item.scope, language, voice, "mp3-22050hz-32kbps-mono", speed, item.script])).digest("hex");
    const issues = [];
    if (language === "en") {
      if (item.tokens.some(t => t.key === "location")) {
        if (/\p{Script=Han}/u.test(spokenSite.name)) issues.push("請在工作地點填寫英文朗讀名稱。");
        if (/\p{Script=Han}/u.test(spokenSite.address)) issues.push("請在工作地點填寫英文朗讀地址。");
      }
      if (item.tokens.some(t => t.key === "message") && /\p{Script=Han}/u.test(request.message ?? "")) issues.push("本次補充說明含中文字，英文通知需使用英文補充說明。");
      if (!issues.length && /\p{Script=Han}/u.test(item.script)) issues.push("英文講稿含中文字，請修改這段的固定字句。");
    }
    return { ...item, voice, speed, hash, issues, locale: language === "yue" ? "zh-HK" : "en-US" };
  });
}
export function generatedVoiceMode(mode) { return ["azure-mp3", "local-mp3"].includes(mode); }
export function descriptorsForConfig(config, language, site, request, customPurposes = []) {
  return config.voiceClips.mode === "local-mp3"
    ? localSynthesisDescriptors(config.localSpeech, language, site, request, config.voiceTexts, { customPurposes })
    : synthesisDescriptors(config.voiceSynthesis, language, site, request, config.voiceTexts, { customPurposes });
}
export function defaultVoiceSynthesis() {
  return { region: "", key: "", voices: Object.fromEntries(Object.entries(azureVoiceChoices).map(([language, choices]) => [language, choices[0]])) };
}
export function synthesisDescriptors(config, language, site, request, voiceTexts = defaultVoiceTexts(), speechOptions) {
  if (!Object.hasOwn(azureVoiceChoices, language)) throw Error("Unsupported employee voice language");
  const kinds = [...(request.channels.includes("voice") ? ["offer"] : []), "confirmation", "cancellation", "ack", "no_input", "unavailable"];
  return kinds.map(purpose => {
    const staff = { language, name: language === "en" ? "there" : "同事" };
    const script = buildVoiceContent(purpose, staff, site, request, voiceTexts, speechOptions).script;
    const values = voiceTextValues(staff, site, request, speechOptions);
    const shared = ["ack", "no_input", "unavailable"].includes(purpose) && !speechOptions?.customPurposes?.includes(purpose);
    const voice = config.voices[language], locale = voice.split("-").slice(0,2).join("-");
    const scope = shared ? "shared" : `request:${request.id}`;
    // Billing account and Region do not change an already saved recording.
    const hash = createHash("sha256").update(JSON.stringify(["azure-v1", scope, language, voice, azureOutputFormat, script])).digest("hex");
    return { hash, scope, language, purpose, label: voiceTextLayout[purpose].label, voice, locale, script, shared,
      parts: [...voiceTexts[language][purpose]], tokens: voiceTextLayout[purpose].tokens.map(token => ({ ...token, label: token.key === "staff_name" ? "通用稱呼" : token.label, value: values[token.key] })) };
  });
}
