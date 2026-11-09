import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createLocalSpeechClient } from "../src/local-speech.js";
import { localSynthesisDescriptors } from "../src/voice-synthesis-content.js";
const folder = resolve(process.argv[2] ?? ".local/local-tts-samples");
await mkdir(folder, { recursive: true });
const client = createLocalSpeechClient();
const status = await client.status();
if (!status.installed) throw Error("Install local TTS first");
const request = { id: "local-audition", channels: ["voice"], start_at: "2099-11-10T01:00:00Z", end_at: "2099-11-10T09:00:00Z", message: "" };
const results = [];
for (const language of ["yue", "en"]) {
  const site = { name: language === "yue" ? "九龍灣測試辦公室" : "Kowloon Bay Test Office", address: "", timezone: "Asia/Hong_Kong" };
  const descriptor = localSynthesisDescriptors({ speed: 1 }, language, site, request)[0];
  const started = performance.now(), bytes = await client.synthesize(descriptor);
  const output = join(folder, `${language}.mp3`);
  await writeFile(output, bytes);
  results.push({ language, script: descriptor.script, path: output, file_bytes: bytes.length, generation_ms: Math.round(performance.now() - started) });
}
await writeFile(join(folder, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
