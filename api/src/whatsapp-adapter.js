import { z } from "zod";
import { mutate, audit } from "./service.js";
import { requestAccess } from "./dispatch.js";
import { prepareAttempt, receiveEvent, processEvent } from "./messaging.js";
import {
  createWhatsAppClient,
  buildWhatsAppMessage,
  parseWhatsAppReply,
  whatsAppStatus,
  WhatsAppServiceError,
  requireApprovedTemplate,
} from "./whatsapp-client.js";
const system = { role: "admin", actor_type: "system", id: null };
const accepted = z.object({ messageIds: z.array(z.uuid()).length(1) });
const outgoing = z.object({
  id: z.uuid(),
  contact_id: z.string(),
  direction: z.literal("outbound"),
  meta_id: z.string().nullable(),
  submission_status: z.enum([
    "queued",
    "sending",
    "accepted",
    "failed",
    "unknown",
  ]),
  delivery_status: z.string().nullable(),
});
const pageSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.uuid(),
        direction: z.literal("inbound"),
        contact_id: z.string(),
        content: z.unknown(),
      })
      .passthrough(),
  ),
  nextCursor: z.string().nullable(),
});
export function createWhatsAppAdapter({
  pool,
  config,
  clock = () => new Date(),
  client = createWhatsAppClient(config),
}) {
  async function lockAttempt(db, id) {
    const meta = (
      await db.query("SELECT request_id FROM attempts WHERE id=$1", [id])
    ).rows[0];
    if (!meta) return null;
    if (meta.request_id)
      await requestAccess(db, system, meta.request_id, 404, true);
    return (
      await db.query("SELECT * FROM attempts WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
  }
  async function updateAttempt(
    db,
    before,
    status,
    externalId = before.external_id,
  ) {
    const after = (
      await db.query(
        "UPDATE attempts SET status=$2,external_id=$3 WHERE id=$1 RETURNING *",
        [before.id, status, externalId],
      )
    ).rows[0];
    await audit(
      db,
      clock,
      system,
      "attempt.updated",
      "attempt",
      after.id,
      before,
      after,
      after.site_id,
    );
    return after;
  }
  function submission(value) {
    const parsed = accepted.safeParse(value);
    if (!parsed.success)
      throw new WhatsAppServiceError(502, "INVALID_RESPONSE", true);
    return parsed.data.messageIds[0];
  }
  async function bind(record, value) {
    const messageId = submission(value);
    await mutate(pool, clock, async (db) => {
      const attempt = await lockAttempt(db, record.attempt_id);
      const current = (
        await db.query(
          "SELECT * FROM whatsapp_submissions WHERE attempt_id=$1 FOR UPDATE",
          [record.attempt_id],
        )
      ).rows[0];
      if (current.message_id && current.message_id !== messageId)
        throw Error("WhatsApp submission identity changed");
      await db.query(
        "UPDATE whatsapp_submissions SET message_id=$2,state='submitted',last_error=NULL WHERE attempt_id=$1",
        [record.attempt_id, messageId],
      );
      if (
        attempt.external_id !== messageId ||
        ["queued", "submitting", "submission_unknown"].includes(attempt.status)
      )
        await updateAttempt(
          db,
          attempt,
          ["queued", "submitting", "submission_unknown"].includes(
            attempt.status,
          )
            ? "sent"
            : attempt.status,
          messageId,
        );
    });
    return messageId;
  }
  async function sendAttempt(id) {
    const record = await mutate(pool, clock, async (db) => {
      const before = await lockAttempt(db, id);
      if (
        !before ||
        !["queued", "submitting", "submission_unknown"].includes(before.status)
      )
        return null;
      const ready = await prepareAttempt(db, clock, id, {
        allowedStatuses: ["queued", "submitting", "submission_unknown"],
      });
      if (!ready) return null;
      let saved = (
        await db.query(
          "SELECT * FROM whatsapp_submissions WHERE attempt_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (saved?.message_id || saved?.state === "rejected") return null;
      if (!saved) {
        const templates = config.templatesByLanguage
          ? config.templatesByLanguage[ready.payload.language]
          : config.templates;
        if (!templates)
          throw Object.assign(Error("Missing WhatsApp language mapping"), {
            retryable: false,
            code: "missing_whatsapp_language",
          });
        const message = buildWhatsAppMessage(ready.payload, templates);
        saved = (
          await db.query(
            "INSERT INTO whatsapp_submissions(attempt_id,request_key,payload,to_number,next_poll_at,settings_version_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              id,
              "workforce:" + id,
              message,
              message.to,
              clock(),
              config.settingsVersion ?? null,
            ],
          )
        ).rows[0];
        // Preserve the original schedule data needed to validate a retry.
      }
      await updateAttempt(db, ready.attempt, "submitting");
      return saved;
    });
    if (!record) return;
    let result;
    try {
      try {
        result = await client.request(
          "GET",
          "/message-requests/" + encodeURIComponent(record.request_key),
        );
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (!result) {
        if (config.templatesByLanguage)
          try {
            await requireApprovedTemplate(client, record.payload);
          } catch (error) {
            error.submissionNotStarted = true;
            throw error;
          }
        result = await client.request("POST", "/messages", {
          data: record.payload,
          key: record.request_key,
        });
      }
      submission(result);
    } catch (error) {
      await mutate(pool, clock, async (db) => {
        const attempt = await lockAttempt(db, id);
        const uncertain =
          error.retryable &&
          error.status !== 429 &&
          !error.submissionNotStarted;
        await db.query(
          "UPDATE whatsapp_submissions SET state=$2,last_error=$3 WHERE attempt_id=$1",
          [
            id,
            uncertain ? "unknown" : error.retryable ? "reserved" : "rejected",
            error.code ?? "SERVICE_ERROR",
          ],
        );
        if (attempt.status === "submitting")
          await updateAttempt(
            db,
            attempt,
            uncertain ? "submission_unknown" : "queued",
          );
      });
      throw error;
    }
    await bind(record, result);
  }
  async function receiveOnce(event, raw) {
    // Existence is not completion. Finish older durable receipts before advancing.
    const pending = (
      await pool.query(
        "SELECT event_id FROM message_events WHERE correlation_id=$1 AND processed=false ORDER BY received_at,id",
        [event.correlation_id],
      )
    ).rows;
    for (const row of pending) await processEvent(pool, clock, row.event_id);
    const existing = (
      await pool.query(
        "SELECT processed FROM message_events WHERE event_id=$1",
        [event.event_id],
      )
    ).rows[0];
    if (!existing) await receiveEvent(pool, clock, event, JSON.stringify(raw));
    // receiveEvent retains a retry job when processing is deferred; do not overtake it.
    await processEvent(pool, clock, event.event_id);
  }
  async function poll() {
    const due = (
      await pool.query(
        `SELECT w.*,a.purpose,a.request_id FROM whatsapp_submissions w JOIN attempts a ON a.id=w.attempt_id LEFT JOIN requests r ON r.id=a.request_id WHERE w.state<>'rejected' AND w.next_poll_at<=$1 AND (w.message_id IS NULL OR (a.purpose='offer' AND r.end_at>$1) OR (a.purpose<>'offer' AND a.status NOT IN ('read','replied','failed','cancelled','completed'))) AND (w.settings_version_id=$2::uuid OR $2::uuid IS NULL) ORDER BY w.next_poll_at,w.attempt_id LIMIT 25`,
        [clock(), config.settingsVersion ?? null],
      )
    ).rows;
    const active = [];
    for (const record of due) {
      if (
        !(
          await pool.query(
            "UPDATE whatsapp_submissions SET next_poll_at=$2 WHERE attempt_id=$1 AND next_poll_at<=$3 RETURNING attempt_id",
            [record.attempt_id, new Date(+clock() + 3000), clock()],
          )
        ).rowCount
      )
        continue;
      try {
        let messageId = record.message_id;
        if (!messageId) {
          let result;
          try {
            result = await client.request(
              "GET",
              "/message-requests/" + encodeURIComponent(record.request_key),
            );
          } catch (error) {
            if (error.status === 404) continue;
            throw error;
          }
          messageId = await bind(record, result);
        }
        const raw = await client.request(
            "GET",
            "/messages/" + encodeURIComponent(messageId),
          ),
          parsed = outgoing.safeParse(raw);
        if (
          !parsed.success ||
          parsed.data.id !== messageId ||
          parsed.data.contact_id !== record.to_number
        )
          throw new WhatsAppServiceError(502, "INVALID_MESSAGE", true);
        const message = parsed.data;
        if (record.meta_id && record.meta_id !== message.meta_id)
          throw new WhatsAppServiceError(502, "MESSAGE_ID_CHANGED", true);
        if (message.meta_id)
          await pool.query(
            "UPDATE whatsapp_submissions SET meta_id=$2,last_error=NULL WHERE attempt_id=$1",
            [record.attempt_id, message.meta_id],
          );
        const status = whatsAppStatus(message);
        const revision = (
          await pool.query(
            "UPDATE whatsapp_submissions SET status_revision=status_revision+CASE WHEN last_status IS DISTINCT FROM $2 THEN 1 ELSE 0 END,last_status=$2 WHERE attempt_id=$1 RETURNING status_revision",
            [record.attempt_id, status],
          )
        ).rows[0].status_revision;
        await receiveOnce(
          {
            event_id: `whatsapp:${messageId}:status:${revision}:${status}`,
            correlation_id: record.attempt_id,
            external_id: messageId,
            type: status,
            reason: status === "failed" ? "whatsapp_provider_failed" : null,
          },
          raw,
        );
        if (record.purpose === "offer" && message.meta_id)
          active.push({
            ...record,
            message_id: messageId,
            meta_id: message.meta_id,
          });
      } catch (error) {
        await pool.query(
          "UPDATE whatsapp_submissions SET last_error=$2 WHERE attempt_id=$1",
          [record.attempt_id, error.code ?? "POLL_ERROR"],
        );
      }
    }
    const contacts = new Map();
    for (const record of active) {
      const group = contacts.get(record.to_number) ?? [];
      group.push(record);
      contacts.set(record.to_number, group);
    }
    for (const [contact, records] of contacts) {
      try {
        const all = [],
          seen = new Set();
        let cursor;
        do {
          const raw = await client.request("GET", "/messages", {
              params: {
                contact,
                direction: "inbound",
                from: new Date(
                  Math.min(...records.map((x) => new Date(x.ctime).getTime())) -
                    300000,
                ).toISOString(),
                limit: 100,
                cursor,
              },
            }),
            parsed = pageSchema.safeParse(raw);
          if (!parsed.success)
            throw new WhatsAppServiceError(502, "INVALID_PAGE", true);
          all.push(...parsed.data.data);
          cursor = parsed.data.nextCursor;
          if (cursor) {
            if (seen.has(cursor))
              throw new WhatsAppServiceError(502, "INVALID_CURSOR", true);
            seen.add(cursor);
          }
        } while (cursor);
        // The service returns descending SQL order, including microsecond timestamp keys.
        for (const incoming of all.reverse()) {
          const reply = parseWhatsAppReply(incoming.content);
          const record = reply
            ? active.find((x) => x.attempt_id === reply.attemptId)
            : records.find((x) => x.meta_id === incoming.content?.context?.id);
          if (!record) continue;
          const valid =
            reply &&
            incoming.contact_id === contact &&
            reply.sender === record.to_number &&
            incoming.contact_id === record.to_number &&
            reply.contextId === record.meta_id;
          await receiveOnce(
            {
              event_id: "whatsapp:incoming:" + incoming.id,
              correlation_id: record.attempt_id,
              external_id: record.message_id,
              type: valid ? "reply" : "provider_ignored",
              ...(valid ? { option_id: reply.optionId } : {}),
            },
            incoming,
          );
        }
      } catch (error) {
        for (const record of records)
          await pool.query(
            "UPDATE whatsapp_submissions SET last_error=$2 WHERE attempt_id=$1",
            [record.attempt_id, error.code ?? "INBOUND_POLL_ERROR"],
          );
      }
    }
  }
  return { sendAttempt, poll };
}
