import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/migrate.js";
import { transaction } from "../src/db.js";
import { createApp } from "../src/app.js";
import { Worker } from "../src/worker.js";
import { ProviderError } from "../src/meta.js";
import type { Config } from "../src/config.js";
import { MediaStore } from "../src/media/store.js";
import { AppError } from "../src/errors.js";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 54329,
  user: "whatsapp_test",
  password: "local-test-only",
  database: "whatsapp_test",
  max: 10,
});
const config: Config = {
  appId: "123",
  appSecret: "meta-secret",
  graphVersion: "v25.0",
  businessAccountId: "waba",
  phoneNumberId: "phone",
  accessToken: "token",
  verifyToken: "verify",
  apiKey: "test-api-key",
  port: 3000,
  mediaPath: "",
  configPath: "",
  inboundWebhookUrl: "https://receiver.example/webhook",
  inboundWebhookSecret: "callback-secret",
  concurrency: 2,
  sendIntervalMs: 0,
  recipientIntervalMs: 0,
  leaseSeconds: 60,
  maxAttempts: 5,
  requestTimeoutMs: 1000,
};
let root: string;
let sent: any[] = [];
let sendError: Error | undefined;
const templates = new Map<string, any>();
const meta: any = {
  send: async (payload: any) => {
    if (sendError) throw sendError;
    sent.push(payload);
    return { messages: [{ id: `wamid.out-${sent.length}` }] };
  },
  markRead: async () => ({ success: true }),
  listTemplates: async () => ({ data: [...templates.values()] }),
  getTemplate: async (id: string) => templates.get(id),
  createTemplate: async (body: any) => {
    const value = { ...body, id: "100", status: "PENDING" };
    templates.set("100", value);
    return value;
  },
  updateTemplate: async (id: string, body: any) => {
    templates.set(id, { ...templates.get(id), ...body });
    return { success: true };
  },
  deleteTemplate: async (id: string) => {
    templates.delete(id);
    return { success: true };
  },
};
const media: any = {
  prepare: async () => {
    throw new Error("No media fixture");
  },
};
let app: ReturnType<typeof createApp>;
const auth = { Authorization: "Bearer test-api-key" };
const textMessage = {
  to: "85291234567",
  type: "text",
  text: { body: "Hello" },
};
function webhook(value: any) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: { metadata: { phone_number_id: "phone" }, ...value },
          },
        ],
      },
    ],
  };
}
async function postWebhook(payload: any) {
  const body = JSON.stringify(payload);
  return request(app)
    .post("/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set(
      "X-Hub-Signature-256",
      "sha256=" +
        createHmac("sha256", config.appSecret).update(body).digest("hex"),
    )
    .send(body);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "wa-tests-"));
  config.mediaPath = root;
  await migrate(pool);
  app = createApp({ pool, config, meta, media });
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE webhook_deliveries, job_attempts, jobs, idempotency_keys, status_events, webhook_receipts, messages, media, batches, contacts, templates, rate_limits, worker_heartbeats RESTART IDENTITY CASCADE",
  );
  sent = [];
  sendError = undefined;
  templates.clear();
});
afterAll(async () => {
  await pool.end();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("SQL migrations and transactions", () => {
  it("supports reruns and concurrent migration runners", async () => {
    await Promise.all([migrate(pool), migrate(pool)]);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM schema_migrations")).rows[0]
          .count,
      ),
    ).toBeGreaterThan(0);
  });
  it("rolls back failed migrations without recording their version", async () => {
    const dir = await mkdtemp(join(root, "migrations-"));
    await writeFile(
      join(dir, "999_test.sql"),
      "CREATE TABLE rollback_probe(id int); SELECT nonexistent_column FROM rollback_probe;",
    );
    await expect(migrate(pool, dir)).rejects.toThrow();
    expect(
      (await pool.query("SELECT to_regclass('rollback_probe') AS name")).rows[0]
        .name,
    ).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT * FROM schema_migrations WHERE version='999_test.sql'",
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rolls back application writes on error and returns the client to the pool", async () => {
    await expect(
      transaction(pool, async (client) => {
        await client.query("INSERT INTO contacts(wa_id) VALUES ('rollback')");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (await pool.query("SELECT * FROM contacts WHERE wa_id='rollback'"))
        .rowCount,
    ).toBe(0);
  });
});

describe("message API", () => {
  it("requires API authentication and idempotency keys", async () => {
    expect((await request(app).get("/v1/messages")).status).toBe(401);
    expect(
      (await request(app).post("/v1/messages").set(auth).send(textMessage))
        .status,
    ).toBe(400);
  });
  it("persists once for concurrent identical requests and rejects conflicting reuse", async () => {
    const send = () =>
      request(app)
        .post("/v1/messages")
        .set(auth)
        .set("Idempotency-Key", "same")
        .send(textMessage);
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(202);
    expect(b.body).toEqual(a.body);
    expect((await pool.query("SELECT * FROM messages")).rowCount).toBe(1);
    expect(
      (
        await request(app)
          .post("/v1/messages")
          .set(auth)
          .set("Idempotency-Key", "same")
          .send({ ...textMessage, text: { body: "Different" } })
      ).status,
    ).toBe(409);
  });
  it("accepts 1000 items, rejects 1001, and makes invalid batches atomic", async () => {
    const response = await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", "batch")
      .send({ messages: Array(1000).fill(textMessage) });
    expect(response.status).toBe(202);
    expect(response.body.messageIds).toHaveLength(1000);
    expect(
      (
        await request(app)
          .post("/v1/messages/batch")
          .set(auth)
          .set("Idempotency-Key", "large")
          .send({ messages: Array(1001).fill(textMessage) })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post("/v1/messages/batch")
          .set(auth)
          .set("Idempotency-Key", "invalid")
          .send({ messages: [textMessage, { ...textMessage, to: "bad" }] })
      ).status,
    ).toBe(422);
    expect(
      Number((await pool.query("SELECT count(*) FROM messages")).rows[0].count),
    ).toBe(1000);
    const batch = await request(app)
      .get(`/v1/batches/${response.body.batchId}`)
      .set(auth);
    expect(batch.body.total).toBe(1000);
  });
  it("paginates consistently and treats filter values as data", async () => {
    await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", "page")
      .send({ messages: [textMessage, textMessage, textMessage] });
    const page = await request(app).get("/v1/messages?limit=2").set(auth);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.nextCursor).toBeTruthy();
    const next = await request(app)
      .get("/v1/messages")
      .query({ limit: 2, cursor: page.body.nextCursor })
      .set(auth);
    expect(next.body.data).toHaveLength(1);
    expect(page.body.data.map((x: any) => x.id)).not.toContain(
      next.body.data[0].id,
    );
    const injection = await request(app)
      .get("/v1/messages")
      .query({ contact: "' OR 1=1 --" })
      .set(auth);
    expect(injection.status).toBe(200);
    expect(injection.body.data).toEqual([]);
  });
  it("rejects malformed cursor UUIDs as validation errors", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ at: "2026-01-01T00:00:00Z", id: "-".repeat(36) }),
    ).toString("base64url");
    expect(
      (await request(app).get("/v1/messages").query({ cursor }).set(auth))
        .status,
    ).toBe(422);
  });
  it("rejects non-ISO cursor dates before querying PostgreSQL", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ at: "0", id: randomUUID() }),
    ).toString("base64url");
    expect(
      (await request(app).get("/v1/messages").query({ cursor }).set(auth))
        .status,
    ).toBe(422);
  });
});

