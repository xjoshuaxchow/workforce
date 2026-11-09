import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
export interface Config {
  appId: string;
  appSecret: string;
  graphVersion: string;
  businessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  apiKey: string;
  port: number;
  mediaPath: string;
  configPath: string;
  inboundWebhookUrl?: string;
  inboundWebhookSecret?: string;
  concurrency: number;
  sendIntervalMs: number;
  recipientIntervalMs: number;
  leaseSeconds: number;
  maxAttempts: number;
  requestTimeoutMs: number;
}
export function storagePaths() {
  return {
    configPath: process.env.CONFIG_PATH ?? "/run/service-config",
    mediaPath: "/data/media",
  };
}
export async function loadConfig(): Promise<Config> {
  const schema = z.object({
    META_APP_ID: z.string().regex(/^\d+$/),
    META_APP_SECRET: z.string().min(1),
    META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.0$/),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().regex(/^\d+$/),
    WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
    INBOUND_WEBHOOK_URL: z.preprocess(
      (v) => v || undefined,
      z.url().optional(),
    ),
    INBOUND_WEBHOOK_SECRET: z.preprocess(
      (v) => v || undefined,
      z.string().min(16).optional(),
    ),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
    SEND_INTERVAL_MS: z.coerce.number().int().min(0).default(200),
    RECIPIENT_INTERVAL_MS: z.coerce.number().int().min(0).default(6000),
  });
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      "Invalid environment settings: " +
        result.error.issues.map((x) => x.path.join(".")).join(", "),
    );
  const e = result.data;
  if (Boolean(e.INBOUND_WEBHOOK_URL) !== Boolean(e.INBOUND_WEBHOOK_SECRET))
    throw new Error(
      "Set INBOUND_WEBHOOK_URL and INBOUND_WEBHOOK_SECRET together",
    );
  if (e.INBOUND_WEBHOOK_URL) {
    const u = new URL(e.INBOUND_WEBHOOK_URL);
    if (u.protocol !== "https:" || u.username || u.password)
      throw new Error("INBOUND_WEBHOOK_URL must be HTTPS without credentials");
  }
  const paths = storagePaths();
  const apiKey = (
    await readFile(join(paths.configPath, "api-key"), "utf8")
  ).trim();
  if (apiKey.length < 32)
    throw new Error("Generated API key is missing or invalid; run init");
  return {
    ...paths,
    apiKey,
    port: 3000,
    appId: e.META_APP_ID,
    appSecret: e.META_APP_SECRET,
    graphVersion: e.META_GRAPH_API_VERSION,
    businessAccountId: e.WHATSAPP_BUSINESS_ACCOUNT_ID,
    phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: e.WHATSAPP_ACCESS_TOKEN,
    verifyToken: e.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    inboundWebhookUrl: e.INBOUND_WEBHOOK_URL,
    inboundWebhookSecret: e.INBOUND_WEBHOOK_SECRET,
    concurrency: e.WORKER_CONCURRENCY,
    sendIntervalMs: e.SEND_INTERVAL_MS,
    recipientIntervalMs: e.RECIPIENT_INTERVAL_MS,
    leaseSeconds: 120,
    maxAttempts: 5,
    requestTimeoutMs: 30000,
  };
}
