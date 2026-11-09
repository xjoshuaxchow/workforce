import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "../config.js";
import { transaction } from "../db.js";
import { digest } from "../security.js";
import { AppError } from "../errors.js";
import { reconcileStatuses } from "../repositories/messages.js";
function eventDate(value: unknown): Date {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 253402300799)
    throw new AppError(400, "INVALID_WEBHOOK", "Invalid event timestamp");
  return new Date(n * 1000);
}
export async function receiveWebhook(
  pool: pg.Pool,
  config: Config,
  payload: any,
): Promise<void> {
  if (
    payload?.object !== "whatsapp_business_account" ||
    !Array.isArray(payload.entry)
  )
    throw new AppError(
      400,
      "INVALID_WEBHOOK",
      "Expected a WhatsApp Business Account webhook",
    );
  await transaction(pool, async (client) => {
    const receipt = await client.query(
      "INSERT INTO webhook_receipts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
      [digest(payload), payload],
    );
    if (!receipt.rowCount) return;
    for (const entry of payload.entry) {
      if (entry.id !== config.businessAccountId) continue;
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        if (change.field === "message_template_status_update") {
          if (!value.message_template_id) continue;
          await client.query(
            `INSERT INTO templates(meta_id,name,language,status,payload) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(meta_id) DO UPDATE SET status=EXCLUDED.status,payload=templates.payload||jsonb_build_object('status_event',EXCLUDED.payload),updated_at=now()`,
            [
              String(value.message_template_id),
              value.message_template_name ?? null,
              value.message_template_language ?? null,
              value.event ?? "UNKNOWN",
              value,
            ],
          );
          continue;
        }
        if (
          change.field !== "messages" ||
          value.metadata?.phone_number_id !== config.phoneNumberId
        )
          continue;
        for (const incoming of value.messages ?? []) {
          if (
            typeof incoming.id !== "string" ||
            typeof incoming.from !== "string" ||
            typeof incoming.type !== "string"
          )
            throw new AppError(
              400,
              "INVALID_WEBHOOK",
              "Missing message identity",
            );
          const at = eventDate(incoming.timestamp);
          const isReaction = incoming.type === "reaction";
          const contact = (value.contacts ?? []).find(
            (x: any) => x.wa_id === incoming.from,
          );
          await client.query(
            `INSERT INTO contacts(wa_id,profile,last_inbound_at) VALUES($1,$2,$3)
            ON CONFLICT(wa_id) DO UPDATE SET profile=contacts.profile||EXCLUDED.profile,last_inbound_at=GREATEST(contacts.last_inbound_at,EXCLUDED.last_inbound_at)`,
            [incoming.from, contact?.profile ?? {}, isReaction ? null : at],
          );
          let metaId: string | null = incoming.id;
          if (isReaction) {
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`reaction:${incoming.id}`],
            );
            const latest = await client.query(
              `SELECT content,occurred_at FROM messages
              WHERE contact_id=$1 AND direction='inbound' AND type='reaction'
                AND (meta_id=$2 OR (meta_id IS NULL AND content->>'id'=$2))
              ORDER BY occurred_at DESC,created_at DESC,id DESC LIMIT 1`,
              [incoming.from, incoming.id],
            );
            if (latest.rowCount) {
              const previous = latest.rows[0];
              if (
                at < previous.occurred_at ||
                (previous.content.reaction?.message_id === incoming.reaction?.message_id &&
                  previous.content.reaction?.emoji === incoming.reaction?.emoji)
              )
                continue;
              metaId = null;
            }
          }
          const id = randomUUID();
          const inserted = await client.query(
            `INSERT INTO messages(id,meta_id,contact_id,direction,type,content,raw_payload,submission_status,occurred_at,created_at)
            VALUES($1,$2,$3,'inbound',$4,$5,$5,'received',$6,CASE WHEN $4='reaction' THEN clock_timestamp() ELSE now() END)
            ON CONFLICT(meta_id) DO NOTHING RETURNING id`,
            [id, metaId, incoming.from, incoming.type, incoming, at],
          );
          if (!inserted.rowCount) continue;
          let assetId: string | null = null;
          if (
            ["image", "document", "audio", "video", "sticker"].includes(
              incoming.type,
            ) &&
            incoming[incoming.type]?.id
          ) {
            const asset = incoming[incoming.type];
            const result = await client.query(
              `INSERT INTO media(meta_id,kind,mime_type,expected_sha256) VALUES($1,$2,$3,$4)
              ON CONFLICT(meta_id) WHERE meta_id IS NOT NULL DO UPDATE SET meta_id=EXCLUDED.meta_id RETURNING id`,
              [
                asset.id,
                incoming.type,
                asset.mime_type ?? null,
                asset.sha256 ?? null,
              ],
            );
            assetId = result.rows[0].id;
            await client.query("UPDATE messages SET media_id=$1 WHERE id=$2", [
              assetId,
              id,
            ]);
            await client.query(
              "INSERT INTO message_media(message_id,media_id,content_path) VALUES($1,$2,$3)",
              [id, assetId, incoming.type],
            );
            await client.query(
              "INSERT INTO jobs(kind,media_id) VALUES('archive',$1) ON CONFLICT DO NOTHING",
              [assetId],
            );
          }
          if (config.inboundWebhookUrl) {
            const eventId = randomUUID();
            const notification = {
              eventId,
              type: "message.received",
              occurredAt: at.toISOString(),
              message: {
                id,
                metaId: incoming.id,
                from: incoming.from,
                to: config.phoneNumberId,
                type: incoming.type,
                content: incoming[incoming.type] ?? {},
                context: incoming.context ?? null,
                contact: contact?.profile ?? null,
                media: assetId
                  ? {
                      id: assetId,
                      status: "pending",
                      metadataPath: `/v1/media/${assetId}`,
                      contentPath: `/v1/media/${assetId}/content`,
                    }
                  : null,
                original: incoming,
              },
            };
            await client.query(
              "INSERT INTO webhook_deliveries(id,message_id,payload) VALUES($1,$2,$3)",
              [eventId, id, notification],
            );
            await client.query(
              "INSERT INTO jobs(kind,delivery_id) VALUES('notify',$1)",
              [eventId],
            );
          }
        }
        for (const status of value.statuses ?? []) {
          if (
            typeof status.id !== "string" ||
            typeof status.status !== "string"
          )
            throw new AppError(
              400,
              "INVALID_WEBHOOK",
              "Missing status identity",
            );
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`meta:${status.id}`],
          );
          await client.query(
            "INSERT INTO status_events(event_key,meta_id,status,occurred_at,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            [
              digest(status),
              status.id,
              status.status,
              eventDate(status.timestamp),
              status,
            ],
          );
          // Our UUID is echoed in status callbacks and can recover a timed-out send response.
          if (
            typeof status.biz_opaque_callback_data === "string" &&
            /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(status.biz_opaque_callback_data)
          ) {
            await client.query(
              "UPDATE messages SET meta_id=$1,submission_status='accepted',updated_at=now() WHERE id=$2 AND direction='outbound' AND (meta_id IS NULL OR meta_id=$1)",
              [status.id, status.biz_opaque_callback_data],
            );
          }
          const message = await client.query(
            "SELECT id FROM messages WHERE meta_id=$1 AND direction='outbound'",
            [status.id],
          );
          if (message.rowCount)
            await reconcileStatuses(client, message.rows[0].id, status.id);
        }
      }
    }
  });
}