describe("worker", () => {
  it("claims each send once across competing workers and stores the Meta ID", async () => {
    const response = await request(app)
      .post("/v1/messages")
      .set(auth)
      .set("Idempotency-Key", "worker")
      .send(textMessage);
    const workers = [
      new Worker({ pool, config, meta, media }),
      new Worker({ pool, config, meta, media }),
    ];
    await Promise.all(workers.map((worker) => worker.runOnce()));
    expect(sent).toHaveLength(1);
    const detail = await request(app)
      .get(`/v1/messages/${response.body.messageIds[0]}`)
      .set(auth);
    expect(detail.body.submission_status).toBe("accepted");
    expect(detail.body.meta_id).toBe("wamid.out-1");
  });
  it("sends personalized template batches", async () => {
    const result = await request(app)
      .post("/v1/messages/templates/batch")
      .set(auth)
      .set("Idempotency-Key", "template-batch")
      .send({
        name: "hello",
        language: "en_US",
        recipients: [
          {
            to: "85291234567",
            components: [
              { type: "body", parameters: [{ type: "text", text: "Alice" }] },
            ],
          },
        ],
      });
    expect(result.status).toBe(202);
    await new Worker({ pool, config, meta, media }).runOnce();
    expect(sent[0].template.components[0].parameters[0].text).toBe("Alice");
  });
  it("keeps ambiguous sends unknown and does not resubmit them", async () => {
    await request(app)
      .post("/v1/messages")
      .set(auth)
      .set("Idempotency-Key", "ambiguous")
      .send(textMessage);
    sendError = new ProviderError("timeout", 502, true, true);
    const worker = new Worker({ pool, config, meta, media });
    await worker.runOnce();
    await worker.runOnce();
    expect(
      (await pool.query("SELECT submission_status FROM messages")).rows[0]
        .submission_status,
    ).toBe("unknown");
    expect((await pool.query("SELECT state FROM jobs")).rows[0].state).toBe(
      "failed",
    );
  });
  it("retries explicit throttling but terminates permanent rejections", async () => {
    await request(app)
      .post("/v1/messages")
      .set(auth)
      .set("Idempotency-Key", "retry")
      .send(textMessage);
    const worker = new Worker({ pool, config, meta, media });
    sendError = new ProviderError("rate limit", 429, true, false);
    await worker.runOnce();
    expect(
      (await pool.query("SELECT state,attempts FROM jobs")).rows[0],
    ).toMatchObject({ state: "pending", attempts: 1 });
    await pool.query("UPDATE jobs SET available_at=now()");
    sendError = new ProviderError("bad recipient", 400, false, false);
    await worker.runOnce();
    expect(
      (await pool.query("SELECT submission_status FROM messages")).rows[0]
        .submission_status,
    ).toBe("failed");
  });
});

