import { validateRange, utc, validation, fail, pagination } from "./domain.js";
import { mutate, audit, siteAccess, staffAccess } from "./service.js";
import { queueAttempt } from "./outbox.js";
import { randomUUID } from "node:crypto";

export async function lockStaff(db, ids) {
  for (const id of [...new Set(ids.filter(Boolean))].sort())
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      id,
    ]);
}
export async function checkOverlap(
  db,
  user,
  staffId,
  start,
  end,
  excludeId = null,
) {
  if (!staffId) return;
  const { rows } = await db.query(
    "SELECT s.* FROM shifts s WHERE staff_id=$1 AND status<>'cancelled' AND tstzrange(start_at,end_at,'[)')&&tstzrange($2::timestamptz,$3::timestamptz,'[)') AND ($4::uuid IS NULL OR id<>$4)",
    [staffId, start, end, excludeId],
  );
  if (rows[0]) {
    let conflict = rows[0];
    if (
      user.role !== "admin" &&
      !(
        await db.query(
          "SELECT 1 FROM site_managers WHERE site_id=$1 AND user_id=$2",
          [conflict.site_id, user.id],
        )
      ).rowCount
    )
      conflict = {
        type: "busy",
        start_at: conflict.start_at,
        end_at: conflict.end_at,
      };
    fail(409, "Staff has an overlapping shift", {
      reason: "overlapping_shift",
      conflict,
    });
  }
}
async function eligibility(db, user, staffId, siteId, acknowledge) {
  if (!staffId) return [];
  const staff = await staffAccess(db, user, staffId);
  if (["blocked", "inactive"].includes(staff.status))
    fail(409, "Staff cannot be assigned", { reason: "staff_not_active" });
  const warnings = [];
  if (staff.status === "on_leave") warnings.push("on_leave");
  if (
    !(
      await db.query(
        "SELECT 1 FROM site_staff WHERE site_id=$1 AND staff_id=$2 AND active",
        [siteId, staffId],
      )
    ).rowCount
  )
    warnings.push("not_linked");
  if (warnings.length && acknowledge !== true)
    fail(409, "Assignment needs acknowledgement", { warnings });
  return warnings;
}
export async function futureStaffWarnings(db, staffId, clock, siteId = null) {
  const { rows } = await db.query(
    "SELECT sh.*,s.name AS site_name,s.timezone FROM shifts sh JOIN sites s ON s.id=sh.site_id WHERE sh.staff_id=$1 AND sh.start_at>$2 AND sh.status<>'cancelled' AND ($3::uuid IS NULL OR sh.site_id=$3) ORDER BY sh.start_at,sh.id",
    [staffId, clock(), siteId],
  );
  return rows.length ? [{ reason: "future_shifts", shifts: rows }] : [];
}
async function notifyChange(db, clock, before, after) {
  if (
    !["published", "confirmed"].includes(before.status) ||
    new Date(before.start_at) <= clock()
  )
    return [];
  const timeChanged =
    +new Date(before.start_at) !== +new Date(after.start_at) ||
    +new Date(before.end_at) !== +new Date(after.end_at);
  const reassigned = before.staff_id !== after.staff_id,
    cancelled = after.status === "cancelled";
  if (!timeChanged && !reassigned && !cancelled) return [];
  const targets = [];
  if ((reassigned || cancelled) && before.staff_id)
    targets.push({ id: before.staff_id, kind: "cancelled" });
  if (!cancelled && after.staff_id)
    targets.push({ id: after.staff_id, kind: reassigned ? "new" : "changed" });
  const notNotified = [],
    operation = randomUUID();
  for (const target of targets) {
    const staff = (
      await db.query("SELECT * FROM staff WHERE id=$1", [target.id])
    ).rows[0];
    if (staff.status !== "active" || !staff.whatsapp_opt_in) {
      notNotified.push(staff.id);
      continue;
    }
    await queueAttempt(db, clock, {
      siteId: after.site_id,
      staffId: staff.id,
      channel: "whatsapp",
      purpose: "roster_change",
      key: `shift-change:${operation}:${staff.id}:${target.kind}`,
      payload: { ...after, old: before, change: target.kind },
    });
  }
  return notNotified;
}
export function registerRoster(app, { pool, clock }) {
  app.post("/api/sites/:id/roster/publish", async (req, res) => {
    const from = utc(req.body.from, "from"),
      to = utc(req.body.to, "to");
    if (to <= from || to - from > 31 * 86400000)
      validation("range", "Maximum 31 days");
    const result = await mutate(pool, clock, async (db) => {
      const site = await siteAccess(db, req.user, req.params.id);
      const before = (
        await db.query(
          "SELECT * FROM shifts WHERE site_id=$1 AND status='draft' AND start_at>=$2 AND start_at<$3 ORDER BY id FOR UPDATE",
          [site.id, from, to],
        )
      ).rows;
      const byStaff = new Map();
      for (const shift of before) {
        const row = (
          await db.query(
            "UPDATE shifts SET status='published' WHERE id=$1 RETURNING *",
            [shift.id],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          "shift.published",
          "shift",
          shift.id,
          shift,
          row,
          site.id,
        );
        if (shift.staff_id && new Date(shift.start_at) > clock()) {
          if (!byStaff.has(shift.staff_id)) byStaff.set(shift.staff_id, []);
          byStaff.get(shift.staff_id).push(row);
        }
      }
      const notNotified = [];
      let notified = 0;
      for (const [staffId, shifts] of byStaff) {
        const staff = (
          await db.query("SELECT * FROM staff WHERE id=$1", [staffId])
        ).rows[0];
        if (staff.status !== "active" || !staff.whatsapp_opt_in) {
          notNotified.push(staffId);
          continue;
        }
        await queueAttempt(db, clock, {
          siteId: site.id,
          staffId,
          channel: "whatsapp",
          purpose: "roster_publish",
          key: `roster-publish:${staffId}:${shifts
            .map((s) => s.id)
            .sort()
            .join(":")}`,
          payload: { ...shifts[0], shifts },
        });
        notified++;
      }
      return { published: before.length, notified, not_notified: notNotified };
    });
    res.json(result);
  });
  app.post("/api/shifts", async (req, res) => {
    const body = req.body ?? {},
      range = validateRange(body.start_at, body.end_at);
    if (
      body.notes !== undefined &&
      (typeof body.notes !== "string" || body.notes.length > 500)
    )
      validation("notes", "Maximum 500 characters");
    const row = await mutate(pool, clock, async (db) => {
      const site = await siteAccess(db, req.user, body.site_id, 403, true);
      if (site.status !== "active") fail(409, "Site is inactive");
      await lockStaff(db, [body.staff_id]);
      const warnings = await eligibility(
        db,
        req.user,
        body.staff_id,
        site.id,
        body.acknowledge_warnings,
      );
      await checkOverlap(
        db,
        req.user,
        body.staff_id,
        range.start_at,
        range.end_at,
      );
      const row = (
        await db.query(
          "INSERT INTO shifts(site_id,staff_id,start_at,end_at,notes) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            site.id,
            body.staff_id ?? null,
            range.start_at,
            range.end_at,
            body.notes ?? "",
          ],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "shift.created",
        "shift",
        row.id,
        null,
        row,
        site.id,
        { warnings },
      );
      return row;
    });
    res.status(201).json(row);
  });
  app.patch("/api/shifts/:id", async (req, res) => {
    const result = await mutate(pool, clock, async (db) => {
      const initial = (
        await db.query("SELECT * FROM shifts WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!initial) fail(404, "Shift not found");
      await siteAccess(db, req.user, initial.site_id, 403, true);
      const staffId =
        req.body.staff_id === undefined ? initial.staff_id : req.body.staff_id;
      await lockStaff(db, [initial.staff_id, staffId]);
      const before = (
        await db.query("SELECT * FROM shifts WHERE id=$1 FOR UPDATE", [
          initial.id,
        ])
      ).rows[0];
      if (before.staff_id !== initial.staff_id)
        fail(409, "Shift changed; reload before editing");
      if (["completed", "cancelled"].includes(before.status))
        fail(409, "Shift cannot be edited");
      const start = req.body.start_at ?? before.start_at.toISOString(),
        end = req.body.end_at ?? before.end_at.toISOString();
      const changesAssignment =
        staffId !== before.staff_id ||
        +new Date(start) !== +new Date(before.start_at) ||
        +new Date(end) !== +new Date(before.end_at);
      const filling = (
        await db.query(
          "SELECT 1 FROM requests WHERE status='open' AND $1=ANY(open_shift_ids)",
          [before.id],
        )
      ).rowCount;
      if (changesAssignment && (before.request_id || filling))
        fail(
          409,
          "This shift is managed by a request. Cancel that request before changing staff or times.",
          { reason: "request_managed_shift" },
        );
      const range = validateRange(start, end),
        notes = req.body.notes ?? before.notes;
      if (typeof notes !== "string" || notes.length > 500)
        validation("notes", "Maximum 500 characters");
      const warnings = await eligibility(
        db,
        req.user,
        staffId,
        before.site_id,
        req.body.acknowledge_warnings,
      );
      await checkOverlap(
        db,
        req.user,
        staffId,
        range.start_at,
        range.end_at,
        before.id,
      );
      const row = (
        await db.query(
          "UPDATE shifts SET staff_id=$2,start_at=$3,end_at=$4,notes=$5 WHERE id=$1 RETURNING *",
          [before.id, staffId, range.start_at, range.end_at, notes],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "shift.updated",
        "shift",
        row.id,
        before,
        row,
        row.site_id,
        { warnings },
      );
      return {
        ...row,
        not_notified: await notifyChange(db, clock, before, row),
      };
    });
    res.json(result);
  });
  app.post("/api/shifts/:id/cancel", async (req, res) => {
    const result = await mutate(pool, clock, async (db) => {
      const initial = (
        await db.query("SELECT * FROM shifts WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!initial) fail(404, "Shift not found");
      await siteAccess(db, req.user, initial.site_id, 403);
      await lockStaff(db, [initial.staff_id]);
      const before = (
        await db.query("SELECT * FROM shifts WHERE id=$1 FOR UPDATE", [
          initial.id,
        ])
      ).rows[0];
      const filling = (
        await db.query(
          "SELECT 1 FROM requests WHERE status='open' AND $1=ANY(open_shift_ids)",
          [before.id],
        )
      ).rowCount;
      if (before.request_id || filling)
        fail(409, "Cancel the related request to cancel this shift", {
          reason: "request_managed_shift",
        });
      if (["completed", "cancelled"].includes(before.status))
        fail(409, "Shift cannot be cancelled");
      const row = (
        await db.query(
          "UPDATE shifts SET status='cancelled' WHERE id=$1 RETURNING *",
          [before.id],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "shift.cancelled",
        "shift",
        row.id,
        before,
        row,
        row.site_id,
      );
      return {
        ...row,
        not_notified: await notifyChange(db, clock, before, row),
      };
    });
    res.json(result);
  });
  app.get("/api/sites/:id/roster", async (req, res) => {
    const site = await siteAccess(pool, req.user, req.params.id);
    const from = utc(req.query.from, "from"),
      to = utc(req.query.to, "to");
    if (to <= from || to - from > 31 * 86400000)
      validation("range", "Roster range must be positive and at most 31 days");
    const { rows } = await pool.query(
      "SELECT s.*,p.name AS staff_name FROM shifts s LEFT JOIN staff p ON p.id=s.staff_id WHERE s.site_id=$1 AND s.start_at<$3 AND s.end_at>$2 AND ($4 OR s.status<>'cancelled') ORDER BY s.start_at,s.id",
      [site.id, from, to, req.query.include_cancelled === "true"],
    );
    const groups = new Map(),
      days = {};
    for (const row of rows) {
      if (!groups.has(row.staff_id))
        groups.set(row.staff_id, {
          staff_id: row.staff_id,
          staff_name: row.staff_name,
          shifts: [],
        });
      groups.get(row.staff_id).shifts.push(row);
      if (!row.staff_id && row.status !== "cancelled") {
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: site.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(row.start_at);
        days[date] ??= { open_shifts: 0, understaffed: true };
        days[date].open_shifts++;
      }
    }
    res.json({
      site,
      timezone: site.timezone,
      groups: [...groups.values()],
      days,
    });
  });
  app.get("/api/staff/:id/roster", async (req, res) => {
    await staffAccess(pool, req.user, req.params.id);
    const { page, limit, offset } = pagination(req.query);
    const { rows } = await pool.query(
      "SELECT s.*,p.name AS site_name,($2='admin' OR EXISTS(SELECT 1 FROM site_managers m WHERE m.site_id=s.site_id AND m.user_id=$3)) AS visible FROM shifts s JOIN sites p ON p.id=s.site_id WHERE s.staff_id=$1 AND s.status<>'cancelled' ORDER BY s.start_at,s.id LIMIT $4 OFFSET $5",
      [req.params.id, req.user.role, req.user.id, limit, offset],
    );
    const total = Number(
      (
        await pool.query(
          "SELECT count(*) FROM shifts WHERE staff_id=$1 AND status<>'cancelled'",
          [req.params.id],
        )
      ).rows[0].count,
    );
    res.json({
      items: rows.map(({ visible, ...row }) =>
        visible
          ? row
          : { type: "busy", start_at: row.start_at, end_at: row.end_at },
      ),
      total,
      page,
      limit,
    });
  });
}
