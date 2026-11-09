import { enqueueJob, queueAttempt } from "./outbox.js";
export { enqueueJob, queueAttempt } from "./outbox.js";
import { z } from "zod";
import {
  contactable,
  validateRange,
  utc,
  validation,
  fail,
  pagination,
} from "./domain.js";
import { mutate, audit, siteAccess } from "./service.js";
import { lockStaff, checkOverlap } from "./roster.js";

const system = { actor_type: "system", id: null, role: "admin" };
export async function requestAccess(db, user, id, denied = 404, lock = false) {
  const row = (
    await db.query(
      `SELECT * FROM requests WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Request not found");
  await siteAccess(db, user, row.site_id, denied);
  return row;
}
export async function eligible(db, request, staff) {
  if (
    !(
      await db.query(
        "SELECT 1 FROM site_staff WHERE site_id=$1 AND staff_id=$2 AND active",
        [request.site_id, staff.id],
      )
    ).rowCount
  )
    return "not_linked";
  if (staff.status !== "active") return "not_active";
  if (!request.channels.some((c) => contactable(staff).includes(c)))
    return "not_contactable";
  if (
    (
      await db.query(
        "SELECT 1 FROM shifts WHERE staff_id=$1 AND status<>'cancelled' AND tstzrange(start_at,end_at,'[)')&&tstzrange($2,$3,'[)')",
        [staff.id, request.start_at, request.end_at],
      )
    ).rowCount
  )
    return "overlapping_shift";
  return null;
}
export async function followup(db, clock, request, candidate, purpose, key) {
  const staff = (
    await db.query("SELECT * FROM staff WHERE id=$1", [candidate.staff_id])
  ).rows[0];
  const channel = contactable(staff).includes("whatsapp")
    ? "whatsapp"
    : "voice";
  await queueAttempt(db, clock, {
    candidateId: candidate.id,
    requestId: request.id,
    siteId: request.site_id,
    staffId: staff.id,
    channel,
    purpose,
    key,
  });
}
async function closeQueued(db, clock, user, request, all = false) {
  const candidates = (
    await db.query(
      "UPDATE candidates SET status='skipped',reason='request_closed' WHERE request_id=$1 AND status='pending' RETURNING *",
      [request.id],
    )
  ).rows;
  for (const c of candidates)
    await audit(
      db,
      clock,
      user,
      "candidate.skipped",
      "candidate",
      c.id,
      null,
      c,
      request.site_id,
    );
  const attempts = (
    await db.query(
      "UPDATE attempts SET status='cancelled' WHERE request_id=$1 AND (purpose='offer' OR ($2 AND purpose='confirmation')) AND status='queued' RETURNING *",
      [request.id, all],
    )
  ).rows;
  for (const a of attempts)
    await audit(
      db,
      clock,
      user,
      "attempt.cancelled",
      "attempt",
      a.id,
      null,
      a,
      request.site_id,
    );
}
export async function expireRequest(db, clock, id) {
  const before = (
    await db.query("SELECT * FROM requests WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (
    !before ||
    before.status !== "open" ||
    new Date(before.deadline_at) > clock()
  )
    return before;
  const row = (
    await db.query(
      "UPDATE requests SET status='expired' WHERE id=$1 RETURNING *",
      [id],
    )
  ).rows[0];
  await audit(
    db,
    clock,
    system,
    "request.expired",
    "request",
    id,
    before,
    row,
    row.site_id,
  );
  const changed = (
    await db.query(
      "UPDATE candidates SET status='no_response' WHERE request_id=$1 AND status='contacting' AND final_response IS NULL RETURNING *",
      [id],
    )
  ).rows;
  for (const c of changed)
    await audit(
      db,
      clock,
      system,
      "candidate.no_response",
      "candidate",
      c.id,
      null,
      c,
      row.site_id,
    );
  await closeQueued(db, clock, system, row);
  return row;
}
export async function respond(db, clock, user, candidateId, response) {
  const found = (
    await db.query("SELECT request_id FROM candidates WHERE id=$1", [
      candidateId,
    ])
  ).rows[0];
  if (!found) fail(404, "Candidate not found");
  let request = await requestAccess(db, user, found.request_id, 404, true);
  if (request.status === "open" && new Date(request.deadline_at) <= clock())
    request = await expireRequest(db, clock, request.id);
  let candidate = (
    await db.query("SELECT * FROM candidates WHERE id=$1 FOR UPDATE", [
      candidateId,
    ])
  ).rows[0];
  if (candidate.final_response) return { ignored: true, candidate };
  const before = candidate;
  await db.query(
    "UPDATE attempts SET status='cancelled' WHERE candidate_id=$1 AND purpose='offer' AND status='queued'",
    [candidate.id],
  );
  let reason = null,
    status = response === "decline" ? "declined" : "accepted";
  let assignment;
  if (response === "accept") {
    await lockStaff(db, [candidate.staff_id]);
    const count = Number(
      (
        await db.query(
          "SELECT count(*) FROM assignments WHERE request_id=$1 AND status='confirmed'",
          [request.id],
        )
      ).rows[0].count,
    );
    if (request.status !== "open" || count >= request.headcount)
      reason = "request_closed";
    if (!reason) {
      try {
        await checkOverlap(
          db,
          { ...user, role: "admin" },
          candidate.staff_id,
          request.start_at,
          request.end_at,
        );
      } catch (error) {
        if (error.reason === "overlapping_shift") reason = "overlapping_shift";
        else throw error;
      }
    }
    if (reason) status = "too_late";
    else {
      let shift,
        originalStatus = null;
      if (request.open_shift_ids.length) {
        const open = (
          await db.query(
            "SELECT * FROM shifts WHERE id=ANY($1::uuid[]) AND staff_id IS NULL AND status IN ('draft','published') ORDER BY ctime,id LIMIT 1 FOR UPDATE",
            [request.open_shift_ids],
          )
        ).rows[0];
        if (!open) fail(409, "No open shift remains");
        originalStatus = open.status;
        shift = (
          await db.query(
            "UPDATE shifts SET staff_id=$2,status='confirmed',request_id=$3 WHERE id=$1 RETURNING *",
            [open.id, candidate.staff_id, request.id],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          user,
          "shift.filled",
          "shift",
          shift.id,
          open,
          shift,
          request.site_id,
        );
      } else {
        shift = (
          await db.query(
            "INSERT INTO shifts(site_id,staff_id,start_at,end_at,status,source,request_id) VALUES($1,$2,$3,$4,'confirmed','request',$5) RETURNING *",
            [
              request.site_id,
              candidate.staff_id,
              request.start_at,
              request.end_at,
              request.id,
            ],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          user,
          "shift.created",
          "shift",
          shift.id,
          null,
          shift,
          request.site_id,
        );
      }
      assignment = (
        await db.query(
          "INSERT INTO assignments(request_id,candidate_id,staff_id,shift_id,original_status) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            request.id,
            candidate.id,
            candidate.staff_id,
            shift.id,
            originalStatus,
          ],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        user,
        "assignment.created",
        "assignment",
        assignment.id,
        null,
        assignment,
        request.site_id,
      );
      if (count + 1 === request.headcount) {
        const row = (
          await db.query(
            "UPDATE requests SET status='filled' WHERE id=$1 RETURNING *",
            [request.id],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          user,
          "request.filled",
          "request",
          request.id,
          request,
          row,
          request.site_id,
        );
        await closeQueued(db, clock, user, row);
        request = row;
      }
    }
  }
  candidate = (
    await db.query(
      "UPDATE candidates SET status=$2,reason=$3,final_response=$4,response_at=$5 WHERE id=$1 RETURNING *",
      [candidate.id, status, reason, response, clock()],
    )
  ).rows[0];
  await audit(
    db,
    clock,
    user,
    `candidate.${status}`,
    "candidate",
    candidate.id,
    before,
    candidate,
    request.site_id,
  );
  if (status === "accepted")
    await followup(
      db,
      clock,
      request,
      candidate,
      "confirmation",
      `assignment:${assignment.id}:confirmation`,
    );
  if (status === "too_late")
    await followup(
      db,
      clock,
      request,
      candidate,
      "filled",
      `candidate:${candidate.id}:unavailable`,
    );
  return { candidate, assignment };
}
async function cancelAssignment(db, clock, user, request, assignment) {
  const obsolete = (
    await db.query(
      "UPDATE attempts SET status='cancelled',reason='assignment_cancelled' WHERE candidate_id=$1 AND purpose='confirmation' AND status='queued' RETURNING *",
      [assignment.candidate_id],
    )
  ).rows;
  for (const attempt of obsolete)
    await audit(
      db,
      clock,
      user,
      "attempt.cancelled",
      "attempt",
      attempt.id,
      null,
      attempt,
      request.site_id,
    );
  await lockStaff(db, [assignment.staff_id]);
  const before = (
    await db.query("SELECT * FROM shifts WHERE id=$1 FOR UPDATE", [
      assignment.shift_id,
    ])
  ).rows[0];
  const shift = assignment.original_status
    ? (
        await db.query(
          "UPDATE shifts SET staff_id=null,status=$2,request_id=null WHERE id=$1 RETURNING *",
          [before.id, assignment.original_status],
        )
      ).rows[0]
    : (
        await db.query(
          "UPDATE shifts SET status='cancelled' WHERE id=$1 RETURNING *",
          [before.id],
        )
      ).rows[0];
  const row = (
    await db.query(
      "UPDATE assignments SET status='cancelled' WHERE id=$1 RETURNING *",
      [assignment.id],
    )
  ).rows[0];
  await audit(
    db,
    clock,
    user,
    "assignment.cancelled",
    "assignment",
    row.id,
    assignment,
    row,
    request.site_id,
  );
  await audit(
    db,
    clock,
    user,
    assignment.original_status ? "shift.reopened" : "shift.cancelled",
    "shift",
    shift.id,
    before,
    shift,
    request.site_id,
  );
  await followup(
    db,
    clock,
    request,
    { id: assignment.candidate_id, staff_id: assignment.staff_id },
    "cancellation",
    `assignment:${assignment.id}:cancellation`,
  );
}
export async function detail(db, user, id) {
  const request = await requestAccess(db, user, id);
  const candidates = (
    await db.query(
      "SELECT c.*,s.name,s.mobile FROM candidates c JOIN staff s ON s.id=c.staff_id WHERE request_id=$1 AND c.selected ORDER BY c.ctime,c.id",
      [id],
    )
  ).rows;
  const attempts = (
    await db.query(
      "SELECT * FROM attempts WHERE request_id=$1 ORDER BY ctime,id",
      [id],
    )
  ).rows;
  const assignments = (
    await db.query("SELECT * FROM assignments WHERE request_id=$1", [id])
  ).rows;
  return {
    ...request,
    accepted: assignments.filter((x) => x.status === "confirmed").length,
    candidates: candidates.map((c) => ({
      ...c,
      attempts: attempts.filter((x) => x.candidate_id === c.id),
      assignment: assignments.find((x) => x.candidate_id === c.id) ?? null,
    })),
  };
}
export function registerDispatch(
  app,
  { pool, clock, validateChannels = null },
) {
  app.get("/api/requests", async (req, res) => {
    const { page, limit, offset } = pagination(req.query),
      values = [req.user.role, req.user.id];
    const where = [
      "($1='admin' OR EXISTS(SELECT 1 FROM site_managers m WHERE m.user_id=$2 AND m.site_id=r.site_id))",
    ];
    const bind = (x) => {
      values.push(x);
      return `$${values.length}`;
    };
    if (req.query.status) where.push(`r.status=${bind(req.query.status)}`);
    if (req.query.site) where.push(`r.site_id=${bind(req.query.site)}`);
    if (req.query.from)
      where.push(`r.start_at>=${bind(utc(req.query.from, "from"))}`);
    if (req.query.to) where.push(`r.start_at<${bind(utc(req.query.to, "to"))}`);
    const total = Number(
      (
        await pool.query(
          `SELECT count(*) FROM requests r WHERE ${where.join(" AND ")}`,
          values,
        )
      ).rows[0].count,
    );
    const { rows } = await pool.query(
      `SELECT r.*,s.name AS site_name,u.name AS created_by_name,(SELECT count(*)::integer FROM assignments a WHERE a.request_id=r.id AND a.status='confirmed') AS accepted FROM requests r JOIN sites s ON s.id=r.site_id JOIN users u ON u.id=r.created_by WHERE ${where.join(" AND ")} ORDER BY r.ctime DESC,r.id LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
      values,
    );
    res.json({ items: rows, total, page, limit });
  });
  app.post("/api/requests", async (req, res) => {
    const b = req.body ?? {},
      range = validateRange(b.start_at, b.end_at);
    if (new Date(range.start_at) <= clock())
      validation("start_at", "Must be in the future");
    if (!["broadcast", "direct"].includes(b.mode))
      validation("mode", "P0 supports broadcast and direct");
    const headcount = b.mode === "direct" ? 1 : b.headcount;
    if (!Number.isInteger(headcount) || headcount < 1 || headcount > 50)
      validation("headcount", "Must be 1 to 50");
    if (
      !Array.isArray(b.channels) ||
      !b.channels.length ||
      b.channels.some((x) => !["whatsapp", "voice"].includes(x))
    )
      validation("channels", "Select WhatsApp and/or voice");
    const deadline = utc(b.deadline_at ?? range.start_at, "deadline_at");
    if (deadline <= clock() || deadline > new Date(range.start_at))
      validation("deadline_at", "Must be after now and no later than start_at");
    if (
      b.message !== undefined &&
      (typeof b.message !== "string" || b.message.length > 500)
    )
      validation("message", "Maximum 500 characters");
    if (b.mode === "direct" && !z.uuid().safeParse(b.staff_id).success)
      validation("staff_id", "Direct requests require one staff ID");
    if (
      b.open_shift_ids !== undefined &&
      (!Array.isArray(b.open_shift_ids) ||
        !b.open_shift_ids.length ||
        b.open_shift_ids.some((x) => !z.uuid().safeParse(x).success))
    )
      validation("open_shift_ids", "Provide open shift IDs");
    const request = await mutate(pool, clock, async (db) => {
      const site = await siteAccess(db, req.user, b.site_id, 403, true);
      if (site.status !== "active") fail(409, "Site is inactive");
      const openIds = [...new Set(b.open_shift_ids ?? [])];
      let slots = headcount;
      if (openIds.length) {
        if (b.mode === "direct" && openIds.length !== 1)
          validation(
            "open_shift_ids",
            "Direct mode requires exactly one shift",
          );
        if (openIds.length > 50)
          validation("open_shift_ids", "Maximum 50 shifts");
        const shifts = (
          await db.query(
            "SELECT * FROM shifts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [openIds],
          )
        ).rows;
        if (
          shifts.length !== openIds.length ||
          shifts.some(
            (s) =>
              s.site_id !== site.id ||
              s.staff_id !== null ||
              !["draft", "published"].includes(s.status) ||
              s.start_at.toISOString() !== range.start_at ||
              s.end_at.toISOString() !== range.end_at,
          )
        )
          validation(
            "open_shift_ids",
            "Shifts must be open at the same site and time",
          );
        if (
          (
            await db.query(
              "SELECT 1 FROM requests WHERE status IN ('draft','open') AND open_shift_ids&&$1::uuid[]",
              [openIds],
            )
          ).rowCount
        )
          fail(409, "Shift is already being filled by a request");
        slots = openIds.length;
      }
      const row = (
        await db.query(
          "INSERT INTO requests(site_id,created_by,start_at,end_at,deadline_at,headcount,channels,mode,message,open_shift_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            site.id,
            req.user.id,
            range.start_at,
            range.end_at,
            deadline,
            slots,
            [...new Set(b.channels)],
            b.mode,
            b.message ?? "",
            openIds,
          ],
        )
      ).rows[0];
      const people =
        b.mode === "direct"
          ? (await db.query("SELECT * FROM staff WHERE id=$1", [b.staff_id]))
              .rows
          : (
              await db.query(
                "SELECT s.* FROM staff s JOIN site_staff l ON l.staff_id=s.id WHERE l.site_id=$1 AND l.active ORDER BY s.ctime,s.id",
                [site.id],
              )
            ).rows;
      if (b.mode === "direct" && !people.length) fail(404, "Staff not found");
      const excluded = [];
      for (const staff of people) {
        const reason = await eligible(db, row, staff);
        if (reason) {
          if (b.mode === "direct")
            fail(409, "Staff is not eligible", { reason });
          excluded.push({ staff_id: staff.id, name: staff.name, reason });
          continue;
        }
        const candidate = (
          await db.query(
            "INSERT INTO candidates(request_id,staff_id) VALUES($1,$2) RETURNING *",
            [row.id, staff.id],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          "candidate.created",
          "candidate",
          candidate.id,
          null,
          candidate,
          site.id,
        );
      }
      await db.query("UPDATE requests SET excluded=$2 WHERE id=$1", [
        row.id,
        JSON.stringify(excluded),
      ]);
      row.excluded = excluded;
      await audit(
        db,
        clock,
        req.user,
        "request.created",
        "request",
        row.id,
        null,
        row,
        site.id,
      );
      return row;
    });
    res.status(201).json(await detail(pool, req.user, request.id));
  });
  app.get("/api/requests/:id", async (req, res) =>
    res.json(await detail(pool, req.user, req.params.id)),
  );
  app.patch("/api/requests/:id", async (req, res) => {
    await requestAccess(pool, req.user, req.params.id);
    fail(
      409,
      "Request details cannot be edited; cancel and create a new request",
    );
  });
  app.post("/api/requests/:id/candidates", async (req, res) => {
    await mutate(pool, clock, async (db) => {
      const request = await requestAccess(
        db,
        req.user,
        req.params.id,
        403,
        true,
      );
      if (request.status !== "draft")
        fail(409, "Only draft candidates can be edited");
      const staff = (
        await db.query("SELECT * FROM staff WHERE id=$1", [req.body.staff_id])
      ).rows[0];
      if (!staff) fail(404, "Staff not found");
      const reason = await eligible(db, request, staff);
      if (reason) fail(409, "Staff is not eligible", { reason });
      if (
        request.mode === "direct" &&
        (
          await db.query(
            "SELECT 1 FROM candidates WHERE request_id=$1 AND selected AND staff_id<>$2",
            [request.id, staff.id],
          )
        ).rowCount
      )
        fail(409, "Direct requests can have only one candidate");
      const row = (
        await db.query(
          "INSERT INTO candidates(request_id,staff_id) VALUES($1,$2) ON CONFLICT(request_id,staff_id) DO UPDATE SET selected=true RETURNING *",
          [request.id, staff.id],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "candidate.selected",
        "candidate",
        row.id,
        null,
        row,
        request.site_id,
      );
    });
    res.json(await detail(pool, req.user, req.params.id));
  });
  app.delete("/api/requests/:id/candidates/:candidateId", async (req, res) => {
    await mutate(pool, clock, async (db) => {
      const request = await requestAccess(
        db,
        req.user,
        req.params.id,
        403,
        true,
      );
      if (request.status !== "draft")
        fail(409, "Only draft candidates can be edited");
      const before = (
        await db.query(
          "SELECT * FROM candidates WHERE id=$1 AND request_id=$2",
          [req.params.candidateId, request.id],
        )
      ).rows[0];
      if (!before) fail(404, "Candidate not found");
      const row = (
        await db.query(
          "UPDATE candidates SET selected=false WHERE id=$1 RETURNING *",
          [before.id],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "candidate.removed",
        "candidate",
        row.id,
        before,
        row,
        request.site_id,
      );
    });
    res.json(await detail(pool, req.user, req.params.id));
  });
  app.post("/api/requests/:id/send", async (req, res) => {
    await mutate(pool, clock, async (db) => {
      const before = await requestAccess(
        db,
        req.user,
        req.params.id,
        403,
        true,
      );
      if (before.status !== "draft") fail(409, "Only a draft can be sent");
      if (new Date(before.start_at) <= clock())
        fail(409, "Start time has passed");
      if (new Date(before.deadline_at) <= clock())
        fail(409, "Deadline has passed");
      const site = await siteAccess(db, req.user, before.site_id, 403, true);
      if (site.status !== "active") fail(409, "Site is inactive");
      if (before.open_shift_ids.length) {
        const shifts = (
          await db.query(
            "SELECT * FROM shifts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [before.open_shift_ids],
          )
        ).rows;
        if (
          shifts.length !== before.open_shift_ids.length ||
          shifts.some(
            (s) =>
              s.staff_id !== null ||
              !["draft", "published"].includes(s.status) ||
              s.site_id !== before.site_id ||
              +new Date(s.start_at) !== +new Date(before.start_at) ||
              +new Date(s.end_at) !== +new Date(before.end_at),
          )
        )
          fail(409, "Open shifts changed; cancel and rebuild the draft");
      }
      const candidates = (
        await db.query(
          "SELECT c.*,to_jsonb(s) AS staff FROM candidates c JOIN staff s ON s.id=c.staff_id WHERE request_id=$1 AND c.selected",
          [before.id],
        )
      ).rows;
      if (!candidates.length) fail(409, "No candidates");
      if (validateChannels) await validateChannels(db, before, candidates);
      const row = (
        await db.query(
          "UPDATE requests SET status='open' WHERE id=$1 RETURNING *",
          [before.id],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "request.sent",
        "request",
        row.id,
        before,
        row,
        row.site_id,
      );
      for (const c of candidates) {
        const reason = await eligible(db, row, c.staff);
        const status = reason ? "skipped" : "contacting";
        const updated = (
          await db.query(
            "UPDATE candidates SET status=$2,reason=$3 WHERE id=$1 RETURNING *",
            [
              c.id,
              status,
              reason === "not_active" ? "staff_not_active" : reason,
            ],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          `candidate.${status}`,
          "candidate",
          c.id,
          c,
          updated,
          row.site_id,
        );
        if (reason) continue;
        for (const channel of row.channels.filter((x) =>
          contactable(c.staff).includes(x),
        ))
          await queueAttempt(db, clock, {
            candidateId: c.id,
            requestId: row.id,
            siteId: row.site_id,
            staffId: c.staff_id,
            language: c.staff.language,
            channel,
            purpose: "offer",
            key: `candidate:${c.id}:${channel}:offer`,
          });
      }
      await enqueueJob(
        db,
        clock,
        "request-deadline",
        { request_id: row.id },
        `deadline:${row.id}`,
        row.deadline_at,
      );
    });
    res.json(await detail(pool, req.user, req.params.id));
  });
  app.post("/api/requests/:id/cancel", async (req, res) => {
    await mutate(pool, clock, async (db) => {
      const before = await requestAccess(
        db,
        req.user,
        req.params.id,
        403,
        true,
      );
      if (["expired", "cancelled"].includes(before.status))
        fail(409, "Request is final");
      const assignments = (
        await db.query(
          "SELECT * FROM assignments WHERE request_id=$1 AND status='confirmed' ORDER BY staff_id",
          [before.id],
        )
      ).rows;
      await closeQueued(db, clock, req.user, before, true);
      for (const a of assignments)
        await cancelAssignment(db, clock, req.user, before, a);
      const row = (
        await db.query(
          "UPDATE requests SET status='cancelled' WHERE id=$1 RETURNING *",
          [before.id],
        )
      ).rows[0];
      await closeQueued(db, clock, req.user, row);
      await audit(
        db,
        clock,
        req.user,
        "request.cancelled",
        "request",
        row.id,
        before,
        row,
        row.site_id,
      );
    });
    res.json(await detail(pool, req.user, req.params.id));
  });
  app.post(
    "/api/requests/:id/candidates/:candidateId/confirm",
    async (req, res) => {
      await mutate(pool, clock, async (db) => {
        const request = await requestAccess(
          db,
          req.user,
          req.params.id,
          403,
          true,
        );
        if (
          request.status !== "open" ||
          new Date(request.deadline_at) <= clock()
        )
          fail(409, "Request is full or closed");
        const candidate = (
          await db.query(
            "SELECT * FROM candidates WHERE id=$1 AND request_id=$2",
            [req.params.candidateId, request.id],
          )
        ).rows[0];
        if (!candidate) fail(404, "Candidate not found");
        if (candidate.status !== "contacting")
          fail(409, "Only contacting candidates can be confirmed");
        await lockStaff(db, [candidate.staff_id]);
        await checkOverlap(
          db,
          req.user,
          candidate.staff_id,
          request.start_at,
          request.end_at,
        );
        await respond(db, clock, req.user, candidate.id, "accept");
      });
      res.json(await detail(pool, req.user, req.params.id));
    },
  );
  app.post(
    "/api/requests/:id/candidates/:candidateId/remove",
    async (req, res) => {
      await mutate(pool, clock, async (db) => {
        const request = await requestAccess(
          db,
          req.user,
          req.params.id,
          403,
          true,
        );
        if (!["open", "filled"].includes(request.status))
          fail(409, "Request is final");
        const assignment = (
          await db.query(
            "SELECT * FROM assignments WHERE request_id=$1 AND candidate_id=$2 AND status='confirmed'",
            [request.id, req.params.candidateId],
          )
        ).rows[0];
        if (!assignment) fail(404, "Assignment not found");
        await cancelAssignment(db, clock, req.user, request, assignment);
        const row = (
          await db.query(
            "UPDATE requests SET status=$2 WHERE id=$1 RETURNING *",
            [
              request.id,
              new Date(request.deadline_at) > clock() ? "open" : "expired",
            ],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          "request.slot_reopened",
          "request",
          row.id,
          request,
          row,
          row.site_id,
        );
      });
      res.json(await detail(pool, req.user, req.params.id));
    },
  );
}