describe("Meta webhooks", () => {
  it("verifies challenges and rejects forged signatures", async () => {
    const challenge = await request(app).get("/webhooks/whatsapp").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "verify",
      "hub.challenge": "1234",
    });
    expect(challenge.status).toBe(200);
    expect(challenge.text).toBe("1234");
    expect(
      (await request(app).post("/webhooks/whatsapp").send(webhook({}))).status,
    ).toBe(401);
  });
  it("deduplicates all messages in a callback and only creates incoming notifications", async () => {
    const payload = webhook({
      messages: [
        {
          id: "wamid.in-1",
          from: "85291234567",
          timestamp: "1750000000",
          type: "text",
          text: { body: "Hi" },
        },
        {
          id: "wamid.in-2",
          from: "85291234567",
          timestamp: "1750000001",
          type: "unknown",
          unknown: {},
        },
      ],
      statuses: [
        {
          id: "wamid.unmatched",
          status: "sent",
          timestamp: "1750000000",
          recipient_id: "85291234567",
        },
      ],
    });
    expect((await postWebhook(payload)).status).toBe(200);
    expect((await postWebhook(payload)).status).toBe(200);
    expect((await pool.query("SELECT * FROM messages")).rowCount).toBe(2);
    expect(
      (await pool.query("SELECT * FROM webhook_deliveries")).rowCount,
    ).toBe(2);
    expect((await pool.query("SELECT * FROM status_events")).rowCount).toBe(1);
  });
  it("reconciles early statuses and never downgrades a read message", async () => {
    await postWebhook(
      webhook({
        statuses: [
          {
            id: "wamid.out-1",
            status: "read",
            timestamp: "1750000002",
            recipient_id: "85291234567",
          },
        ],
      }),
    );
    const sentResponse = await request(app)
      .post("/v1/messages")
      .set(auth)
      .set("Idempotency-Key", "status")
      .send(textMessage);
    await new Worker({ pool, config, meta, media }).runOnce();
    await postWebhook(
      webhook({
        statuses: [
          {
            id: "wamid.out-1",
            status: "sent",
            timestamp: "1750000001",
            recipient_id: "85291234567",
          },
        ],
      }),
    );
    const detail = await request(app)
      .get(`/v1/messages/${sentResponse.body.messageIds[0]}`)
      .set(auth);
    expect(detail.body.delivery_status).toBe("read");
    expect(detail.body.statusHistory).toHaveLength(2);
    expect(
      (await pool.query("SELECT * FROM webhook_deliveries")).rowCount,
    ).toBe(0);
  });
  it("does not accept messages for another configured number", async () => {
    const payload = webhook({
      messages: [
        {
          id: "other",
          from: "85291234567",
          timestamp: "1750000000",
          type: "text",
          text: { body: "x" },
        },
      ],
    });
    payload.entry[0].changes[0].value.metadata.phone_number_id = "other";
    expect((await postWebhook(payload)).status).toBe(200);
    expect((await pool.query("SELECT * FROM messages")).rowCount).toBe(0);
  });
});

