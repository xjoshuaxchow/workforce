import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localVoices } from "./voice-synthesis-content.js";
import { validMp3 } from "./audio-validation.js";

const defaultRoot = fileURLToPath(new URL("../.local/onnx-tts", import.meta.url));
let engineQueue = Promise.resolve();
const localError = message => Object.assign(Error(message), { uncertain: false, userMessage: message });
function voiceFailure(stderr, descriptor) {
  for (const line of stderr.split(/\r?\n/).reverse()) {
    if (!line.startsWith("WORKFORCE_TTS_ERROR ")) continue;
    try {
      const diagnostic = JSON.parse(line.slice("WORKFORCE_TTS_ERROR ".length));
      const chars = diagnostic.characters;
      if (diagnostic.code === "unsupported_characters" && Array.isArray(chars) && chars.length > 0 && chars.length <= 12 && chars.every(c => typeof c === "string" && [...c].length === 1 && !/[\p{Cc}\p{Cf}]/u.test(c) && descriptor.script.includes(c)))
        return localError(`本機聲線不支援以下字元：${chars.join("、")}。請修改講稿或地點資料後重新生成。`);
    } catch { /* Unrecognized process output must never be shown to the user. */ }
  }
  return localError("本機語音生成失敗，請檢查講稿有沒有聲線不支援的字詞。");
}
export function createLocalSpeechClient({ root = defaultRoot, python = join(root, "venv/bin/python"), script = fileURLToPath(new URL("../scripts/local-tts.py", import.meta.url)), timeoutMs = 60000 } = {}) {
  return {
    async status() {
      try {
        const manifest = JSON.parse(await readFile(join(root, "installed.json"), "utf8"));
        if (manifest.version !== "local-v1") return { installed: false, languages: [] };
        await access(python, constants.X_OK);
        const languages = [];
        for (const [language, files] of Object.entries({
          yue: ["yue/vits-cantonese-hf-xiaomaiiwn.onnx", "yue/lexicon.txt", "yue/tokens.txt", "yue/rule.fst"],
          en: ["en/en_US-lessac-medium.onnx", "en/tokens.txt", "en/espeak-ng-data/phontab"],
        })) {
          try { await Promise.all(files.map(file => access(join(root, file)))); languages.push(language); } catch { /* Incomplete language is unavailable. */ }
        }
        return { installed: languages.length === 2, languages };
      } catch { return { installed: false, languages: [] }; }
    },
    async synthesize(descriptor) {
      if (!Object.values(localVoices).includes(descriptor.voice) || localVoices[descriptor.language] !== descriptor.voice) throw localError("Unsupported local voice");
      if (!Number.isFinite(descriptor.speed) || descriptor.speed < 0.7 || descriptor.speed > 1.3) throw localError("Invalid local speech speed");
      if (!descriptor.script?.trim() || descriptor.script.length > 6000 || descriptor.script.includes("\0")) throw localError("Invalid local speech text");
      const previous = engineQueue;
      let release;
      engineQueue = new Promise(resolve => { release = resolve; });
      await previous;
      let folder;
      try {
        folder = await mkdtemp(join(tmpdir(), "workforce-local-tts-"));
        const output = join(folder, "voice.mp3");
        await new Promise((resolve, reject) => {
          const child = spawn(python, [script, "--root", root, "--output", output], { shell: false, stdio: ["pipe", "ignore", "pipe"] });
          let failure, errorBytes = 0, errorText = "";
          const timer = setTimeout(() => { failure = localError("本機語音生成逾時，請縮短講稿後重試。"); child.kill("SIGKILL"); }, timeoutMs);
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", text => { errorBytes += Buffer.byteLength(text); if (errorBytes > 65536) { failure = localError("本機語音生成失敗。"); child.kill("SIGKILL"); } else errorText += text; });
          child.on("error", () => { failure = localError("無法啟動本機語音，請檢查後端安裝。"); });
          child.on("close", code => {
            clearTimeout(timer);
            if (failure) reject(failure);
            else if (code !== 0) reject(voiceFailure(errorText, descriptor));
            else resolve();
          });
          child.stdin.on("error", () => {});
          child.stdin.end(JSON.stringify({ language: descriptor.language, voice: descriptor.voice, script: descriptor.script, speed: descriptor.speed }), "utf8");
        });
        if ((await stat(output)).size > 3 * 1024 * 1024) throw localError("音檔超過 3 MB，請縮短講稿。");
        const bytes = await readFile(output);
        if (!validMp3(bytes)) throw localError("本機未能產生完整 MP3。");
        return bytes;
      } finally {
        try { if (folder) await rm(folder, { recursive: true, force: true }); }
        finally { release(); }
      }
    },
  };
}
