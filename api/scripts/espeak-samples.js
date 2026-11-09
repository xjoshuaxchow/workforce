import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createEspeakClient } from "../src/espeak-speech.js";

const folder = resolve(process.argv[2] ?? ".local/espeak-samples");
await mkdir(folder, { recursive: true });
const samples = [
  { language: "en", voice: "en-gb", script: "Hello. This is a shift offer at the Kowloon Bay test office, on the tenth of November, from nine in the morning to five in the afternoon. Press one to accept, two to decline, or nine to repeat." },
  { language: "yue", voice: "yue", script: "同事，你好。有一份工作邀請，地點係九龍灣測試辦公室。日期係十一月十日，由朝早九點至下午五點。接受請按一，拒絕請按二，重聽請按九。" },
];
const client = createEspeakClient(), results = [];
for (const sample of samples) {
  const start = performance.now();
  const bytes = await client.synthesize({ ...sample, rate: 160 });
  const elapsed_ms = Math.round(performance.now() - start);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw Error("Expected WAV");
  let audioBytes = 0, byteRate = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", at, at + 4), size = bytes.readUInt32LE(at + 4);
    if (at + 8 + size > bytes.length) throw Error("Truncated WAV");
    if (kind === "fmt ") byteRate = bytes.readUInt32LE(at + 16);
    if (kind === "data") audioBytes = size;
    at += 8 + size + size % 2;
  }
  if (!audioBytes || !byteRate) throw Error("Empty WAV");
  const path = join(folder, `${sample.language}.wav`);
  await writeFile(path, bytes);
  results.push({ language: sample.language, path, elapsed_ms, file_bytes: bytes.length, audio_seconds: +(audioBytes / byteRate).toFixed(2) });
}
let installed;
try { installed = JSON.parse(await readFile(new URL("../.local/espeak/workforce-install.json", import.meta.url), "utf8")); } catch {}
const report = { runtime_bytes: installed?.runtime_bytes, samples: results };
await writeFile(join(folder, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
