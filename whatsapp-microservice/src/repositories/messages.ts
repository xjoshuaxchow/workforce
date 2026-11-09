import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction } from "../db.js";
import { AppError } from "../errors.js";
import { digest } from "../security.js";
import { nextDeliveryStatus } from "../domain.js";
import type { MessageInput } from "../validation.js";
import { uuid } from "../validation.js";
import { z } from "zod";

export function mediaReferences(
  input: any,
): { kind: string; url?: string; id?: string; path: string }[] {
  if (input.media)
    return [
      {
        kind: input.type,
        url: input.media.url,
        id: input.media.id,
        path: "media",
      },
    ];
  const found: { kind: string; url?: string; id?: string; path: string }[] = [];
  for (const [i, component] of (input.template?.components ?? []).entries())
    for (const [j, p] of (component.parameters ?? []).entries()) {
      if (["image", "document", "video"].includes(p.type))
        found.push({
          kind: p.type,
          url: p[p.type].url,
          id: p[p.type].id,
          path: `template.components.${i}.parameters.${j}.${p.type}`,
        });
    }
  return found;
}

export async function enqueueMessages(
  pool: pg.Pool,
  scope: string,
  key: string,
  messages: MessageInput[],
  isBatch: boolean,
): Promise<any> {
  const hash = digest(messages);
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `idempotency:${scope}:${key}`,
    ]);
    const existing = await client.query(
      "SELECT * FROM idempotency_keys WHERE scope=$1 AND key=$2",
      [scope, key],
    );
    if (existing.rowCount) {
      if (existing.rows[0].request_hash !== hash)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This key was used with different content",
        );
      return existing.rows[0].response;
    }
    const batchId = isBatch ? randomUUID() : null;
    if (batchId)
      await client.query("INSERT INTO batches(id,total) VALUES($1,$2)", [
        batchId,
        messages.length,
      ]);
    await client.query(
      "INSERT INTO contacts(wa_id) SELECT DISTINCT unnest($1::text[]) ON CONFLICT DO NOTHING",
      [messages.map((m) => m.to)],
    );
    const assets = new Map<string, string>();
    const links: {
      message_id: string;
      media_id: string;
      content_path: string;
    }[] = [];
    const records = [];
    for (const message of messages) {
      const id = randomUUID();
      let primary: string | null = null;
      for (const ref of mediaReferences(message)) {
        const key = `${ref.kind}:${ref.id ?? ref.url}`;
        let mediaId = assets.get(key);
        if (!mediaId) {
          if (ref.id) {
            const asset = (
              await client.query(
                "SELECT id,kind,filename FROM media WHERE id=$1",
                [ref.id],
              )
            ).rows[0];
            if (!asset?.filename || asset.kind !== ref.kind)
              throw new AppError(
                422,
                "INVALID_MEDIA",
                "Select an archived file matching the message type",
              );
            mediaId = asset.id as string;
          } else {
            mediaId = randomUUID();
            await client.query(
              "INSERT INTO media(id,kind,source_url) VALUES($1,$2,$3)",
              [mediaId, ref.kind, ref.url],
            );
          }
          assets.set(key, mediaId);
        }
        primary ??= mediaId;
        links.push({
          message_id: id,
          media_id: mediaId,
          content_path: ref.path,
        });
      }
      records.push({
        id,
        batch_id: batchId,
        contact_id: message.to,
        type: message.type,
        content: message,
        media_id: primary,
      });
    }
    await client.query(
      `INSERT INTO messages(id,batch_id,contact_id,type,content,media_id,direction,submission_status)
      SELECT id,batch_id,contact_id,type,content,media_id,'outbound','queued' FROM jsonb_to_recordset($1::jsonb)
      AS x(id uuid,batch_id uuid,contact_id text,type text,content jsonb,media_id uuid)`,
      [JSON.stringify(records)],
    );
    if (links.length)
      await client.query(
        `INSERT INTO message_media SELECT message_id,media_id,content_path FROM jsonb_to_recordset($1::jsonb) AS x(message_id uuid,media_id uuid,content_path text)`,
        [JSON.stringify(links)],
      );
    await client.query(
      "INSERT INTO jobs(kind,message_id) SELECT 'send',unnest($1::uuid[])",
      [records.map((m) => m.id)],
    );
    const response = {
      batchId,
      messageIds: records.map((m) => m.id),
      status: "queued",
    };
    await client.query(
      "INSERT INTO idempotency_keys(scope,key,request_hash,response) VALUES($1,$2,$3,$4)",
      [scope, key, hash, response],
    );
    return response;
  });
}

