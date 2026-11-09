import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { ProviderError } from "../src/meta.js";
import { migrate } from "../src/migrate.js";
import { MediaStore } from "../src/media/store.js";
import { receiveWebhook } from "../src/services/webhooks.js";
import { Worker } from "../src/worker.js";
import type { Config } from "../src/config.js";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 54329,
  user: "whatsapp_test",
  password: "local-test-only",
  database: "whatsapp_test",
});
const config: Config = {
  appId: "123",
  appSecret: "fixture",
  graphVersion: "v25.0",
  businessAccountId: "123",
  phoneNumberId: "456",
  accessToken: "fixture",
  verifyToken: "fixture",
  apiKey: "fixture-key",
  port: 3000,
  mediaPath: "",
  configPath: "",
  concurrency: 2,
  sendIntervalMs: 0,
  recipientIntervalMs: 0,
  leaseSeconds: 60,
  maxAttempts: 5,
  requestTimeoutMs: 1000,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=",
  "base64",
);
const auth = { Authorization: "Bearer fixture-key" };
let calls: { read: string[]; send: any[]; uploads: number; templates: any[] };
const meta: any = {
  markRead: async (id: string) => {
    if (id === "wamid.fail") throw new Error("provider unavailable");
    calls.read.push(id);
    return { success: true };
  },
  send: async (payload: any) => {
    calls.send.push(payload);
    return { messages: [{ id: `wamid.sent-${calls.send.length}` }] };
  },
  uploadMedia: async () => {
    calls.uploads++;
    return `uploaded-${calls.uploads}`;
  },
  uploadSample: async () => "sample-handle",
  createTemplate: async (payload: any) => {
    calls.templates.push(payload);
    return { id: "900", status: "PENDING" };
  },
  getTemplate: async () => ({ ...calls.templates[0], id: "900", status: "APPROVED" }),
  listTemplates: async () => ({ data: [{ ...calls.templates[0], id: "900", status: "APPROVED" }], nextCursor: null }),
};
let media: MediaStore;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  config.mediaPath = await mkdtemp(join(tmpdir(), "wa-inbox-spec-"));
  await migrate(pool);
  media = new MediaStore(pool, config, meta);
  app = createApp({ pool, config, meta, media });
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE contacts,messages,media,batches,message_media,jobs,job_attempts,webhook_deliveries,webhook_receipts,status_events,idempotency_keys,templates,rate_limits CASCADE",
  );
  calls = { read: [], send: [], uploads: 0, templates: [] };
});
afterAll(async () => {
  await pool.end();
  await rm(config.mediaPath, { recursive: true, force: true });
});
async function incoming(
  contact: string,
  id: string,
  seconds = Math.floor(Date.now() / 1000),
  message: { type: string; [key: string]: unknown } = {
    type: "text",
    text: { body: "Hello" },
  },
) {
  await receiveWebhook(pool, config, {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "456" },
              contacts: [{ wa_id: contact, profile: { name: "Alice" } }],
              messages: [
                {
                  id,
                  from: contact,
                  timestamp: String(seconds),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  });
  return (await pool.query("SELECT id FROM messages WHERE meta_id=$1", [id]))
    .rows[0].id;
}

describe("shared WhatsApp inbox", () => {
  it("recovers template batches by scoped key without exposing single sends or creating duplicates", async () => {
    const key = "client-a:template-batch";
    const body = { name: "welcome", language: "en_US", recipients: [
      { to: "85291234567", components: [] }, { to: "85292345678", components: [] },
    ] };
    const created = await request(app).post("/v1/messages/templates/batch").set(auth).set("Idempotency-Key", key).send(body);
    expect(created.status).toBe(202);
    const recovered = await request(app).get(`/v1/message-requests/${key}`).query({ scope: "template-batch" }).set(auth);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual(created.body);
    expect((await request(app).get(`/v1/message-requests/${key}`).set(auth)).status).toBe(404);
    expect((await request(app).get(`/v1/message-requests/${key}`).query({ scope: "invalid" }).set(auth)).status).toBe(422);
    expect((await request(app).get(`/v1/message-requests/${key}`).query({ scope: "template-batch" })).status).toBe(401);
    const repeated = await request(app).post("/v1/messages/templates/batch").set(auth).set("Idempotency-Key", key).send(body);
    expect(repeated.body).toEqual(created.body);
    expect((await pool.query("SELECT count(*)::int AS total FROM messages")).rows[0].total).toBe(2);
    const progress = await request(app).get(`/v1/batches/${created.body.batchId}`).set(auth);
    expect(progress.body.submission.queued).toBe(2);
  });
  it("recovers general batches independently of single sends using the same key", async () => {
    const key = "client-b:request-123";
    const message = {
      to: "85291234567",
      type: "text",
      text: { body: "Delivery update" },
    };
    const created = await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", key)
      .send({ messages: [message] });
    expect(created.status).toBe(202);
    const single = await request(app)
      .post("/v1/messages")
      .set(auth)
      .set("Idempotency-Key", key)
      .send(message);
    expect(single.status).toBe(202);
    const recovered = await request(app)
      .get(`/v1/message-requests/${key}`)
      .query({ scope: "batch" })
      .set(auth);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual(created.body);
    expect(
      (await request(app).get(`/v1/message-requests/${key}`).set(auth)).body,
    ).toEqual(single.body);
    const repeated = await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", key)
      .send({ messages: [message] });
    expect(repeated.body).toEqual(created.body);
    expect(
      (await pool.query("SELECT count(*)::int AS total FROM messages")).rows[0]
        .total,
    ).toBe(2);
  });
  it("paginates by contact and timestamp, searches linked contacts, and derives reply windows", async () => {
    await incoming("85291234567", "wamid.a");
    await incoming(
      "85292345678",
      "wamid.b",
      Math.floor(Date.now() / 1000) - 90000,
    );
    await pool.query("UPDATE messages SET created_at='2026-01-01T00:00:00Z'");
    const first = await request(app).get("/v1/conversations?limit=1").set(auth);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    const next = await request(app)
      .get("/v1/conversations")
      .query({ limit: 1, cursor: first.body.nextCursor })
      .set(auth);
    expect(next.body.data).toHaveLength(1);
    expect(first.body.data[0].contact).not.toBe(next.body.data[0].contact);
    expect(
      (await request(app).get("/v1/conversations/85291234567").set(auth)).body
        .canReply,
    ).toBe(true);
    expect(
      (await request(app).get("/v1/conversations/85292345678").set(auth)).body
        .canReply,
    ).toBe(false);
    const search = await request(app)
      .get("/v1/conversations")
      .query({ q: "registered name", contacts: "85291234567" })
      .set(auth);
    expect(search.body.data.map((item: any) => item.contact)).toEqual([
      "85291234567",
    ]);
    expect((await request(app).get("/v1/conversations")).status).toBe(401);
  });
  it("acknowledges only visible incoming IDs and leaves newly arriving and failed receipts unread", async () => {
    const visible = await incoming("85291234567", "wamid.visible");
    const failed = await incoming("85291234567", "wamid.fail");
    const unseen = await incoming("85291234567", "wamid.unseen");
    const response = await request(app)
      .post("/v1/conversations/85291234567/read")
      .set(auth)
      .send({ messageIds: [visible, failed] });
    expect(response.body).toEqual({ readIds: [visible], failedIds: [failed] });
    expect(
      (await request(app).get("/v1/conversations/85291234567").set(auth)).body
        .unreadCount,
    ).toBe(2);
    expect(
      (await pool.query("SELECT read_at FROM messages WHERE id=$1", [unseen]))
        .rows[0].read_at,
    ).toBeNull();
    expect(
      (
        await request(app)
          .post("/v1/conversations/85292345678/read")
          .set(auth)
          .send({ messageIds: [unseen] })
      ).status,
    ).toBe(422);
    await request(app)
      .post("/v1/conversations/85291234567/read")
      .set(auth)
      .send({ messageIds: [visible] });
    expect(calls.read).toEqual(["wamid.visible"]);
  });
  it("keeps reactions out of previews, unread counts, read receipts, and reply windows", async () => {
    const contact = "85291234567";
    const old = Math.floor(Date.now() / 1000) - 90000;
    const target = await incoming(contact, "wamid.target", old);
    const reaction = await incoming(contact, "wamid.reaction", old + 90000, {
      type: "reaction",
      reaction: { message_id: "wamid.target", emoji: "👍" },
    });
    await pool.query("UPDATE contacts SET last_inbound_at=now() WHERE wa_id=$1", [contact]);
    const conversation = (
      await request(app).get(`/v1/conversations/${contact}`).set(auth)
    ).body;
    expect(conversation.lastMessage.meta_id).toBe("wamid.target");
    expect(conversation.lastInboundAt).toBe(new Date(old * 1000).toISOString());
    expect(conversation.canReply).toBe(false);
    expect(conversation.unreadCount).toBe(1);
    const unread = await request(app).get("/v1/conversations?unread=true").set(auth);
    expect(unread.body.data).toHaveLength(1);
    const listed = await request(app).get(`/v1/messages?contact=${contact}`).set(auth);
    expect(listed.body.data.find((item: any) => item.id === reaction).content.reaction)
      .toEqual({ message_id: "wamid.target", emoji: "👍" });
    const batchRead = await request(app).post(`/v1/conversations/${contact}/read`)
      .set(auth).send({ messageIds: [reaction] });
    expect(batchRead.status).toBe(422);
    expect((await request(app).post(`/v1/messages/${reaction}/read`).set(auth)).status)
      .toBe(409);
    expect(calls.read).toEqual([]);
    await request(app).post(`/v1/conversations/${contact}/read`)
      .set(auth).send({ messageIds: [target] });
    expect((await request(app).get("/v1/conversations?unread=true").set(auth)).body.data)
      .toHaveLength(0);
    expect(calls.read).toEqual(["wamid.target"]);
  });
  it("forwards same-ID reaction changes as distinct events after pagination", async () => {
    const contact = "85291234567";
    const at = Math.floor(Date.now() / 1000);
    await incoming(contact, "wamid.target", at - 10);
    const added = {
      type: "reaction",
      reaction: { message_id: "wamid.target", emoji: "👍" },
    };
    const removed = {
      type: "reaction",
      reaction: { message_id: "wamid.target", emoji: "" },
    };
    const originalWebhookUrl = config.inboundWebhookUrl;
    try {
      config.inboundWebhookUrl = "https://example.test/receiver";
      const reaction = await incoming(contact, "wamid.reaction", at, added);
      config.inboundWebhookUrl = undefined;
      for (let i = 0; i < 55; i++)
        await incoming(contact, `wamid.newer-${i}`, at + 1);
      const before = await request(app).get(`/v1/messages?contact=${contact}&limit=50`).set(auth);
      expect(before.body.data.some((item: any) => item.id === reaction)).toBe(false);
      config.inboundWebhookUrl = "https://example.test/receiver";
      await incoming(contact, "wamid.reaction", at + 1, removed);
      await incoming(contact, "wamid.reaction", at + 1, removed);
      await incoming(contact, "wamid.reaction", at + 2, removed);
      await incoming(contact, "wamid.reaction", at - 1, added);
      const newest = await request(app).get(`/v1/messages?contact=${contact}&limit=1`).set(auth);
      expect(newest.body.data[0].id).not.toBe(reaction);
      expect(newest.body.data[0].meta_id).toBeNull();
      expect(newest.body.data[0].content.reaction)
        .toEqual({ message_id: "wamid.target", emoji: "" });
      const reactions = await request(app).get(`/v1/messages?contact=${contact}&type=reaction`).set(auth);
      expect(reactions.body.data).toHaveLength(2);
      expect(reactions.body.data.map((item: any) => item.content.reaction.emoji))
        .toEqual(["", "👍"]);
      expect(reactions.body.data[1].meta_id).toBe("wamid.reaction");
      const deliveries = await pool.query(
        "SELECT payload FROM webhook_deliveries WHERE payload->'message'->>'type'='reaction' ORDER BY payload->>'occurredAt'",
      );
      expect(deliveries.rows).toHaveLength(2);
      expect(deliveries.rows.map((row: any) => row.payload.message.metaId))
        .toEqual(["wamid.reaction", "wamid.reaction"]);
      expect(deliveries.rows.map((row: any) => row.payload.message.content.emoji))
        .toEqual(["👍", ""]);
      expect(deliveries.rows[0].payload.eventId).not.toBe(deliveries.rows[1].payload.eventId);
    } finally {
      config.inboundWebhookUrl = originalWebhookUrl;
    }
  });
  it("uploads privately, sends by local media ID, and keeps the existing idempotency response", async () => {
    const upload = await request(app)
      .post("/v1/media?kind=image")
      .set(auth)
      .set("Content-Type", "application/octet-stream")
      .set("X-Media-Type", "image/png")
      .send(png);
    expect(upload.status).toBe(201);
    const send = () =>
      request(app)
        .post("/v1/messages")
        .set(auth)
        .set("Idempotency-Key", "client-a:upload-send")
        .send({
          to: "85291234567",
          type: "image",
          media: { id: upload.body.id, caption: "Hello" },
        });
    const sent = await send();
    expect(sent.status).toBe(202);
    expect((await send()).body).toEqual(sent.body);
    expect(
      (
        await request(app)
          .get("/v1/message-requests/client-a%3Aupload-send")
          .set(auth)
      ).body,
    ).toEqual(sent.body);
    await new Worker({ pool, config, meta, media }).runOnce();
    expect(calls.uploads).toBe(1);
    expect(calls.send[0].image).toEqual({ id: "uploaded-1", caption: "Hello" });
    expect(
      (await request(app).get(`/v1/media/${upload.body.id}/content`).set(auth))
        .body,
    ).toEqual(png);
    expect(
      (await request(app).get(`/v1/media/${upload.body.id}/content`)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/v1/messages")
          .set(auth)
          .set("Idempotency-Key", "bad-kind")
          .send({
            to: "85291234567",
            type: "document",
            media: { id: upload.body.id },
          })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post("/v1/messages")
          .set(auth)
          .set("Idempotency-Key", "both")
          .send({
            to: "85291234567",
            type: "image",
            media: { id: upload.body.id, url: "https://example.com/a.png" },
          })
      ).status,
    ).toBe(422);
  });
  it("cleans up invalid uploads and uses an archived file as a template approval sample", async () => {
    const before = await readdir(config.mediaPath);
    await expect(
      media.upload(
        Readable.from([Buffer.from("not an image")]),
        "image",
        "image/png",
      ),
    ).rejects.toThrow();
    expect(await readdir(config.mediaPath)).toEqual(before);
    const upload = await media.upload(
      Readable.from([png]),
      "image",
      "image/png",
    );
    const response = await request(app)
      .post("/v1/templates")
      .set(auth)
      .send({
        name: "appointment",
        language: "en_US",
        category: "UTILITY",
        components: [
          { type: "HEADER", format: "IMAGE", sampleMediaId: upload.id },
          { type: "BODY", text: "Appointment confirmed" },
        ],
      });
    expect(response.status).toBe(201);
    expect(response.body.defaultImageId).toBe(upload.id);
    expect(calls.templates[0].components[0]).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["sample-handle"] },
    });
    const listed = await request(app).get("/v1/templates").set(auth);
    expect(listed.body.data[0].defaultImageId).toBe(upload.id);
    const unarchived = await pool.query(
      "INSERT INTO media(kind) VALUES('image') RETURNING id",
    );
    const invalidDefault = await request(app)
      .put("/v1/templates/900/default-image")
      .set(auth)
      .send({ mediaId: unarchived.rows[0].id });
    expect(invalidDefault.status).toBe(422);
    const replacement = await media.upload(Readable.from([png]), "image", "image/png");
    const updated = await request(app)
      .put("/v1/templates/900/default-image")
      .set(auth)
      .send({ mediaId: replacement.id });
    expect(updated.status).toBe(200);
    expect(updated.body.defaultImageId).toBe(replacement.id);
    const refreshed = await request(app).get("/v1/templates/900").set(auth);
    expect(refreshed.body.defaultImageId).toBe(replacement.id);
    const uploadsBeforeReuse = calls.uploads;
    await media.prepare(upload.id);
    expect(calls.uploads).toBe(uploadsBeforeReuse);
    await pool.query("UPDATE media SET updated_at=now()-interval '26 days' WHERE id=$1", [upload.id]);
    await media.prepare(upload.id);
    expect(calls.uploads).toBe(uploadsBeforeReuse + 1);
  });
  it("returns Meta template validation failures as actionable errors", async () => {
    calls.templates.push({
      name: "button_test", language: "en_US", category: "MARKETING",
      components: [{ type: "BODY", text: "Hello" }],
    });
    meta.updateTemplate = async () => {
      throw new ProviderError("Meta rejected the operation", 400, false, false, {
        code: 100,
        error_user_msg: "Active templates can only be edited once every 24 hours.",
      });
    };
    try {
      const response = await request(app).patch("/v1/templates/900").set(auth).send({
        category: "MARKETING",
        components: [{ type: "BODY", text: "Hello" }],
      });
      expect(response.status).toBe(422);
      expect(response.body.error.details.error_user_msg).toContain("24 hours");
    } finally {
      delete meta.updateTemplate;
    }
  });
  it("retries an expired Meta media upload after a temporary failure", async () => {
    const upload = await media.upload(
      Readable.from([png]),
      "image",
      "image/png",
    );
    await media.prepare(upload.id);
    await pool.query(
      "UPDATE media SET updated_at=now()-interval '26 days' WHERE id=$1",
      [upload.id],
    );
    const originalUpload = meta.uploadMedia;
    meta.uploadMedia = async () => {
      throw new Error("Meta temporarily unavailable");
    };
    try {
      await expect(media.prepare(upload.id)).rejects.toThrow(
        "Meta temporarily unavailable",
      );
    } finally {
      meta.uploadMedia = originalUpload;
    }
    await media.prepare(upload.id);
    expect(calls.uploads).toBe(2);
  });
});
