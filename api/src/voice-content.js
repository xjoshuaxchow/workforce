import { WORKFORCE_TIMEZONE } from "./domain.js";
const voices = {
  en: { language: "en-GB", voice: "Google.en-GB-Standard-A" },
  yue: { language: "yue-HK", voice: "Google.yue-HK-Standard-A" },
  zh: { language: "cmn-CN", voice: "Google.cmn-CN-Standard-A" },
};
const token = (key, label) => ({ key, label });
const person = token("staff_name", "員工姓名"),
  location = token("location", "地點與地址"),
  start = token("start", "開始日期與時間"),
  end = token("end", "結束日期與時間");
export const voiceTextLayout = {
  offer: {
    label: "工作邀請及按鍵提示",
    tokens: [person, location, start, end, token("message", "調度補充說明"),
      token("accept_key", "接受鍵 1"), token("decline_key", "拒絕鍵 2"), token("repeat_key", "重聽鍵 9")],
  },
  confirmation: { label: "接單確認", tokens: [] },
  cancellation: { label: "取消通知", tokens: [] },
  ack: { label: "收妥回覆", tokens: [] },
  no_input: { label: "無按鍵回覆", tokens: [] },
  unavailable: { label: "額滿／無法接單", tokens: [] },
};
const defaults = {
  en: {
    offer: ["Hello ", ". This is a shift offer at ", ", from ", " to ", ". ", " Press ", " to accept. Press ", " to decline. Press ", " to repeat."],
    confirmation: ["Your shift has been confirmed. Please check your work schedule or contact your supervisor for details. Thank you."],
    cancellation: ["Your work arrangement has been cancelled. Please check WhatsApp or contact your supervisor for details. Thank you."],
    ack: ["Your response has been received. Thank you."],
    no_input: ["No key was pressed. Goodbye."],
    unavailable: ["This shift is no longer available. Thank you."],
  },
  yue: {
    offer: ["", "，你好。有一個更次邀請，地點係", "，由", "至", "。", " 接受請按", "，拒絕請按", "，重聽請按", "。"],
    confirmation: ["你嘅更次已經確認。請查看工作安排，或者聯絡主管了解詳情。多謝。"],
    cancellation: ["你嘅工作安排已經取消。請查看 WhatsApp，或者聯絡主管了解詳情。多謝。"],
    ack: ["已收到你嘅回覆。多謝。"],
    no_input: ["未收到你嘅按鍵回覆。再見。"],
    unavailable: ["呢個更次已經唔可以接受。多謝。"],
  },
  zh: {
    offer: ["", "，您好。有一个班次邀请，地点是", "，从", "至", "。", " 接受请按", "，拒绝请按", "，重听请按", "。"],
    confirmation: ["您的班次已确认。请查看工作安排或联系主管了解详情。谢谢。"],
    cancellation: ["您的工作安排已取消。请查看 WhatsApp 或联系主管了解详情。谢谢。"],
    ack: ["已收到您的回复。谢谢。"],
    no_input: ["没有收到按键回复。再见。"],
    unavailable: ["这个班次已无法接受。谢谢。"],
  },
};
// Old settings versions retain their original four dynamic tokens.
export function voiceTokens(purpose, parts) {
  return ["confirmation", "cancellation"].includes(purpose) && parts?.length === 5
    ? [person, location, start, end] : voiceTextLayout[purpose].tokens;
}
export function defaultVoiceTexts() {
  return structuredClone(defaults);
}
export function voiceProfile(language) {
  if (!Object.hasOwn(voices, language))
    throw Object.assign(Error("Unsupported employee voice language"), {
      retryable: false,
      code: "missing_voice_language",
    });
  return voices[language];
}
function spokenTime(value, timezone, language, includeOffset) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
    }).formatToParts(new Date(value)).map(({ type, value }) => [type, value]),
  );
  const offset = includeOffset ? ` ${parts.timeZoneName}` : "";
  if (language === "en")
    return `${parts.day} ${parts.month} ${parts.year} at ${parts.hour}:${parts.minute}${offset}`;
  const date = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(new Date(value)).map(({ type, value }) => [type, value]),
  );
  return `${date.year}年${Number(date.month)}月${Number(date.day)}日${Number(parts.hour)}${language === "yue" ? "點" : "点"}${parts.minute}分${offset}`;
}
export function voiceTextValues(staff, site, request, { includeOffset = true } = {}) {
  const language = staff.language;
  return {
      staff_name: staff.name,
      location: [site.name, site.address].filter(Boolean).join("，"),
      start: spokenTime(request.start_at, WORKFORCE_TIMEZONE, language, includeOffset),
      end: spokenTime(request.end_at, WORKFORCE_TIMEZONE, language, includeOffset),
      message: request.message?.trim() ?? "",
      accept_key: "1", decline_key: "2", repeat_key: "9",
    };
}
export function buildVoiceContent(purpose, staff, site, request, voiceTexts = defaultVoiceTexts(), options) {
  const language = staff.language, profile = voiceProfile(language), values = voiceTextValues(staff, site, request, options);
  const render = (kind) => voiceTexts[language][kind]
    .map((text, i) => text + (voiceTokens(kind, voiceTexts[language][kind])[i] ? values[voiceTokens(kind, voiceTexts[language][kind])[i].key] : ""))
    .join("");
  const kind = purpose === "filled" ? "unavailable" : purpose;
  if (!Object.hasOwn(voiceTextLayout, kind)) throw Error("Unsupported voice purpose");
  return {
    ...profile,
    script: render(kind),
    prompts: Object.fromEntries(["ack", "no_input", "unavailable"].map((name) => [name, render(name)])),
    ...(purpose === "offer" ? { repeat_dtmf: "9" } : {}),
  };
}
