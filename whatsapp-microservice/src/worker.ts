import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "./config.js";
import { transaction } from "./db.js";
import {
  AppError,
  errorRecord,
  LeaseLostError,
  RetryableError,
} from "./errors.js";
import { ProviderError, type MetaGateway } from "./meta.js";
import type { MediaGateway } from "./media/store.js";
import { retryDelay } from "./domain.js";
import { signNotification } from "./security.js";
import { reconcileStatuses } from "./repositories/messages.js";

export interface Dependencies {
  pool: pg.Pool;
  config: Config;
  meta: MetaGateway;
  media: MediaGateway;
  fetcher?: typeof fetch;
}
class Deferred extends Error {
  constructor(public delay: number) {
    super("Send deferred by rate limiter");
  }
}
export class Worker {
  private pool: pg.Pool;
  private config: Config;
  private meta: MetaGateway;
  private media: MediaGateway;
  private fetcher: typeof fetch;
  constructor(deps: Dependencies) {
    this.pool = deps.pool;
    this.config = deps.config;
    this.meta = deps.meta;
    this.media = deps.media;
    this.fetcher = deps.fetcher ?? fetch;
  }
  async recoverExpired(): Promise<void> {
    await transaction(this.pool, async (client) => {
      const jobs = await client.query(
        "SELECT * FROM jobs WHERE state='running' AND lease_until<now() ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT 100",
      );
      for (const job of jobs.rows) {
        let terminal = job.attempts >= this.config.maxAttempts;
        let done = false;
        const error = {
          code: "LEASE_EXPIRED",
          message: "Worker stopped before recording an outcome",
        };
        if (job.kind === "send") {
          const message = (
            await client.query(
              "SELECT * FROM messages WHERE id=$1 FOR UPDATE",
              [job.message_id],
            )
          ).rows[0];
          done = message.submission_status === "accepted";
          if (!done && message.dispatch_started_at) {
            terminal = true;
            await client.query(
              "UPDATE messages SET submission_status='unknown',last_error=$2,updated_at=now() WHERE id=$1",
              [message.id, error],
            );
          } else if (!done)
            await client.query(
              "UPDATE messages SET submission_status=$2,last_error=$3,updated_at=now() WHERE id=$1",
              [message.id, terminal ? "failed" : "queued", error],
            );
        }
        await client.query(
          "UPDATE jobs SET state=$2,lease_token=NULL,lease_until=NULL,available_at=now(),last_error=$3 WHERE id=$1",
          [job.id, done ? "done" : terminal ? "failed" : "pending", error],
        );
        await client.query(
          "UPDATE job_attempts SET finished_at=now(),outcome='lease_expired',error=$2 WHERE lease_token=$1",
          [job.lease_token, error],
        );
        if (terminal && !done) await this.failResource(client, job, error);
      }
    });
  }
  private async claim(): Promise<any | null> {
    return transaction(this.pool, async (client) => {
      const result =
        await client.query(`SELECT * FROM jobs WHERE state='pending' AND available_at<=now()
        ORDER BY CASE kind WHEN 'notify' THEN 0 WHEN 'archive' THEN 1 ELSE 2 END,available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!result.rowCount) return null;
      const job = result.rows[0];
      const token = randomUUID();
      await client.query(
        "UPDATE jobs SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+$3*interval '1 second' WHERE id=$1",
        [job.id, token, this.config.leaseSeconds],
      );
      await client.query(
        "INSERT INTO job_attempts(job_id,lease_token,attempt) VALUES($1,$2,$3)",
        [job.id, token, job.attempts + 1],
      );
      return { ...job, lease_token: token, attempts: job.attempts + 1 };
    });
  }
  async runOnce(): Promise<boolean> {
    await this.recoverExpired();
    const job = await this.claim();
    if (!job) return false;
    const heartbeat = setInterval(
      () => {
        void this.pool
          .query(
            "UPDATE jobs SET lease_until=now()+$3*interval '1 second' WHERE id=$1 AND lease_token=$2 AND state='running'",
            [job.id, job.lease_token, this.config.leaseSeconds],
          )
          .catch(() => {});
      },
      Math.max(1000, (this.config.leaseSeconds * 1000) / 3),
    );
    heartbeat.unref();
    try {
      if (job.kind === "send") await this.send(job);
      else if (job.kind === "archive") await this.media.prepare(job.media_id);
      else await this.notify(job);
      await this.complete(job);
    } catch (error) {
      if (!(error instanceof LeaseLostError)) await this.fail(job, error);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  private async checkLease(client: pg.PoolClient, job: any): Promise<void> {
    const found = await client.query(
      "SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() FOR UPDATE",
      [job.id, job.lease_token],
    );
    if (!found.rowCount)
      throw new LeaseLostError("Worker lease is no longer valid");
  }
  private async send(job: any): Promise<void> {
    const message = (
      await this.pool.query("SELECT * FROM messages WHERE id=$1", [
        job.message_id,
      ])
    ).rows[0];
    if (message.submission_status === "accepted") return;
    if (message.dispatch_started_at)
      throw new ProviderError("Send outcome is unknown", 502, false, true);
    const input = structuredClone(message.content);
    const refs = (
      await this.pool.query(
        "SELECT * FROM message_media WHERE message_id=$1 ORDER BY media_id",
        [message.id],
      )
    ).rows;
    for (const ref of refs) {
      const asset = await this.media.prepare(ref.media_id);
      const parts = ref.content_path.split(".");
      let target = input;
      for (const part of parts.slice(0, -1)) target = target[part];
      const key = parts.at(-1)!;
      const prior = target[key];
      target[key] = {
        id: asset.meta_id,
        ...(prior.caption ? { caption: prior.caption } : {}),
        ...(prior.filename ? { filename: prior.filename } : {}),
      };
    }
    const payload: Record<string, any> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: input.type,
      biz_opaque_callback_data: message.id,
    };
    if (input.replyTo) payload.context = { message_id: input.replyTo };
    if (input.type === "text") payload.text = input.text;
    else if (input.type === "template")
      payload.template = {
        ...input.template,
        language: { code: input.template.language },
      };
    else {
      payload[input.type] = input.media;
      if (input.type === "audio") {
        delete payload.audio.caption;
        delete payload.audio.filename;
      }
      if (input.type !== "document") delete payload[input.type].filename;
    }
    await transaction(this.pool, async (client) => {
      await this.checkLease(client, job);
      const limits = [
        {
          key: "phone:" + this.config.phoneNumberId,
          interval: this.config.sendIntervalMs,
        },
        {
          key: "recipient:" + input.to,
          interval: this.config.recipientIntervalMs,
        },
      ].sort((a, b) => a.key.localeCompare(b.key));
      let wait = 0;
      for (const limit of limits) {
        await client.query(
          "INSERT INTO rate_limits(key,next_at) VALUES($1,now()) ON CONFLICT DO NOTHING",
          [limit.key],
        );
        const row = (
          await client.query(
            "SELECT GREATEST(0,EXTRACT(EPOCH FROM (next_at-clock_timestamp()))*1000) AS delay FROM rate_limits WHERE key=$1 FOR UPDATE",
            [limit.key],
          )
        ).rows[0];
        wait = Math.max(wait, Number(row.delay));
      }
      if (wait > 0) throw new Deferred(Math.ceil(wait));
      for (const limit of limits)
        await client.query(
          "UPDATE rate_limits SET next_at=clock_timestamp()+$2*interval '1 millisecond' WHERE key=$1",
          [limit.key, limit.interval],
        );
      await client.query(
        "UPDATE messages SET submission_status='sending',dispatch_started_at=now(),updated_at=now() WHERE id=$1",
        [message.id],
      );
    });
    const result = await this.meta.send(payload);
    const metaId = result.messages?.[0]?.id;
    if (typeof metaId !== "string")
      throw new ProviderError(
        "Missing message ID in send response",
        502,
        false,
        true,
      );
    await transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`meta:${metaId}`],
      );
      await this.checkLease(client, job);
      await client.query(
        "UPDATE messages SET meta_id=$2,submission_status='accepted',raw_payload=$3,last_error=NULL,updated_at=now() WHERE id=$1",
        [message.id, metaId, result],
      );
      await reconcileStatuses(client, message.id, metaId);
    });
  }
  private async notify(job: any): Promise<void> {
    const delivery = (
      await this.pool.query("SELECT * FROM webhook_deliveries WHERE id=$1", [
        job.delivery_id,
      ])
    ).rows[0];
    if (delivery.status === "delivered") return;
    if (!this.config.inboundWebhookUrl || !this.config.inboundWebhookSecret)
      throw new AppError(
        503,
        "FORWARDING_DISABLED",
        "Configure the incoming-message webhook before replaying",
      );
    const body = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    let response: Response;
    try {
      response = await this.fetcher(this.config.inboundWebhookUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Id": delivery.id,
          "X-Webhook-Timestamp": timestamp,
          "X-Webhook-Signature": signNotification(
            timestamp,
            body,
            this.config.inboundWebhookSecret,
          ),
        },
        body,
      });
    } catch {
      throw new RetryableError("Application webhook did not respond");
    }
    await response.body?.cancel();
    if (!response.ok)
      throw new RetryableError(
        "Application webhook returned a non-success status",
      );
    await transaction(this.pool, async (client) => {
      await this.checkLease(client, job);
      await client.query(
        "UPDATE webhook_deliveries SET status='delivered',last_error=NULL,delivered_at=now() WHERE id=$1",
        [delivery.id],
      );
    });
  }
  private async complete(job: any): Promise<void> {
    await transaction(this.pool, async (client) => {
      await this.checkLease(client, job);
      await client.query(
        "UPDATE jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=$1",
        [job.id],
      );
      await client.query(
        "UPDATE job_attempts SET finished_at=now(),outcome='done' WHERE lease_token=$1",
        [job.lease_token],
      );
    });
  }
  private async failResource(
    client: pg.PoolClient,
    job: any,
    error: unknown,
  ): Promise<void> {
    if (job.kind === "archive")
      await client.query(
        "UPDATE media SET status='failed',last_error=$2 WHERE id=$1 AND status<>'ready'",
        [job.media_id, error],
      );
    if (job.kind === "notify")
      await client.query(
        "UPDATE webhook_deliveries SET status='failed',last_error=$2 WHERE id=$1 AND status<>'delivered'",
        [job.delivery_id, error],
      );
  }
  private async fail(job: any, error: unknown): Promise<void> {
    await transaction(this.pool, async (client) => {
      const found = await client.query(
        "SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE",
        [job.id, job.lease_token],
      );
      if (!found.rowCount) return;
      if (error instanceof Deferred) {
        await client.query(
          "UPDATE jobs SET state='pending',attempts=attempts-1,lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+$2*interval '1 millisecond' WHERE id=$1",
          [job.id, error.delay],
        );
        await client.query(
          "UPDATE job_attempts SET finished_at=now(),outcome='throttled' WHERE lease_token=$1",
          [job.lease_token],
        );
        return;
      }
      let ambiguous = error instanceof ProviderError && error.ambiguous;
      if (job.kind === "send") {
        const message = (
          await client.query("SELECT * FROM messages WHERE id=$1 FOR UPDATE", [
            job.message_id,
          ])
        ).rows[0];
        if (message.submission_status === "accepted") {
          await client.query(
            "UPDATE jobs SET state='done',lease_token=NULL,lease_until=NULL WHERE id=$1",
            [job.id],
          );
          await client.query(
            "UPDATE job_attempts SET finished_at=now(),outcome='reconciled' WHERE lease_token=$1",
            [job.lease_token],
          );
          return;
        }
        if (message.dispatch_started_at && !(error instanceof ProviderError))
          ambiguous = true;
      }
      const retry =
        !ambiguous &&
        job.attempts < this.config.maxAttempts &&
        ((error instanceof ProviderError && error.retryable) ||
          error instanceof RetryableError);
      const recorded = {
        ...errorRecord(error),
        ...(error instanceof ProviderError
          ? { provider: error.details, ambiguous }
          : {}),
      };
      await client.query(
        "UPDATE jobs SET state=$2,lease_token=NULL,lease_until=NULL,last_error=$3,available_at=now()+$4*interval '1 millisecond' WHERE id=$1",
        [
          job.id,
          retry ? "pending" : "failed",
          recorded,
          retryDelay(job.attempts),
        ],
      );
      await client.query(
        "UPDATE job_attempts SET finished_at=now(),outcome=$2,error=$3 WHERE lease_token=$1",
        [
          job.lease_token,
          ambiguous ? "unknown" : retry ? "retry" : "failed",
          recorded,
        ],
      );
      if (job.kind === "send")
        await client.query(
          "UPDATE messages SET submission_status=$2,last_error=$3,dispatch_started_at=CASE WHEN $4 THEN dispatch_started_at ELSE NULL END,updated_at=now() WHERE id=$1",
          [
            job.message_id,
            ambiguous ? "unknown" : retry ? "queued" : "failed",
            recorded,
            ambiguous,
          ],
        );
      if (!retry) await this.failResource(client, job, recorded);
    });
  }
}
