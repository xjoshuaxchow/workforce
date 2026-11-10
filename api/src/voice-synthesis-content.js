import { createHash } from "node:crypto";
import { buildVoiceContent, defaultVoiceTexts, voiceTextLayout, voiceTextValues, voiceTokens } from "./voice-content.js";

export const localVoices = { yue: "vits-cantonese-xiaomaiiwn", en: "piper-en-US-lessac-medium" };
export const localModelVersion = "vits-27e0da1-piper-323261600-mixed-v4";
export function defaultLocalSpeech() { return { speed: 1 }; }
export function localSynthesisDescriptors(config, language, site, request, voiceTexts = defaultVoiceTexts()) {
  if (!Object.hasOwn(localVoices, language)) throw Error("Unsupported local voice language");
  const spokenSite = { ...site, timezone: "Asia/Hong_Kong", ...(language === "en"
    ? {name: site.voice_name_en || site.name, address: site.voice_address_en || site.address} : {}) };
  const staff = { language, name: language === "en" ? "there" : "同事" };
  const values = voiceTextValues(staff, spokenSite, request, {includeOffset: false});
  const kinds = [...(request.channels.includes("voice") ? ["offer"] : []), "confirmation", "cancellation", "ack", "no_input", "unavailable"];
  return kinds.map(purpose => {
    const script = buildVoiceContent(purpose, staff, spokenSite, request, voiceTexts, {includeOffset: false}).script;
    const voice = localVoices[language], speed = config.speed;
    const hash = createHash("sha256").update(JSON.stringify(["local-v2", localModelVersion, language, voice, "mp3-22050hz-32kbps-mono", speed, script])).digest("hex");
    const tokens = voiceTokens(purpose, voiceTexts[language][purpose]).map(token => ({...token,
      label: token.key === "staff_name" ? "通用稱呼" : token.label, value: values[token.key]}));
    const issues = [];
    if (language === "en") {
      if (tokens.some(t => t.key === "location")) {
        if (/\p{Script=Han}/u.test(spokenSite.name)) issues.push("請在工作地點填寫英文朗讀名稱。");
        if (/\p{Script=Han}/u.test(spokenSite.address)) issues.push("請在工作地點填寫英文朗讀地址。");
      }
      if (tokens.some(t => t.key === "message") && /\p{Script=Han}/u.test(request.message ?? "")) issues.push("本次補充說明含中文字，英文通知需使用英文補充說明。");
      if (!issues.length && /\p{Script=Han}/u.test(script)) issues.push("英文講稿含中文字，請修改這段的固定字句。");
    }
    return {hash, scope: "shared", shared: true, language, purpose, label: voiceTextLayout[purpose].label,
      voice, speed, script, parts: [...voiceTexts[language][purpose]], tokens, issues,
      locale: language === "yue" ? "zh-HK" : "en-US"};
  });
}
// Retain recognition of historical pinned MP3 plans, whose audio is already saved.
export function generatedVoiceMode(mode) { return ["azure-mp3", "local-mp3"].includes(mode); }
export function descriptorsForConfig(config, language, site, request) {
  if (config.voiceClips.mode !== "local-mp3") throw Error("New MP3 generation requires local speech");
  return localSynthesisDescriptors(config.localSpeech, language, site, request, config.voiceTexts);
}
