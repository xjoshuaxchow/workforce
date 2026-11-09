import { execFileSync } from "node:child_process";
import { lstatSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, basename } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString().split("\0").filter(Boolean))];
const failures = [];
for (const folder of ["ams", "api", "whatsapp-microservice"]) {
  if (existsSync(resolve(root, folder, ".git"))) failures.push(`${folder}: nested Git metadata`);
}
for (const file of files) {
  const name = basename(file), parts = file.split("/");
  const example = name === ".env.example" || /^\.env\..+\.example$/.test(name);
  if ((name.startsWith(".env") && !example) || parts.some(p => ["node_modules", ".local", ".git", "dist", "coverage", "test-results", "playwright-report", "backups"].includes(p)) || /\.(?:pem|p12|key|onnx|sqlite3?|dump)$/i.test(name)) failures.push(`${file}: private or generated path`);
  if (/\.(?:mp3|wav)$/i.test(name) && file !== "api/test/fixtures/silence.mp3") failures.push(`${file}: generated audio`);
  const stat = lstatSync(resolve(root, file));
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 5 * 1024 * 1024) failures.push(`${file}: unexpected file type or size`);
  if (stat.isFile() && /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(readFileSync(resolve(root, file), "utf8"))) failures.push(`${file}: private key material`);
}
for (const path of ["api/.env", "api/.env.local", "api/.local/settings.key", "api/.local/onnx-tts/yue/model.onnx", "whatsapp-microservice/.env"]) {
  try { execFileSync("git", ["check-ignore", "-q", path], { cwd: root }); } catch { failures.push(`${path}: ignore rule missing`); }
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Repository check passed: ${files.length} source files; private settings, runtime files and nested Git excluded.`);
