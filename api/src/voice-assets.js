import { validMp3 } from "./audio-validation.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { mutate, audit, admin, siteAccess } from "./service.js";
import { requestAccess } from "./dispatch.js";
import { fail, validation, pagination } from "./domain.js";
const upload = z
  .object({
    name: z.string().trim().min(1).max(120),
    language: z.enum(["en", "yue", "zh"]),
    content_type: z.enum(["audio/mpeg", "audio/wav"]),
    data: z.string().max(4194304),
  })
  .strict();
const purpose = z.enum(["offer", "confirmation", "cancellation", "message"]);
function parse(schema, value) {
  const p = schema.safeParse(value);
  if (!p.success) validation("audio", "Invalid audio fields");
  return p.data;
}
function audioBytes(input) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data) || input.data.length % 4)
    validation("audio", "Invalid base64 audio");
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length < 44 || bytes.length > 3 * 1024 * 1024)
    validation("audio", "Audio must be a valid MP3 or WAV up to 3 MB");
  if (input.content_type === "audio/mpeg") {
    if (!validMp3(bytes)) validation("audio", "File is not a complete MP3");
  } else {
    if (
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE" ||
      bytes.readUInt32LE(4) + 8 > bytes.length
    )
      validation("audio", "File is not a complete WAV");
    let fmt = false,
      data = false;
    for (let at = 12; at + 8 <= bytes.length;) {
      const name = bytes.toString("ascii", at, at + 4),
        size = bytes.readUInt32LE(at + 4);
      if (at + 8 + size > bytes.length) validation("audio", "WAV is truncated");
      if (name === "fmt ") {
        if (
          size < 16 ||
          bytes.readUInt16LE(at + 8) !== 1 ||
          ![1, 2].includes(bytes.readUInt16LE(at + 10)) ||
          bytes.readUInt16LE(at + 22) !== 16
        )
          validation("audio", "Use PCM 16-bit WAV");
        fmt = true;
      }
      if (name === "data") data = size > 0;
      at += 8 + size + (size % 2);
    }
    if (!fmt || !data) validation("audio", "WAV requires audio data");
  }
  return bytes;
}
export function audioMetadata(row) {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    content_type: row.content_type,
    request_id: row.request_id,
    site_id: row.site_id,
    active: row.active,
    ctime: row.ctime,
    utime: row.utime,
    preview_path: `/api/settings/voice-assets/${row.id}/content`,
    playback_path: `/media/voice/${row.public_token}`,
  };
}
export async function insertAudio(db, clock, user, input, request = null) {
  const bytes = audioBytes(input);
  const row = (
    await db.query(
      "INSERT INTO voice_assets(public_token,name,language,content_type,data,site_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        randomBytes(32).toString("hex"),
        input.name,
        input.language,
        input.content_type,
        bytes,
        request?.site_id ?? null,
        request?.id ?? null,
      ],
    )
  ).rows[0];
  await audit(
    db,
    clock,
    user,
    "voice_asset.created",
    "voice_asset",
    row.id,
    null,
    audioMetadata(row),
    row.site_id,
  );
  return row;
}
export function registerVoiceAssets(app, { pool, clock = () => new Date() }) {
  app.get("/media/voice/:token", async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.token)) fail(404, "Audio not found");
    const row = (
      await pool.query(
        "SELECT content_type,data FROM voice_assets WHERE public_token=$1",
        [req.params.token],
      )
    ).rows[0];
    if (!row) fail(404, "Audio not found");
    res
      .set({
        "Content-Type": row.content_type,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": "inline",
      })
      .send(row.data);
  });
  app.get("/api/settings/voice-assets", async (req, res) => {
    admin(req.user);
    const { page, limit, offset } = pagination(req.query);
    const rows = (
      await pool.query(
        "SELECT id,public_token,name,language,content_type,request_id,site_id,active,ctime,utime FROM voice_assets WHERE active AND request_id IS NULL ORDER BY ctime,id LIMIT $1 OFFSET $2",
        [limit, offset],
      )
    ).rows;
    const total = Number(
      (
        await pool.query(
          "SELECT count(*) FROM voice_assets WHERE active AND request_id IS NULL",
        )
      ).rows[0].count,
    );
    res.json({ items: rows.map(audioMetadata), total, page, limit });
  });
  app.post("/api/settings/voice-assets", async (req, res) => {
    admin(req.user);
    const input = parse(upload, req.body);
    res
      .status(201)
      .json(
        await mutate(pool, clock, async (db) =>
          audioMetadata(await insertAudio(db, clock, req.user, input)),
        ),
      );
  });
  app.get("/api/settings/voice-assets/:id/content", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success)
      fail(404, "Audio not found");
    const row = (
      await pool.query("SELECT * FROM voice_assets WHERE id=$1", [
        req.params.id,
      ])
    ).rows[0];
    if (!row) fail(404, "Audio not found");
    if (row.site_id) await siteAccess(pool, req.user, row.site_id);
    else admin(req.user);
    res
      .set({
        "Content-Type": row.content_type,
        "Cache-Control": "no-store",
        "Content-Disposition": "inline",
      })
      .send(row.data);
  });
  app.delete("/api/settings/voice-assets/:id", async (req, res) => {
    admin(req.user);
    const id = parse(z.uuid(), req.params.id);
    await mutate(pool, clock, async (db) => {
      const before = (
        await db.query("SELECT * FROM voice_assets WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!before) fail(404, "Audio not found");
      const row = (
        await db.query(
          "UPDATE voice_assets SET active=false WHERE id=$1 RETURNING *",
          [id],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "voice_asset.archived",
        "voice_asset",
        id,
        audioMetadata(before),
        audioMetadata(row),
        row.site_id,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/requests/:id/voice-audio", async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    await requestAccess(pool, req.user, id);
    const rows = (
      await pool.query(
        "SELECT a.*,b.purpose FROM request_voice_bindings b JOIN voice_assets a ON a.id=b.asset_id WHERE b.request_id=$1 ORDER BY b.language,b.purpose",
        [id],
      )
    ).rows;
    res.json({
      items: rows.map((row) => ({
        ...audioMetadata(row),
        purpose: row.purpose,
      })),
    });
  });
  app.post("/api/requests/:id/voice-audio", async (req, res) => {
    const id = parse(z.uuid(), req.params.id),
      input = parse(upload.extend({ purpose }), req.body);
    const result = await mutate(pool, clock, async (db) => {
      const request = await requestAccess(db, req.user, id, 404, true);
      if (request.status !== "draft")
        fail(409, "Audio can only be changed on a draft request");
      const { purpose: kind, ...file } = input;
      const row = await insertAudio(db, clock, req.user, file, request);
      const old =
        (
          await db.query(
            "SELECT * FROM request_voice_bindings WHERE request_id=$1 AND language=$2 AND purpose=$3",
            [id, input.language, kind],
          )
        ).rows[0] ?? null;
      const binding = (
        await db.query(
          "INSERT INTO request_voice_bindings(request_id,language,purpose,asset_id) VALUES($1,$2,$3,$4) ON CONFLICT(request_id,language,purpose) DO UPDATE SET asset_id=$4 RETURNING *",
          [id, input.language, kind, row.id],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "request_voice_binding.updated",
        "request_voice_binding",
        binding.id,
        old,
        binding,
        request.site_id,
      );
      return { ...audioMetadata(row), purpose: kind };
    });
    res.status(201).json(result);
  });
}
