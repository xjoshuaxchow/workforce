import { defineConfig } from "@playwright/test";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
const api = process.env.WORKFORCE_API_DIR ?? resolve("../api");
const privateEnv = parseEnv(readFileSync(resolve(api, ".env"), "utf8"));
const runtimeEnv = {
  ...privateEnv,
  PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
};
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 15000,
  use: {
    baseURL: "http://127.0.0.1:5211",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node scripts/e2e-api.js",
      cwd: api,
      port: 8311,
      reuseExistingServer: false,
      env: runtimeEnv,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5211 --strictPort",
      port: 5211,
      reuseExistingServer: false,
      env: { ...runtimeEnv, WORKFORCE_API_URL: "http://127.0.0.1:8311" },
    },
  ],
});
