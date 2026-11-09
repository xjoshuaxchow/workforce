import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const espeakVersion = "1.52.0";
const espeakVoiceChoices = { en: ["en-gb", "en-us"], yue: ["yue"] };

export async function espeakBinary() {
  const candidates = process.env.ESPEAK_NG_BIN ? [process.env.ESPEAK_NG_BIN] : [
    fileURLToPath(new URL("../.local/espeak/bin/espeak-ng", import.meta.url)),
    ...(process.env.PATH ?? "").split(delimiter).map(path => join(path, "espeak-ng")),
  ];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next installed location. */ }
  }
  return null;
}
export async function localSpeechAvailable() { return Boolean(await espeakBinary()); }
export function createEspeakClient() {
  return {
    async synthesize({ voice, script, rate = 160 }) {
      if (!Object.values(espeakVoiceChoices).flat().includes(voice)) throw Error("Unsupported local voice");
      if (!Number.isInteger(rate) || rate < 80 || rate > 300) throw Error("Invalid local speech rate");
      if (!script?.trim() || script.length > 6000 || script.includes("\0")) throw Error("Invalid local speech text");
      const binary = await espeakBinary();
      if (!binary) throw Error("請先在後端安裝 eSpeak NG");
      const { stdout } = await promisify(execFile)(binary, ["--version"], { timeout: 5000, maxBuffer: 4096 });
      if (!stdout.includes(`eSpeak NG text-to-speech: ${espeakVersion}`)) throw Error(`需要 eSpeak NG ${espeakVersion}`);
      const folder = await mkdtemp(join(tmpdir(), "workforce-espeak-")), output = join(folder, "voice.wav");
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(binary, ["--stdin", "-b", "1", "-v", voice, "-s", String(rate), "-w", output], { shell: false, stdio: ["pipe", "ignore", "pipe"] });
          let failure = null;
          const timer = setTimeout(() => { failure = Error("本機語音生成逾時"); child.kill("SIGKILL"); }, 30000);
          let errorBytes = 0;
          child.stderr.on("data", bytes => { errorBytes += bytes.length; if (errorBytes > 65536) child.kill("SIGKILL"); });
          child.on("error", () => { clearTimeout(timer); reject(Error("無法啟動本機語音引擎")); });
          child.on("close", code => { clearTimeout(timer); failure ? reject(failure) : code === 0 ? resolve() : reject(Error("本機語音生成失敗")); });
          child.stdin.on("error", () => {});
          child.stdin.end(script, "utf8");
        });
        if ((await stat(output)).size > 3 * 1024 * 1024) throw Error("音檔超過3MB，請縮短講稿");
        return await readFile(output);
      } finally { await rm(folder, { recursive: true, force: true }); }
    },
  };
}
