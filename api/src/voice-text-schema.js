import { z } from "zod";
import { voiceTextLayout } from "./voice-content.js";
export function voicePartsSchema(purpose) {
  return z.array(z.string().max(400).regex(
    /^[\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]*$/u,
    "講稿包含不能朗讀的控制字元",
  )).length(voiceTextLayout[purpose].tokens.length + 1)
    .refine(parts => parts.join("").trim().length > 0, "講稿不能全為空白")
    .refine(parts => parts.join("").length <= 1200, "每份講稿的固定字句上限為 1200 字");
}
