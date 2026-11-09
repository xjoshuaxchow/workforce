import { azureOutputFormat, azureVoiceChoices } from "./voice-synthesis-content.js";

const xml = value => value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" }[c]));
const failure = (message, uncertain) => Object.assign(Error(message), { uncertain });
export function createAzureSpeechClient(config, request = fetch) {
  if (!/^[a-z][a-z0-9]{1,31}$/.test(config.region)) throw failure("Invalid Azure region", false);
  if (!config.key?.trim() || /[\r\n]/.test(config.key)) throw failure("Azure Key 尚未設定或格式無效", false);
  const endpoint = `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  return {
    async synthesize({ voice, locale, script }) {
      if (!Object.values(azureVoiceChoices).flat().includes(voice) || !voice.startsWith(locale + "-")) throw failure("Unsupported Azure voice", false);
      if (!script || script.length > 6000 || !/^[\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]+$/u.test(script)) throw failure("講稿包含無效字元或超過6000字", false);
      let response;
      try {
        response = await request(endpoint, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
          headers: { "Ocp-Apim-Subscription-Key": config.key.trim(), "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": azureOutputFormat, "User-Agent": "Workforce-Audio/1.0" },
          body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}">${xml(script)}</voice></speak>`,
        });
      } catch { throw failure("Azure 連線中斷，生成結果未能確定", true); }
      if (!response.ok) {
        await response.body?.cancel();
        throw failure(`Azure 拒絕生成（HTTP ${response.status}）`, ![400,401,403,404,413,415,429].includes(response.status));
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/mpeg")) {
        await response.body?.cancel();
        throw failure("Azure 回傳格式不正確，生成結果未能確定", true);
      }
      const reader = response.body?.getReader(), chunks = [];
      let size = 0;
      if (!reader) throw failure("Azure 回傳空白音檔", true);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 3 * 1024 * 1024) { await reader.cancel(); throw Error("large"); }
          chunks.push(Buffer.from(value));
        }
      } catch { throw failure("Azure 音檔未能完整接收", true); }
      return Buffer.concat(chunks);
    },
  };
}