describe("templates", () => {
  it("creates, lists, updates, and deletes a template while retaining its database record", async () => {
    const body = {
      name: "order_update",
      language: "en_US",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Order received" }],
    };
    expect(
      (await request(app).post("/v1/templates").set(auth).send(body)).status,
    ).toBe(201);
    expect(
      (await request(app).get("/v1/templates").set(auth)).body.data,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .patch("/v1/templates/100")
          .set(auth)
          .send({ components: [{ type: "BODY", text: "Order updated" }] })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get("/v1/templates/100").set(auth)).body.components[0]
        .text,
    ).toBe("Order updated");
    expect(
      (await request(app).delete("/v1/templates/100").set(auth)).status,
    ).toBe(200);
    expect(
      (await pool.query("SELECT status FROM templates WHERE meta_id='100'"))
        .rows[0].status,
    ).toBe("DELETED");
  });
});

describe("crash recovery and partial batches", () => {
  it("recovers an unstarted send but never automatically resends a dispatch interrupted by a crash", async () => {
    await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", "crash")
      .send({ messages: [textMessage, { ...textMessage, to: "85292345678" }] });
    const jobs = (await pool.query("SELECT * FROM jobs ORDER BY message_id"))
      .rows;
    for (const job of jobs)
      await pool.query(
        "UPDATE jobs SET state='running',attempts=1,lease_token=$2,lease_until=now()-interval '1 minute' WHERE id=$1",
        [job.id, randomUUID()],
      );
    await pool.query(
      "UPDATE messages SET submission_status='sending',dispatch_started_at=now() WHERE id=$1",
      [jobs[0].message_id],
    );
    const worker = new Worker({ pool, config, meta, media });
    await worker.recoverExpired();
    await worker.runOnce();
    expect(sent).toHaveLength(1);
    expect(
      (
        await pool.query("SELECT submission_status FROM messages WHERE id=$1", [
          jobs[0].message_id,
        ])
      ).rows[0].submission_status,
    ).toBe("unknown");
    await postWebhook(
      webhook({
        statuses: [
          {
            id: "wamid.recovered",
            status: "delivered",
            timestamp: "1750000002",
            recipient_id: "85291234567",
            biz_opaque_callback_data: jobs[0].message_id,
          },
        ],
      }),
    );
    const recovered = await getMessageViaApi(jobs[0].message_id);
    expect(recovered.submission_status).toBe("accepted");
    expect(recovered.delivery_status).toBe("delivered");
  });
  it("records a failed recipient without stopping other batch items", async () => {
    const result = await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", "partial")
      .send({ messages: [textMessage, { ...textMessage, to: "85292345678" }] });
    const localMeta = {
      ...meta,
      send: async (payload: any) => {
        if (payload.to === "85291234567")
          throw new ProviderError("Bad recipient", 400, false, false);
        return meta.send(payload);
      },
    };
    const worker = new Worker({ pool, config, meta: localMeta, media });
    await worker.runOnce();
    await worker.runOnce();
    const batch = await request(app)
      .get(`/v1/batches/${result.body.batchId}`)
      .set(auth);
    expect(batch.body.submission).toEqual({ failed: 1, accepted: 1 });
  });
  it("defers sends under the shared rate limiter without consuming retry attempts", async () => {
    await request(app)
      .post("/v1/messages")
      .set(auth)
      .set("Idempotency-Key", "throttle")
      .send(textMessage);
    await pool.query(
      "INSERT INTO rate_limits(key,next_at) VALUES('phone:phone',now()+interval '1 minute')",
    );
    await new Worker({ pool, config, meta, media }).runOnce();
    expect(sent).toHaveLength(0);
    expect(
      (await pool.query("SELECT state,attempts FROM jobs")).rows[0],
    ).toEqual({ state: "pending", attempts: 0 });
    expect(
      (await pool.query("SELECT dispatch_started_at FROM messages")).rows[0]
        .dispatch_started_at,
    ).toBeNull();
  });
});
async function getMessageViaApi(id: string) {
  return (await request(app).get(`/v1/messages/${id}`).set(auth)).body;
}

