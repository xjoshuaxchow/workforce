import { buildVoiceContent } from "./voice-content.js";
import { recordedVoice } from "./voice-clip-service.js";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { fail, mapResponse, validation } from "./domain.js";
import { mutate, audit, siteAccess } from "./service.js";
import {
  respond,
  requestAccess,
  enqueueJob,
  eligible,
  expireRequest,
} from "./dispatch.js";
import {
  configureMock,
  resetMock,
  mockCalls,
  deliverMock,
} from "./mock-transport.js";

const system = { actor_type: "system", id: null, role: "admin" };
export function signEvent(secret, timestamp, raw) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
}
export async function processEvent(pool, clock, eventId) {
  return mutate(pool, clock, async (db) => {
    const event = (
      await db.query(
        "SELECT * FROM message_events WHERE event_id=$1 FOR UPDATE",
        [eventId],
      )
    ).rows[0];
    if (!event || event.processed) return;
    const payload = event.payload;
    let attempt = (
      await db.query("SELECT * FROM attempts WHERE id::text=$1", [
        event.correlation_id,
      ])
    ).rows[0];
    if (attempt) {
      if (attempt.request_id)
        await requestAccess(db, system, attempt.request_id, 404, true);
      attempt = (
        await db.query("SELECT * FROM attempts WHERE id=$1 FOR UPDATE", [
          attempt.id,
        ])
      ).rows[0];
      let status = attempt.status,
        response = null;
      const mapped = mapResponse(payload.option_id);
      if (
        payload.type === "reply" &&
        mapped &&
        !attempt.response &&
        attempt.purpose === "offer" &&
        attempt.status !== "failed"
      ) {
        status = "replied";
        response = mapped;
      } else if (!["failed", "replied", "cancelled"].includes(status)) {
        const order = {
          submitting: -1,
          submission_unknown: 0,
          queued: 0,
          sent: 1,
          delivered: 2,
          read: 3,
          answered: 2,
          no_answer: 3,
          busy: 3,
          no_input: 3,
          replied: 4,
          failed: 4,
          cancelled: 4,
          completed: 4,
        };
        const next =
          payload.type === "completed" && attempt.purpose === "offer"
            ? "no_input"
            : payload.type;
        if (
          next === "submission_unknown" &&
          ["queued", "submitting", "sent"].includes(status)
        )
          status = next;
        else if (next in order && order[next] >= order[status]) status = next;
      }
      if (status !== attempt.status || response) {
        const updated = (
          await db.query(
            "UPDATE attempts SET status=$2,response=coalesce(response,$3),reason=coalesce($4,reason),response_at=coalesce(response_at,$5) WHERE id=$1 RETURNING *",
            [
              attempt.id,
              status,
              response,
              payload.reason ?? null,
              response ? event.received_at : null,
            ],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          system,
          "attempt.updated",
          "attempt",
          updated.id,
          attempt,
          updated,
          attempt.site_id,
        );
      }
      if (response)
        await respond(
          db,
          clock,
          { actor_type: "staff", id: attempt.staff_id, role: "admin" },
          attempt.candidate_id,
          response,
        );
      else if (status === "failed" && attempt.purpose === "offer") {
        const unfinished = (
          await db.query(
            "SELECT 1 FROM attempts WHERE candidate_id=$1 AND purpose='offer' AND status<>'failed'",
            [attempt.candidate_id],
          )
        ).rowCount;
        if (!unfinished) {
          const c = (
            await db.query(
              "UPDATE candidates SET status='failed' WHERE id=$1 AND final_response IS NULL RETURNING *",
              [attempt.candidate_id],
            )
          ).rows[0];
          if (c)
            await audit(
              db,
              clock,
              system,
              "candidate.failed",
              "candidate",
              c.id,
              null,
              c,
              attempt.site_id,
            );
        }
      }
    }
    await db.query("UPDATE message_events SET processed=true WHERE id=$1", [
      event.id,
    ]);
    await db.query("UPDATE jobs SET status='done' WHERE dedupe_key=$1", [
      `event:${eventId}`,
    ]);
  });
}
export async function receiveEvent(pool, clock, payload, raw) {
  if (
    typeof payload?.event_id !== "string" ||
    !payload.event_id ||
    typeof payload.type !== "string" ||
    typeof payload.correlation_id !== "string"
  )
    validation("event", "event_id, correlation_id and type are required");
  await mutate(pool, clock, async (db) => {
    await db.query(
      "INSERT INTO message_deliveries(event_id,raw_body,received_at) VALUES($1,$2,$3)",
      [payload.event_id, raw, clock()],
    );
    const inserted = await db.query(
      "INSERT INTO message_events(event_id,correlation_id,payload,received_at) VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING RETURNING id",
      [payload.event_id, payload.correlation_id, payload, clock()],
    );
    if (inserted.rowCount)
      await enqueueJob(
        db,
        clock,
        "process-event",
        { event_id: payload.event_id },
        `event:${payload.event_id}`,
      );
  });
  try {
    await processEvent(pool, clock, payload.event_id);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "message.processing_deferred",
        event_id: payload.event_id,
        message: error.message,
      }),
    );
  }
}
function localTimes(request, site) {
  const start = new Date(request.start_at),
    end = new Date(request.end_at),
    zone = site.timezone;
  const day = (value) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  return {
    date: new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(start),
    start_time: new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(start),
    end_time:
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(end) + (day(start) !== day(end) ? " (+1 day)" : ""),

  };
}
export function buildPayload(attempt, staff, site, request, voiceTexts) {
  const t = localTimes(request, site),
    variables = {
      staff_name: staff.name,
      site_name: site.name,
      site_address: site.address,
      date: t.date,
      start_time: t.start_time,
      end_time: t.end_time,
      message: request.message ?? "",
    };
  const offer = attempt.purpose === "offer";
  const templates = {
    offer: "shift_offer_v1",
    confirmation: "shift_confirmed_v1",
    filled: "shift_unavailable_v1",
    cancellation: "shift_cancelled_v1",
    roster_publish: "roster_published_v1",
    roster_change: "roster_changed_v1",
  };
  const payload = {
    correlation_id: attempt.id,
    channel: attempt.channel,
    to: staff.mobile,
    language: staff.language,
    template: templates[attempt.purpose],
    variables,
  };
  if (attempt.purpose === "roster_publish")
    payload.variables.shifts = attempt.payload.shifts
      .map((s) => {
        const times = localTimes(s, site);
        return `${times.date} ${times.start_time}–${times.end_time}`;
      })
      .join("\n");
  if (attempt.purpose === "roster_change") {
    const previous = localTimes(attempt.payload.old, site);
    payload.variables.old_date = previous.date;
    payload.variables.old_start_time = previous.start_time;
    payload.variables.old_end_time = previous.end_time;
    payload.variables.change = attempt.payload.change;
  }
  if (offer)
    payload.options =
      attempt.channel === "voice"
        ? [
            { id: "ACCEPT", dtmf: "1" },
            { id: "DECLINE", dtmf: "2" },
          ]
        : [
            { id: "ACCEPT", label: "Yes" },
            { id: "DECLINE", label: "No" },
          ];
  if (attempt.channel === "voice")
    payload.voice = buildVoiceContent(attempt.purpose, staff, site, request, voiceTexts);
  return payload;
}
export async function prepareAttempt(
  db,
  clock,
  id,
  { allowedStatuses = ["queued"], voiceTexts, voiceClips, publicBaseUrl, settingsVersion } = {},
) {
  const initial = (await db.query("SELECT * FROM attempts WHERE id=$1", [id]))
    .rows[0];
  if (!initial || !allowedStatuses.includes(initial.status)) return;
  let request = initial.request_id
    ? await requestAccess(db, system, initial.request_id, 404, true)
    : null;
  if (request?.status === "open" && new Date(request.deadline_at) <= clock())
    request = await expireRequest(db, clock, request.id);
  const attempt = (
    await db.query("SELECT * FROM attempts WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (!allowedStatuses.includes(attempt.status)) return;
  const staff = (
    await db.query("SELECT * FROM staff WHERE id=$1", [attempt.staff_id])
  ).rows[0];
  if (
    attempt.channel === "whatsapp" &&
    !contactableOn(staff, "whatsapp") &&
    attempt.purpose !== "offer"
  ) {
    const row = (
      await db.query(
        "UPDATE attempts SET status='cancelled',reason='not_contactable' WHERE id=$1 RETURNING *",
        [attempt.id],
      )
    ).rows[0];
    await audit(
      db,
      clock,
      system,
      "attempt.cancelled",
      "attempt",
      row.id,
      attempt,
      row,
      attempt.site_id,
    );
    return;
  }
  if (
    attempt.purpose === "confirmation" &&
    !(
      await db.query(
        "SELECT 1 FROM assignments WHERE candidate_id=$1 AND status='confirmed'",
        [attempt.candidate_id],
      )
    ).rowCount
  ) {
    const row = (
      await db.query(
        "UPDATE attempts SET status='cancelled',reason='assignment_cancelled' WHERE id=$1 RETURNING *",
        [attempt.id],
      )
    ).rows[0];
    await audit(
      db,
      clock,
      system,
      "attempt.cancelled",
      "attempt",
      row.id,
      attempt,
      row,
      attempt.site_id,
    );
    return;
  }
  if (attempt.purpose === "offer") {
    const reason =
      request.status !== "open"
        ? "request_closed"
        : await eligible(db, request, staff);
    if (reason || !contactableOn(staff, attempt.channel)) {
      const updated = (
        await db.query(
          "UPDATE attempts SET status='cancelled',reason=$2 WHERE id=$1 RETURNING *",
          [id, reason ?? "not_contactable"],
        )
      ).rows[0];
      const candidate = (
        await db.query(
          "UPDATE candidates SET status='skipped',reason=$2 WHERE id=$1 AND final_response IS NULL RETURNING *",
          [
            attempt.candidate_id,
            reason === "not_active"
              ? "staff_not_active"
              : (reason ?? "not_contactable"),
          ],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        system,
        "attempt.cancelled",
        "attempt",
        id,
        attempt,
        updated,
        attempt.site_id,
      );
      if (candidate)
        await audit(
          db,
          clock,
          system,
          "candidate.skipped",
          "candidate",
          candidate.id,
          null,
          candidate,
          attempt.site_id,
        );
      return;
    }
  }
  const site = (
    await db.query("SELECT * FROM sites WHERE id=$1", [attempt.site_id])
  ).rows[0];
  const payload = buildPayload(
    attempt,
    { ...staff, language: attempt.language_snapshot ?? staff.language },
    site,
    request ?? attempt.payload,
    voiceTexts,
  );
  if (attempt.channel === "voice" && voiceClips && voiceClips.mode !== "say")
    payload.voice = await recordedVoice(db, { voiceClips, voice: { publicBaseUrl } }, attempt.purpose, attempt.language_snapshot ?? staff.language, site, request, settingsVersion);
  return { attempt, payload };
}
export async function sendMock(pool, clock, id, voiceTexts, voiceOptions = {}) {
  await mutate(pool, clock, async (db) => {
    const ready = await prepareAttempt(db, clock, id, { voiceTexts, ...voiceOptions });
    if (!ready) return;
    const { attempt, payload } = ready;
    const sent = deliverMock(pool, payload);
    const row = (
      await db.query(
        "UPDATE attempts SET status='sent',external_id=$2,payload=$3 WHERE id=$1 RETURNING *",
        [id, sent.external_id, payload],
      )
    ).rows[0];
    await audit(
      db,
      clock,
      system,
      "attempt.sent",
      "attempt",
      id,
      attempt,
      row,
      attempt.site_id,
    );
  });
}
const contactableOn = (staff, channel) =>
  staff.status === "active" && (channel === "voice" || staff.whatsapp_opt_in);
export async function runJobs(
  pool,
  clock,
  { pstn = null, whatsapp = null } = {},
) {
  if (whatsapp) await whatsapp.poll();
  if (pstn) await pstn.reconcile();
  let processed = 0;
  for (let i = 0; i < 100; i++) {
    const job = await mutate(pool, clock, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM jobs WHERE (status='queued' AND run_at<=$1) OR (status='running' AND locked_at< $1::timestamptz-interval '30 seconds') ORDER BY run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [clock()],
        )
      ).rows[0];
      if (!row) return null;
      return (
        await db.query(
          "UPDATE jobs SET status='running',tries=tries+1,locked_at=$2 WHERE id=$1 RETURNING *",
          [row.id, clock()],
        )
      ).rows[0];
    });
    if (!job) break;
    try {
      if (job.kind === "send-attempt") {
        const attempt = (
          await pool.query("SELECT channel FROM attempts WHERE id=$1", [
            job.payload.attempt_id,
          ])
        ).rows[0];
        const result =
          pstn && attempt?.channel === "voice"
            ? await pstn.sendAttempt(job.payload.attempt_id)
            : whatsapp && attempt?.channel === "whatsapp"
              ? await whatsapp.sendAttempt(job.payload.attempt_id)
              : await sendMock(pool, clock, job.payload.attempt_id);
        if (result?.deferUntil) {
          await pool.query(
            "UPDATE jobs SET status='queued',run_at=$2,tries=greatest(tries-1,0) WHERE id=$1",
            [job.id, result.deferUntil],
          );
          continue;
        }
      } else if (job.kind === "request-deadline")
        await mutate(pool, clock, (db) =>
          expireRequest(db, clock, job.payload.request_id),
        );
      else if (job.kind === "process-event")
        await processEvent(pool, clock, job.payload.event_id);
      else throw Error(`Unknown job kind: ${job.kind}`);
      await mutate(pool, clock, (db) =>
        db.query("UPDATE jobs SET status='done' WHERE id=$1", [job.id]),
      );
      processed++;
    } catch (error) {
      const retry = error.retryable !== false && job.tries <= 3,
        delay = [5000, 30000, 120000][job.tries - 1] ?? 120000;
      await mutate(pool, clock, async (db) => {
        await db.query(
          "UPDATE jobs SET status=$2,run_at=$3,last_error=$4 WHERE id=$1",
          [
            job.id,
            retry ? "queued" : "failed",
            new Date(clock().getTime() + delay),
            error.message,
          ],
        );
        if (!retry && job.kind === "send-attempt") {
          const initial = (
            await db.query("SELECT * FROM attempts WHERE id=$1", [
              job.payload.attempt_id,
            ])
          ).rows[0];
          if (initial?.request_id)
            await requestAccess(db, system, initial.request_id, 404, true);
          const row = (
            await db.query(
              "UPDATE attempts SET status='failed',reason=$2 WHERE id=$1 AND status='queued' RETURNING *",
              [job.payload.attempt_id, error.code ?? "send_failed"],
            )
          ).rows[0];
          if (row) {
            await audit(
              db,
              clock,
              system,
              "attempt.failed",
              "attempt",
              row.id,
              initial,
              row,
              row.site_id,
            );
            if (
              row.purpose === "offer" &&
              !(
                await db.query(
                  "SELECT 1 FROM attempts WHERE candidate_id=$1 AND purpose='offer' AND status<>'failed'",
                  [row.candidate_id],
                )
              ).rowCount
            ) {
              const c = (
                await db.query(
                  "UPDATE candidates SET status='failed' WHERE id=$1 AND status='contacting' AND final_response IS NULL RETURNING *",
                  [row.candidate_id],
                )
              ).rows[0];
              if (c)
                await audit(
                  db,
                  clock,
                  system,
                  "candidate.failed",
                  "candidate",
                  c.id,
                  null,
                  c,
                  row.site_id,
                );
            }
          }
        }
      });
    }
  }
  return { processed };
}
export function registerMessaging(
  app,
  { pool, clock, messagingMode = "mock", messagingSecret },
) {
  app.post("/integrations/messaging/events", async (req, res) => {
    const timestamp = req.get("X-Timestamp"),
      signature = req.get("X-Signature");
    const valid =
      messagingSecret &&
      timestamp &&
      /^\d+$/.test(timestamp) &&
      Math.abs(Number(timestamp) * 1000 - clock().getTime()) <= 300000 &&
      signature &&
      /^[a-f0-9]{64}$/i.test(signature) &&
      timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(
          signEvent(messagingSecret, timestamp, req.rawBody ?? Buffer.alloc(0)),
          "hex",
        ),
      );
    if (!valid) {
      console.warn(
        JSON.stringify({ level: "warn", event: "messaging.invalid_signature" }),
      );
      fail(401, "Invalid message signature");
    }
    await receiveEvent(pool, clock, req.body, req.rawBody.toString("utf8"));
    res.json({ ok: true });
  });
  if (messagingMode === "mock" && process.env.NODE_ENV !== "production") {
    app.post("/api/mock/config", (req, res) => {
      if (req.user.role !== "admin") fail(403, "Administrator required");
      const outcomes = req.body?.outcomes;
      if (
        !Array.isArray(outcomes) ||
        outcomes.length > 100 ||
        outcomes.some((x) => ![202, 400, 503, "timeout"].includes(x))
      )
        validation("outcomes", "Use an array of 202, 400, 503 or timeout");
      configureMock(pool, outcomes);
      res.json({ ok: true });
    });
    app.post("/api/mock/reset", (req, res) => {
      if (req.user.role !== "admin") fail(403, "Administrator required");
      resetMock(pool);
      res.json({ ok: true });
    });
    app.get("/api/mock/sent", (req, res) => {
      if (req.user.role !== "admin") fail(403, "Administrator required");
      res.json({ items: mockCalls(pool) });
    });
    app.post("/api/mock/attempts/:id/events", async (req, res) => {
      const attempt = (
        await pool.query("SELECT * FROM attempts WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!attempt) fail(404, "Attempt not found");
      await siteAccess(pool, req.user, attempt.site_id);
      const payload = {
        event_id: randomUUID(),
        correlation_id: attempt.id,
        external_id: attempt.external_id,
        type: req.body.type,
        option_id: req.body.option_id ?? null,
        reason: req.body.reason ?? null,
        occurred_at: clock().toISOString(),
      };
      await receiveEvent(pool, clock, payload, JSON.stringify(payload));
      res.json({ ok: true });
    });
    app.post("/api/mock/run-jobs", async (req, res) => {
      if (req.user.role !== "admin") fail(403, "Administrator required");
      res.json(await runJobs(pool, clock));
    });
  }
}
