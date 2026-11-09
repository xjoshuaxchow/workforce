import type pg from "pg";
import { z } from "zod";
import { AppError } from "../errors.js";
import { phone } from "../validation.js";

export const conversationQuery = z
  .object({
    q: z.string().trim().max(100).default(""),
    contacts: z.string().max(1600).optional(),
    unread: z.enum(["true", "false"]).default("false"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(512).optional(),
  })
  .strict();

function present(row: any) {
  return {
    contact: row.wa_id,
    profile: row.profile,
    lastInboundAt: row.last_inbound_at,
    windowExpiresAt: row.last_inbound_at
      ? new Date(
          new Date(row.last_inbound_at).getTime() + 86400000,
        ).toISOString()
      : null,
    canReply: row.can_reply,
    unreadCount: row.unread_count,
    lastMessage: row.last_message,
  };
}

const summary = `SELECT c.wa_id,c.profile,inbound.last_inbound_at,
  COALESCE(inbound.last_inbound_at > clock_timestamp()-interval '24 hours',false) AS can_reply,
  latest.created_at AS activity_at,
  to_char(latest.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
  latest.message AS last_message,
  (SELECT count(*)::int FROM messages m WHERE m.contact_id=c.wa_id AND m.direction='inbound' AND m.type<>'reaction' AND m.read_at IS NULL) AS unread_count
  FROM contacts c LEFT JOIN LATERAL (
    SELECT max(m.occurred_at) AS last_inbound_at FROM messages m
    WHERE m.contact_id=c.wa_id AND m.direction='inbound' AND m.type<>'reaction'
  ) inbound ON true JOIN LATERAL (
    SELECT m.created_at,to_jsonb(m) AS message FROM messages m WHERE m.contact_id=c.wa_id AND m.type<>'reaction'
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1
  ) latest ON true`;

export async function listConversations(
  pool: pg.Pool,
  query: z.infer<typeof conversationQuery>,
) {
  const contacts = query.contacts
    ? z.array(phone).max(100).parse(query.contacts.split(","))
    : [];
  const args: unknown[] = [query.q, contacts];
  const conditions = [
    `($1='' OR c.wa_id ILIKE '%'||$1||'%' OR c.profile->>'name' ILIKE '%'||$1||'%' OR c.wa_id=ANY($2::text[]))`,
  ];
  if (query.unread === "true")
    conditions.push(
      "EXISTS (SELECT 1 FROM messages m WHERE m.contact_id=c.wa_id AND m.direction='inbound' AND m.type<>'reaction' AND m.read_at IS NULL)",
    );
  if (query.cursor) {
    let cursor;
    try {
      cursor = z
        .object({ at: z.iso.datetime({ offset: true }), contact: phone })
        .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()));
    } catch {
      throw new AppError(422, "INVALID_CURSOR", "Invalid conversation cursor");
    }
    args.push(cursor.at, cursor.contact);
    conditions.push("(latest.created_at,c.wa_id)<($3::timestamptz,$4::text)");
  }
  args.push(query.limit + 1);
  const result = await pool.query(
    `${summary} WHERE ${conditions.join(" AND ")} ORDER BY latest.created_at DESC,c.wa_id DESC LIMIT $${args.length}`,
    args,
  );
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    data: rows.map(present),
    nextCursor:
      result.rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.cursor_at, contact: last.wa_id }),
          ).toString("base64url")
        : null,
  };
}

export async function getConversation(pool: pg.Pool, contact: string) {
  const result = await pool.query(`${summary} WHERE c.wa_id=$1`, [contact]);
  return result.rowCount
    ? present(result.rows[0])
    : {
        contact,
        profile: {},
        lastInboundAt: null,
        windowExpiresAt: null,
        canReply: false,
        unreadCount: 0,
        lastMessage: null,
      };
}