describe("application notifications", () => {
  it("signs exact payload bytes, retries up to five attempts, and replays the same event ID", async () => {
    await postWebhook(
      webhook({
        messages: [
          {
            id: "wamid.notify",
            from: "85291234567",
            timestamp: "1750000000",
            type: "text",
            text: { body: "Hi" },
          },
        ],
      }),
    );
    const notifications: any[] = [];
    let ok = false;
    const fetcher: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const timestamp = headers.get("X-Webhook-Timestamp")!;
      expect(headers.get("X-Webhook-Signature")).toBe(
        "sha256=" +
          createHmac("sha256", "callback-secret")
            .update(`${timestamp}.${body}`)
            .digest("hex"),
      );
      notifications.push(JSON.parse(body));
      return new Response("", { status: ok ? 200 : 500 });
    };
    const worker = new Worker({ pool, config, meta, media, fetcher });
    for (let i = 0; i < 5; i++) {
      await worker.runOnce();
      await pool.query("UPDATE jobs SET available_at=now()");
    }
    const delivery = (await pool.query("SELECT * FROM webhook_deliveries"))
      .rows[0];
    expect(delivery.status).toBe("failed");
    expect(notifications).toHaveLength(5);
    expect(
      (
        await request(app)
          .post(`/v1/webhook-deliveries/${delivery.id}/retry`)
          .set(auth)
      ).status,
    ).toBe(202);
    ok = true;
    await worker.runOnce();
    expect(
      (await pool.query("SELECT status FROM webhook_deliveries")).rows[0]
        .status,
    ).toBe("delivered");
    expect(new Set(notifications.map((x) => x.eventId)).size).toBe(1);
    expect(notifications[0].type).toBe("message.received");
  });
  it("forwards incoming media before archive completion, with no second callback for archive status", async () => {
    await postWebhook(
      webhook({
        messages: [
          {
            id: "wamid.photo",
            from: "85291234567",
            timestamp: "1750000000",
            type: "image",
            image: { id: "meta-photo", mime_type: "image/png" },
          },
        ],
      }),
    );
    const notifications: any[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      notifications.push(JSON.parse(String(init?.body)));
      return new Response("", { status: 200 });
    };
    const worker = new Worker({ pool, config, meta, media, fetcher });
    await worker.runOnce();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message.media.status).toBe("pending");
    await worker.runOnce();
    expect(notifications).toHaveLength(1);
    expect((await pool.query("SELECT status FROM media")).rows[0].status).toBe(
      "failed",
    );
  });
  it("persists template status events without generating notifications", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                message_template_id: "200",
                message_template_name: "hello",
                message_template_language: "en_US",
                event: "APPROVED",
              },
            },
          ],
        },
      ],
    };
    expect((await postWebhook(payload)).status).toBe(200);
    expect(
      (await pool.query("SELECT status FROM templates WHERE meta_id='200'"))
        .rows[0].status,
    ).toBe("APPROVED");
    expect(
      (await pool.query("SELECT * FROM webhook_deliveries")).rowCount,
    ).toBe(0);
  });
});

