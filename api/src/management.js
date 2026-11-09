import { parse } from "csv-parse/sync";
import {
  validateStaff,
  validateSite,
  validation,
  fail,
  pagination,
} from "./domain.js";
import { mutate, audit, admin, siteAccess, staffAccess } from "./service.js";

function csvRows(csv, required) {
  if (typeof csv !== "string" || Buffer.byteLength(csv) > 5 * 1024 * 1024)
    validation("csv", "CSV must be text no larger than 5 MB");
  let headers;
  let rows;
  try {
    rows = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      columns: (cols) => {
        headers = cols.map((x) => x.trim());
        return headers;
      },
      max_record_size: 5 * 1024 * 1024,
    });
  } catch {
    validation("csv", "Malformed CSV");
  }
  for (const column of required)
    if (!headers?.includes(column))
      validation("csv", `Missing required column: ${column}`);
  if (rows.length > 5000) validation("csv", "Maximum 5000 rows");
  return rows;
}
function csvError(row, field, message) {
  return { row, field, message };
}
export function registerManagement(app, { pool, clock }) {
  app.post("/api/staff/import", async (req, res) => {
    admin(req.user);
    const rows = csvRows(req.body?.csv, ["name", "mobile"]);
    const errors = [],
      values = [],
      seen = new Set();
    for (const [i, row] of rows.entries()) {
      try {
        const text = String(row.whatsapp_opt_in ?? "")
          .trim()
          .toLowerCase();
        if (text && !["true", "false"].includes(text))
          validation("whatsapp_opt_in", "Use true or false");
        const value = validateStaff({
          name: row.name,
          mobile: row.mobile,
          ...(row.landline ? { landline: row.landline } : {}),
          ...(row.language ? { language: row.language } : {}),
          ...(row.preferred_channel
            ? { preferred_channel: row.preferred_channel }
            : {}),
          whatsapp_opt_in: text === "true",
          whatsapp_opt_in_source:
            row.whatsapp_opt_in_source || (text === "true" ? "import" : null),
        });
        if (seen.has(value.mobile))
          errors.push(csvError(i + 1, "mobile", "duplicate in file"));
        seen.add(value.mobile);
        values.push(value);
      } catch (error) {
        for (const field of error.errors ?? [
          { field: "csv", message: error.message },
        ])
          errors.push(csvError(i + 1, field.field, field.message));
        values.push(null);
      }
    }
    if (errors.length) fail(400, "CSV validation failed", { errors });
    const result = await mutate(pool, clock, async (db) => {
      const existing = await db.query(
        "SELECT mobile FROM staff WHERE mobile=ANY($1::text[])",
        [values.map((x) => x.mobile)],
      );
      const numbers = new Set(existing.rows.map((x) => x.mobile));
      const duplicates = values.flatMap((v, i) =>
        numbers.has(v.mobile)
          ? [csvError(i + 1, "mobile", "already exists")]
          : [],
      );
      if (duplicates.length)
        fail(400, "CSV validation failed", { errors: duplicates });
      for (const [i, v] of values.entries()) {
        let row;
        try {
          row = (
            await db.query(
              "INSERT INTO staff(name,mobile,landline,language,preferred_channel,status,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_in_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
              [
                v.name,
                v.mobile,
                v.landline,
                v.language,
                v.preferred_channel,
                v.status,
                v.whatsapp_opt_in,
                v.whatsapp_opt_in ? clock() : null,
                v.whatsapp_opt_in_source,
              ],
            )
          ).rows[0];
        } catch (error) {
          if (error.code === "23505")
            fail(400, "CSV validation failed", {
              errors: [csvError(i + 1, "mobile", "already exists")],
            });
          throw error;
        }
        await audit(
          db,
          clock,
          req.user,
          "staff.created",
          "staff",
          row.id,
          null,
          row,
          null,
          { source: "csv" },
        );
      }
      return { created: values.length };
    });
    res.json(result);
  });
  app.post("/api/links/import", async (req, res) => {
    admin(req.user);
    const rows = csvRows(req.body?.csv, ["site_code", "staff_mobile"]);
    const result = await mutate(pool, clock, async (db) => {
      const resolved = [],
        errors = [];
      for (const [i, row] of rows.entries()) {
        const site = (
          await db.query("SELECT * FROM sites WHERE code=$1 FOR SHARE", [
            String(row.site_code ?? "")
              .trim()
              .toUpperCase(),
          ])
        ).rows[0];
        const staff = (
          await db.query("SELECT * FROM staff WHERE mobile=$1", [
            String(row.staff_mobile ?? "").replace(/[\s-]/g, ""),
          ])
        ).rows[0];
        if (!site)
          errors.push(csvError(i + 1, "site_code", "Unknown site code"));
        else if (site.status !== "active")
          errors.push(csvError(i + 1, "site_code", "Site is inactive"));
        if (!staff)
          errors.push(csvError(i + 1, "staff_mobile", "Unknown mobile"));
        resolved.push({ site, staff });
      }
      if (errors.length) fail(400, "CSV validation failed", { errors });
      let linked = 0,
        already_linked = 0;
      for (const { site, staff } of resolved) {
        const before = (
          await db.query(
            "SELECT * FROM site_staff WHERE site_id=$1 AND staff_id=$2 FOR UPDATE",
            [site.id, staff.id],
          )
        ).rows[0];
        if (before?.active) {
          already_linked++;
          continue;
        }
        const row = (
          await db.query(
            "INSERT INTO site_staff(site_id,staff_id,linked_at) VALUES($1,$2,$3) ON CONFLICT(site_id,staff_id) DO UPDATE SET active=true,linked_at=EXCLUDED.linked_at RETURNING *",
            [site.id, staff.id, clock()],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          "staff.linked",
          "site_staff",
          row.id,
          before ?? null,
          row,
          site.id,
          { source: "csv" },
        );
        linked++;
      }
      return { linked, already_linked };
    });
    res.json(result);
  });
  app.get("/api/staff/:id/sites", async (req, res) => {
    await staffAccess(pool, req.user, req.params.id);
    const { page, limit, offset } = pagination(req.query);
    const where =
      "l.staff_id=$1 AND l.active AND ($2='admin' OR EXISTS(SELECT 1 FROM site_managers m WHERE m.site_id=s.id AND m.user_id=$3))";
    const params = [req.params.id, req.user.role, req.user.id];
    const { rows } = await pool.query(
      `SELECT s.* FROM sites s JOIN site_staff l ON l.site_id=s.id WHERE ${where} ORDER BY s.code,s.id LIMIT $4 OFFSET $5`,
      [...params, limit, offset],
    );
    const total = Number(
      (
        await pool.query(
          `SELECT count(*) FROM sites s JOIN site_staff l ON l.site_id=s.id WHERE ${where}`,
          params,
        )
      ).rows[0].count,
    );
    res.json({ items: rows, total, page, limit });
  });
  app.patch("/api/sites/:id", async (req, res) => {
    admin(req.user);
    const result = await mutate(pool, clock, async (db) => {
      const before = (
        await db.query("SELECT * FROM sites WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ])
      ).rows[0];
      if (!before) fail(404, "Site not found");
      const v = validateSite({ ...before, ...req.body });
      const open = (
        await db.query(
          "SELECT 1 FROM requests WHERE site_id=$1 AND status='open' LIMIT 1",
          [before.id],
        )
      ).rowCount;
      if (v.status === "inactive" && open) fail(409, "Site has open requests");
      if (
        v.timezone !== before.timezone &&
        (open ||
          (
            await db.query(
              "SELECT 1 FROM shifts WHERE site_id=$1 AND start_at>$2 AND status<>'cancelled' LIMIT 1",
              [before.id, clock()],
            )
          ).rowCount)
      )
        fail(409, "Site has future shifts or open requests");
      const row = (
        await db.query(
          "UPDATE sites SET code=$2,name=$3,address=$4,timezone=$5,status=$6,voice_name_en=$7,voice_address_en=$8 WHERE id=$1 RETURNING *",
          [before.id, v.code, v.name, v.address, v.timezone, v.status, v.voice_name_en, v.voice_address_en],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "site.updated",
        "site",
        row.id,
        before,
        row,
        row.id,
      );
      return row;
    });
    res.json(result);
  });
}
