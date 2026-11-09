import { createHash } from "node:crypto";
import { voiceProfile } from "./voice-content.js";

export const defaultVoiceClips = () => ({ mode: "say", library: { en: {}, yue: {}, zh: {} } });
export function siteClipKey(site) {
  const hash = createHash("sha256").update(JSON.stringify([site.name, site.address ?? "", site.timezone])).digest("hex").slice(0, 16);
  return `site:${site.id}:${hash}`;
}
export function dateClipKeys(value, timezone, language) {
  voiceProfile(language);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  const year = [...p.year].map(n => `digit:${n}`),
    date = language === "en" ? [`day:${+p.day}`, `month:${+p.month}`, ...year, "at"]
      : [...year, "year", `month:${+p.month}`, `day:${+p.day}`];
  return [...date, `hour:${+p.hour}`, `minute:${+p.minute}`, `offset:${p.timeZoneName.replace("GMT", "") || "+00:00"}`];
}
export function clipManifest(purpose, language, site, request) {
  voiceProfile(language);
  const prompts = { ack: ["ack"], no_input: ["no_input"], unavailable: ["unavailable"] };
  if (purpose === "filled") return { main: ["unavailable"], ...prompts };
  if (!["offer", "confirmation", "cancellation"].includes(purpose)) throw Error("Unsupported recorded voice purpose");
  return {
    main: [purpose, siteClipKey(site), "from", ...dateClipKeys(request.start_at, site.timezone, language),
      "to", ...dateClipKeys(request.end_at, site.timezone, language),
      ...(purpose === "offer" ? [...(request.message?.trim() ? ["message"] : []), "keys"] : [])],
    ...prompts,
  };
}
const common = {
  en: { offer: "Hello. There is a shift offer at", confirmation: "Hello. Your shift is confirmed at", cancellation: "Hello. Your shift has been cancelled at", from: "from", to: "to", at: "at", keys: "Press 1 to accept, 2 to decline, or 9 to repeat.", ack: "Your response has been received. Thank you.", no_input: "No key was pressed. Goodbye.", unavailable: "This shift is no longer available. Thank you." },
  yue: { offer: "你好，有一個更次邀請，地點係", confirmation: "你好，你嘅更次已確認，地點係", cancellation: "你好，你嘅更次已取消，地點係", from: "由", to: "至", year: "年", keys: "接受請按一，拒絕請按二，重聽請按九。", ack: "已收到你嘅回覆，多謝。", no_input: "未收到你嘅按鍵回覆，再見。", unavailable: "呢個更次已經唔可以接受，多謝。" },
  zh: { offer: "您好，有一个班次邀请，地点是", confirmation: "您好，您的班次已确认，地点是", cancellation: "您好，您的班次已取消，地点是", from: "从", to: "至", year: "年", keys: "接受请按一，拒绝请按二，重听请按九。", ack: "已收到您的回复，谢谢。", no_input: "没有收到按键回复，再见。", unavailable: "这个班次已无法接受，谢谢。" },
};
const labels = { offer: "工作邀請開場", confirmation: "接單確認開場", cancellation: "取消通知開場", from: "開始連接詞", to: "結束連接詞", at: "時間連接詞", year: "年單位", keys: "按鍵提示（1／2／9）", ack: "收妥回覆", no_input: "無按鍵回覆", unavailable: "額滿／無法接單" };
const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const enDigits = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
function chinese(n) { return n < 10 ? digits[n] : `${n >= 20 ? digits[Math.floor(n / 10)] : ""}十${n % 10 ? digits[n % 10] : ""}`; }
function ordinal(n) { return `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({1:"st",2:"nd",3:"rd"}[n % 10] ?? "th")}`; }
export function clipCatalog(language, sites = []) {
  voiceProfile(language);
  const items = Object.entries(common[language]).map(([key, sample]) => ({ key, sample, label: labels[key], category: "提示" }));
  const add = (key, category, label, sample) => items.push({ key, category, label, sample });
  for (let n = 0; n <= 9; n++) add(`digit:${n}`, "年份數字", `年份數字 ${n}`, language === "en" ? enDigits[n] : digits[n]);
  for (let n = 1; n <= 12; n++) add(`month:${n}`, "月份", `${n} 月`, language === "en" ? new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, n - 1, 1))) : `${chinese(n)}月`);
  for (let n = 1; n <= 31; n++) add(`day:${n}`, "日期", `${n} 號`, language === "en" ? `the ${ordinal(n)}` : `${chinese(n)}${language === "yue" ? "號" : "日"}`);
  for (let n = 0; n <= 23; n++) add(`hour:${n}`, "小時", `${String(n).padStart(2,"0")} 時（24 小時制）`, language === "en" ? String(n) : `${chinese(n)}${language === "yue" ? "點" : "点"}`);
  for (let n = 0; n <= 59; n++) add(`minute:${n}`, "分鐘", `${String(n).padStart(2,"0")} 分`, language === "en" ? (n === 0 ? "o'clock" : n < 10 ? `oh ${enDigits[n]}` : String(n)) : n === 0 ? "正" : `${n < 10 ? "零" : ""}${chinese(n)}分`);
  for (let minutes = -720; minutes <= 840; minutes += 15) {
    const offset = `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2,"0")}:${String(Math.abs(minutes) % 60).padStart(2,"0")}`;
    add(`offset:${offset}`, "時差", `UTC${offset}`, language === "en" ? `UTC ${minutes < 0 ? "minus" : "plus"} ${Math.floor(Math.abs(minutes)/60)} hours ${Math.abs(minutes)%60} minutes` : `協調世界時${minutes < 0 ? "減" : "加"}${chinese(Math.floor(Math.abs(minutes)/60))}小時${chinese(Math.abs(minutes)%60)}分鐘`);
  }
  for (const site of sites) add(siteClipKey(site), "地點", site.name, [site.name, site.address].filter(Boolean).join("，"));
  return items;
}