describe("media persistence", () => {
  it("can retry an archive while recovery holds its job lock without deadlocking", async () => {
    const asset = (
      await pool.query(
        "INSERT INTO media(kind,status,source_url) VALUES('image','failed','https://example.com/photo') RETURNING id",
      )
    ).rows[0];
    const job = (
      await pool.query(
        "INSERT INTO jobs(kind,media_id,state) VALUES('archive',$1,'failed') RETURNING id",
        [asset.id],
      )
    ).rows[0];
    const client = await pool.connect();
    let pending: Promise<any> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [
        job.id,
      ]);
      pending = request(app)
        .post(`/v1/media/${asset.id}/retry`)
        .set(auth)
        .then((result) => result);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM jobs WHERE kind=%archive%media_id=%FOR UPDATE%'",
        );
        if (activity.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await client.query("UPDATE media SET last_error='{}' WHERE id=$1", [
        asset.id,
      ]);
      await client.query("COMMIT");
      expect((await pending).status).toBe(202);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pending;
    }
  });
  it("archives and uploads a shared batch URL once, then serves it with authentication", async () => {
    let downloads = 0;
    let uploads = 0;
    const localMeta = {
      ...meta,
      uploadMedia: async () => {
        uploads++;
        return "uploaded-media";
      },
    };
    const mediaStore = new MediaStore(
      pool,
      config,
      localMeta,
      async (_url, options) => {
        downloads++;
        const filename = randomUUID();
        await writeFile(join(options.directory, filename), "file bytes");
        return { filename, mime: "image/png", size: 10, sha256: "hash" };
      },
    );
    const result = await request(app)
      .post("/v1/messages/batch")
      .set(auth)
      .set("Idempotency-Key", "media-batch")
      .send({
        messages: [
          {
            to: "85291234567",
            type: "image",
            media: { url: "https://example.com/photo.png", caption: "Hello" },
          },
          {
            to: "85292345678",
            type: "image",
            media: { url: "https://example.com/photo.png" },
          },
        ],
      });
    expect(result.status).toBe(202);
    const worker = new Worker({
      pool,
      config,
      meta: localMeta,
      media: mediaStore,
    });
    await worker.runOnce();
    await worker.runOnce();
    expect(downloads).toBe(1);
    expect(uploads).toBe(1);
    expect(sent.every((x) => x.image.id === "uploaded-media")).toBe(true);
    const asset = (await pool.query("SELECT * FROM media")).rows[0];
    expect(
      (await request(app).get(`/v1/media/${asset.id}/content`)).status,
    ).toBe(401);
    const content = await request(app)
      .get(`/v1/media/${asset.id}/content`)
      .set(auth);
    expect(content.status).toBe(200);
    expect(content.body.toString()).toBe("file bytes");
    const restarted = new MediaStore(pool, config, localMeta, async () => {
      throw new Error("Must use existing archive");
    });
    await restarted.prepare(asset.id);
    expect(uploads).toBe(1);
  });
  it("retains incoming download failures, refreshes the Meta URL on replay, and preserves the file", async () => {
    await postWebhook(
      webhook({
        messages: [
          {
            id: "wamid.in-media",
            from: "85291234567",
            timestamp: "1750000000",
            type: "document",
            document: { id: "remote-doc", mime_type: "application/pdf" },
          },
        ],
      }),
    );
    let urls = 0;
    let failing = true;
    const localMeta = {
      ...meta,
      getMedia: async () => ({
        url: `https://lookaside.fbsbx.com/file?version=${++urls}`,
      }),
    };
    const store = new MediaStore(
      pool,
      config,
      localMeta,
      async (_url, options) => {
        if (failing) throw new AppError(422, "EXPIRED", "Expired file URL");
        const filename = randomUUID();
        await writeFile(join(options.directory, filename), "pdf bytes");
        return { filename, mime: "application/pdf", size: 9, sha256: "hash" };
      },
    );
    const asset = (await pool.query("SELECT * FROM media")).rows[0];
    // Process the independent notification first.
    const worker = new Worker({
      pool,
      config,
      meta: localMeta,
      media: store,
      fetcher: async () => new Response("", { status: 200 }),
    });
    await worker.runOnce();
    await worker.runOnce();
    expect((await pool.query("SELECT status FROM media")).rows[0].status).toBe(
      "failed",
    );
    expect(
      (await request(app).post(`/v1/media/${asset.id}/retry`).set(auth)).status,
    ).toBe(202);
    failing = false;
    await worker.runOnce();
    expect(urls).toBe(2);
    expect((await pool.query("SELECT status FROM media")).rows[0].status).toBe(
      "ready",
    );
  });
  it("converts a template sample URL into a Meta sample handle", async () => {
    const localMeta = {
      ...meta,
      uploadMedia: async () => "sample-media",
      uploadSample: async () => "sample-handle",
    };
    const store = new MediaStore(
      pool,
      config,
      localMeta,
      async (_url, options) => {
        const filename = randomUUID();
        await writeFile(join(options.directory, filename), "sample");
        return { filename, mime: "image/png", size: 6, sha256: "hash" };
      },
    );
    const localApp = createApp({ pool, config, meta: localMeta, media: store });
    const response = await request(localApp)
      .post("/v1/templates")
      .set(auth)
      .send({
        name: "media_template",
        language: "en_US",
        category: "UTILITY",
        components: [
          {
            type: "HEADER",
            format: "IMAGE",
            sampleUrl: "https://example.com/image.png",
          },
          { type: "BODY", text: "Your order" },
        ],
      });
    expect(response.status).toBe(201);
    expect(response.body.components[0].example.header_handle).toEqual([
      "sample-handle",
    ]);
    expect(response.body.components[0].sampleUrl).toBeUndefined();
  });
});
