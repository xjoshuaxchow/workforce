import express, { type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, basename } from "node:path";
import { z, ZodError } from "zod";
import { AppError } from "./errors.js";
import { constantEqual, verifyMetaSignature } from "./security.js";
import {
  batchSchema,
  createTemplateSchema,
  listMessagesSchema,
  messageSchema,
  templateBatchSchema,
  updateTemplateSchema,
  uuid,
  phone,
} from "./validation.js";
import {
  enqueueMessages,
  getMessage,
  listMessages,
} from "./repositories/messages.js";
import { receiveWebhook } from "./services/webhooks.js";
import { TemplateService } from "./services/templates.js";
import { transaction } from "./db.js";
import { ProviderError } from "./meta.js";
import type { Dependencies } from "./worker.js";
import { logger } from "./logger.js";
import {
  conversationQuery,
  listConversations,
  getConversation,
} from "./repositories/conversations.js";
import { mediaRules } from "./media/download.js";
import { openapi } from "./openapi.js";

export function createApp({ pool, config, meta, media }: Dependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.on("finish", () => {
      if (process.env.NODE_ENV !== "test")
        logger.info(
          {
            requestId: id,
            method: req.method,
            route: req.route?.path ?? "unmatched",
            status: res.statusCode,
          },
          "request",
        );
    });
    next();
  });
  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/health/ready", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      await access(config.mediaPath, constants.R_OK | constants.W_OK);
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.get("/webhooks/whatsapp", (req, res) => {
    if (
      req.query["hub.mode"] !== "subscribe" ||
      typeof req.query["hub.verify_token"] !== "string" ||
      !constantEqual(req.query["hub.verify_token"], config.verifyToken) ||
      typeof req.query["hub.challenge"] !== "string"
    )
      throw new AppError(
        403,
        "VERIFICATION_FAILED",
        "Webhook verification failed",
      );
    res.type("text/plain").send(req.query["hub.challenge"]);
  });
  app.post(
    "/webhooks/whatsapp",
    express.raw({ type: "application/json", limit: "8mb" }),
    async (req, res) => {
      if (
        !Buffer.isBuffer(req.body) ||
        !verifyMetaSignature(
          req.body,
          req.get("X-Hub-Signature-256"),
          config.appSecret,
        )
      )
        throw new AppError(
          401,
          "INVALID_SIGNATURE",
          "Invalid webhook signature",
        );
      let payload: any;
      try {
        payload = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw new AppError(400, "INVALID_JSON", "Malformed JSON");
      }
      await receiveWebhook(pool, config, payload);
      res.json({ received: true });
    },
  );
  app.use("/v1", (req, _res, next) => {
    const value = req.get("Authorization");
    if (
      !value?.startsWith("Bearer ") ||
      !constantEqual(value.slice(7), config.apiKey)
    )
      throw new AppError(
        401,
        "UNAUTHORIZED",
        "A valid bearer API key is required",
      );
    next();
  });
  app.use(express.json({ limit: "16mb" }));
  const router = express.Router();
  router.get("/openapi.json", (_req, res) => res.json(openapi));
  router.get("/message-requests/:key", async (req, res) => {
    const key = z.string().min(1).max(200).parse(req.params.key);
    const scope = z
      .enum(["single", "batch", "template-batch"])
      .default("single")
      .parse(req.query.scope);
    const result = await pool.query(
      "SELECT response FROM idempotency_keys WHERE scope=$2 AND key=$1",
      [key, scope],
    );
    if (!result.rowCount)
      throw new AppError(404, "NOT_FOUND", "Send request not found");
    res.json(result.rows[0].response);
  });
  router.get("/conversations", async (req, res) => {
    res.json(await listConversations(pool, conversationQuery.parse(req.query)));
  });
  router.get("/conversations/:contact", async (req, res) => {
    res.json(await getConversation(pool, phone.parse(req.params.contact)));
  });
  router.post("/conversations/:contact/read", async (req, res) => {
    const contact = phone.parse(req.params.contact);
    const { messageIds } = z
      .object({ messageIds: z.array(uuid).min(1).max(100) })
      .strict()
      .parse(req.body);
    const ids = [...new Set(messageIds)];
    const messages = (
      await pool.query(
        "SELECT id,meta_id,read_at FROM messages WHERE id=ANY($1::uuid[]) AND contact_id=$2 AND direction='inbound' AND type<>'reaction'",
        [ids, contact],
      )
    ).rows;
    if (messages.length !== ids.length)
      throw new AppError(
        422,
        "INVALID_MESSAGE",
        "Read receipts must belong to this conversation",
      );
    const readIds: string[] = [];
    const failedIds: string[] = [];
    // Only acknowledge the explicit IDs, never a moving timestamp boundary.
    for (const message of messages) {
      try {
        if (!message.read_at) {
          await meta.markRead(message.meta_id);
          await pool.query(
            "UPDATE messages SET read_at=COALESCE(read_at,now()),updated_at=now() WHERE id=$1",
            [message.id],
          );
        }
        readIds.push(message.id);
      } catch {
        failedIds.push(message.id);
      }
    }
    res.json({ readIds, failedIds });
  });
  router.post("/media", async (req, res) => {
    const kind = z.enum(["image", "document"]).parse(req.query.kind);
    const mime = z.string().max(150).parse(req.get("X-Media-Type"));
    if (!req.is("application/octet-stream"))
      throw new AppError(
        415,
        "INVALID_UPLOAD",
        "Upload raw file bytes as application/octet-stream",
      );
    if (Number(req.get("Content-Length")) > mediaRules[kind].max)
      throw new AppError(
        413,
        "MEDIA_TOO_LARGE",
        "File exceeds its type size limit",
      );
    if (!media.upload)
      throw new AppError(
        503,
        "UPLOAD_UNAVAILABLE",
        "Media uploads are unavailable",
      );
    res.status(201).json(await media.upload(req, kind, mime));
  });

  const idempotency = (req: express.Request) => {
    const key = req.get("Idempotency-Key");
    if (!key || key.length > 200)
      throw new AppError(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Provide an Idempotency-Key of 1–200 characters",
      );
    return key;
  };
  router.post("/messages", async (req, res) => {
    const key = idempotency(req);
    const message = messageSchema.parse(req.body);
    res
      .status(202)
      .json(await enqueueMessages(pool, "single", key, [message], false));
  });
  router.post("/messages/batch", async (req, res) => {
    const key = idempotency(req);
    const body = batchSchema.parse(req.body);
    res
      .status(202)
      .json(await enqueueMessages(pool, "batch", key, body.messages, true));
  });
  router.post("/messages/templates/batch", async (req, res) => {
    const key = idempotency(req);
    const body = templateBatchSchema.parse(req.body);
    const messages = body.recipients.map((recipient) =>
      messageSchema.parse({
        to: recipient.to,
        type: "template",
        template: {
          name: body.name,
          language: body.language,
          components: recipient.components,
        },
      }),
    );
    res
      .status(202)
      .json(await enqueueMessages(pool, "template-batch", key, messages, true));
  });
  router.get("/messages", async (req, res) =>
    res.json(await listMessages(pool, listMessagesSchema.parse(req.query))),
  );
  router.get("/messages/:id", async (req, res) =>
    res.json(await getMessage(pool, uuid.parse(req.params.id))),
  );
  router.post("/messages/:id/read", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const message = await getMessage(pool, id);
    if (
      message.direction !== "inbound" ||
      message.type === "reaction" ||
      !message.meta_id
    )
      throw new AppError(
        409,
        "INVALID_MESSAGE",
        "Only received messages can be marked read",
      );
    await meta.markRead(message.meta_id);
    const result = await pool.query(
      "UPDATE messages SET read_at=COALESCE(read_at,now()),updated_at=now() WHERE id=$1 RETURNING read_at",
      [id],
    );
    res.json({ success: true, readAt: result.rows[0].read_at });
  });
  async function requireBatch(id: string) {
    const result = await pool.query("SELECT * FROM batches WHERE id=$1", [id]);
    if (!result.rowCount)
      throw new AppError(404, "NOT_FOUND", "Batch not found");
    return result.rows[0];
  }
  router.get("/batches/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const batch = await requireBatch(id);
    const counts = await pool.query(
      "SELECT submission_status,delivery_status,count(*)::int AS count FROM messages WHERE batch_id=$1 GROUP BY submission_status,delivery_status",
      [id],
    );
    const submission: Record<string, number> = {};
    const delivery: Record<string, number> = {};
    for (const row of counts.rows) {
      submission[row.submission_status] =
        (submission[row.submission_status] ?? 0) + row.count;
      if (row.delivery_status)
        delivery[row.delivery_status] =
          (delivery[row.delivery_status] ?? 0) + row.count;
    }
    res.json({ ...batch, submission, delivery });
  });
  router.get("/batches/:id/messages", async (req, res) => {
    const id = uuid.parse(req.params.id);
    await requireBatch(id);
    res.json(
      await listMessages(
        pool,
        listMessagesSchema.parse({ ...req.query, batchId: id }),
      ),
    );
  });
  const templates = new TemplateService(pool, meta, media);
  const metaId = z.string().regex(/^\d+$/);
  router.post("/templates", async (req, res) =>
    res
      .status(201)
      .json(await templates.create(createTemplateSchema.parse(req.body))),
  );
  router.get("/templates", async (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().max(2048).optional(),
        name: z.string().max(512).optional(),
        language: z.string().max(20).optional(),
        status: z.string().max(40).optional(),
      })
      .strict()
      .parse(req.query);
    res.json(await templates.list(query));
  });
  router.get("/templates/:id", async (req, res) =>
    res.json(await templates.get(metaId.parse(req.params.id))),
  );
  router.put("/templates/:id/default-image", async (req, res) =>
    res.json(await templates.setDefaultImage(
      metaId.parse(req.params.id),
      z.object({ mediaId: uuid }).strict().parse(req.body).mediaId,
    )),
  );
  router.patch("/templates/:id", async (req, res) =>
    res.json(
      await templates.update(
        metaId.parse(req.params.id),
        updateTemplateSchema.parse(req.body),
      ),
    ),
  );
  router.delete("/templates/:id", async (req, res) =>
    res.json(await templates.delete(metaId.parse(req.params.id))),
  );
  async function getMedia(id: string) {
    const result = await pool.query("SELECT * FROM media WHERE id=$1", [id]);
    if (!result.rowCount)
      throw new AppError(404, "NOT_FOUND", "Media not found");
    return result.rows[0];
  }
  router.get("/media/:id", async (req, res) => {
    const { filename, source_url, ...asset } = await getMedia(
      uuid.parse(req.params.id),
    );
    res.json({ ...asset, contentPath: `/v1/media/${asset.id}/content` });
  });
  router.get("/media/:id/content", async (req, res, next) => {
    const asset = await getMedia(uuid.parse(req.params.id));
    if (!asset.filename)
      throw new AppError(
        409,
        "MEDIA_NOT_READY",
        "Media has not been archived yet",
      );
    if (basename(asset.filename) !== asset.filename)
      throw new AppError(500, "INVALID_ARCHIVE", "Invalid archive path");
    res.type(asset.mime_type ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${asset.id}"`);
    res.sendFile(
      resolve(config.mediaPath, asset.filename),
      { dotfiles: "deny" },
      (error) => {
        if (error) next(error);
      },
    );
  });
  router.post("/media/:id/retry", async (req, res) => {
    const id = uuid.parse(req.params.id);
    await transaction(pool, async (client) => {
      // Match the worker's job-before-resource lock order.
      const job = (
        await client.query(
          "SELECT * FROM jobs WHERE kind='archive' AND media_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      const asset = (
        await client.query("SELECT * FROM media WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!asset) throw new AppError(404, "NOT_FOUND", "Media not found");
      if (asset.status !== "failed")
        throw new AppError(
          409,
          "NOT_FAILED",
          "Only failed archives can be retried",
        );
      if (job && ["pending", "running"].includes(job.state))
        throw new AppError(
          409,
          "ALREADY_QUEUED",
          "An archive job is already active",
        );
      await client.query(
        "UPDATE media SET status='pending',last_error=NULL WHERE id=$1",
        [id],
      );
      if (job)
        await client.query(
          "UPDATE jobs SET state='pending',attempts=0,available_at=now(),last_error=NULL WHERE id=$1",
          [job.id],
        );
      else
        await client.query(
          "INSERT INTO jobs(kind,media_id) VALUES('archive',$1)",
          [id],
        );
    });
    res.status(202).json({ id, status: "pending" });
  });
  router.post("/webhook-deliveries/:id/retry", async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (!config.inboundWebhookUrl)
      throw new AppError(
        409,
        "FORWARDING_DISABLED",
        "Configure forwarding before replaying",
      );
    await transaction(pool, async (client) => {
      const job = (
        await client.query(
          "SELECT * FROM jobs WHERE kind='notify' AND delivery_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!job) throw new AppError(404, "NOT_FOUND", "Notification not found");
      if (job.state !== "failed")
        throw new AppError(
          409,
          "NOT_FAILED",
          "Only failed notifications can be replayed",
        );
      await client.query(
        "UPDATE webhook_deliveries SET status='pending',last_error=NULL WHERE id=$1",
        [id],
      );
      await client.query(
        "UPDATE jobs SET state='pending',attempts=0,available_at=now(),last_error=NULL WHERE id=$1",
        [job.id],
      );
    });
    res.status(202).json({ eventId: id, status: "pending" });
  });
  app.use("/v1", router);
  app.use((_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "Route not found")),
  );
  const handler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ZodError) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.issues.map((x) => ({
            path: x.path,
            message: x.message,
          })),
        },
      });
      return;
    }
    if (error instanceof AppError) {
      let status = error.status;
      if (error instanceof ProviderError)
        status = error.status === 400 && (error.details as { code?: number } | undefined)?.code === 100
          ? 422 : 502;
      res.status(status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({
        error: {
          code: "BODY_TOO_LARGE",
          message: "Request body exceeds its size limit",
        },
      });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res
        .status(400)
        .json({ error: { code: "INVALID_JSON", message: "Malformed JSON" } });
      return;
    }
    logger.error(
      { code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR" },
      "request failed",
    );
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
      },
    });
  };
  app.use(handler);
  return app;
}