export async function listMessages(
  pool: pg.Pool,
  query: Record<string, any>,
): Promise<any> {
  const conditions: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    args.push(value);
    conditions.push(sql.replace("?", `$${args.length}`));
  };
  for (const [input, column] of [
    ["contact", "contact_id"],
    ["direction", "direction"],
    ["type", "type"],
    ["batchId", "batch_id"],
  ] as const)
    if (query[input]) add(`${column}=?`, query[input]);
  if (query.status) {
    args.push(query.status);
    conditions.push(
      `(submission_status=$${args.length} OR delivery_status=$${args.length})`,
    );
  }
  if (query.from) add("created_at>=?", query.from);
  if (query.to) add("created_at<=?", query.to);
  if (query.cursor) {
    let cursor: any;
    try {
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
    } catch {
      throw new AppError(422, "INVALID_CURSOR", "Invalid pagination cursor");
    }
    if (
      !cursor ||
      !z.iso.datetime({ offset: true }).safeParse(cursor.at).success ||
      !uuid.safeParse(cursor.id).success
    )
      throw new AppError(422, "INVALID_CURSOR", "Invalid pagination cursor");
    args.push(cursor.at, cursor.id);
    conditions.push(
      `(created_at,id)<($${args.length - 1}::timestamptz,$${args.length}::uuid)`,
    );
  }
  args.push(query.limit + 1);
  // PostgreSQL timestamps retain microseconds; do not round pagination keys through JS Date.
  const result = await pool.query(
    `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM messages ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY created_at DESC,id DESC LIMIT $${args.length}`,
    args,
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString(
        "base64url",
      )
    : null;
  return { data: rows.map(({ cursor_at, ...row }) => row), nextCursor };
}
export async function getMessage(pool: pg.Pool, id: string): Promise<any> {
  const result = await pool.query("SELECT * FROM messages WHERE id=$1", [id]);
  if (!result.rowCount)
    throw new AppError(404, "NOT_FOUND", "Message not found");
  const [statuses, media, deliveries, attempts] = await Promise.all([
    pool.query(
      "SELECT * FROM status_events WHERE message_id=$1 ORDER BY occurred_at,id",
      [id],
    ),
    pool.query(
      "SELECT m.*,mm.content_path FROM media m JOIN message_media mm ON mm.media_id=m.id WHERE mm.message_id=$1",
      [id],
    ),
    pool.query(
      "SELECT id,status,last_error,delivered_at FROM webhook_deliveries WHERE message_id=$1",
      [id],
    ),
    pool.query(
      "SELECT a.* FROM job_attempts a JOIN jobs j ON j.id=a.job_id LEFT JOIN webhook_deliveries d ON d.id=j.delivery_id WHERE j.message_id=$1 OR d.message_id=$1 ORDER BY a.id",
      [id],
    ),
  ]);
  return {
    ...result.rows[0],
    statusHistory: statuses.rows,
    media: media.rows.map(({ filename, source_url, ...row }) => row),
    forwarding: deliveries.rows,
    attempts: attempts.rows,
  };
}
export async function reconcileStatuses(
  client: pg.PoolClient,
  messageId: string,
  metaId: string,
): Promise<void> {
  const current = (
    await client.query(
      "SELECT delivery_status FROM messages WHERE id=$1 FOR UPDATE",
      [messageId],
    )
  ).rows[0];
  const events = await client.query(
    "SELECT * FROM status_events WHERE meta_id=$1 ORDER BY occurred_at,id",
    [metaId],
  );
  let status = current.delivery_status;
  let error: unknown = null;
  for (const event of events.rows) {
    status = nextDeliveryStatus(status, event.status);
    if (event.status === "failed")
      error = event.payload.errors ?? event.payload;
  }
  await client.query(
    "UPDATE status_events SET message_id=$1 WHERE meta_id=$2",
    [messageId, metaId],
  );
  await client.query(
    "UPDATE messages SET delivery_status=$2,last_error=COALESCE($3::jsonb,last_error),updated_at=now() WHERE id=$1",
    [messageId, status, error ? JSON.stringify(error) : null],
  );
}
