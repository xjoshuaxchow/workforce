import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "authorization",
      "accessToken",
      "appSecret",
      "apiKey",
      "password",
      "req.headers.authorization",
      "req.body",
    ],
    remove: true,
  },
});
