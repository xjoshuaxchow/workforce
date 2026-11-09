import express from "express";
import { z } from "zod";
import { mutate, audit } from "./service.js";
import { fail, validation } from "./domain.js";
import { requestAccess } from "./dispatch.js";
import { prepareAttempt, receiveEvent } from "./messaging.js";
import {
  createPstnGateway,
  mapDigits,
  mapTwilioStatus,
  validateTwilioWebhook,
  voiceTwiml,
  voiceMessage,
} from "./twilio-pstn.js";

const system = { role: "admin", actor_type: "system", id: null };
const terminal = new Set([
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);
const rank = {
  queued: 0,
  initiated: 1,
  ringing: 2,
  "in-progress": 3,
  completed: 4,
  busy: 4,
  "no-answer": 4,
  failed: 4,
  canceled: 4,
};

export function createPstnAdapter({
  pool,
  config,
  client,
  clock = () => new Date(),
}) {
  const gateway = createPstnGateway(config, client);
  async function lockCall(db, id) {
    const meta = (
      await db.query("SELECT request_id FROM attempts WHERE id=$1", [id])
    ).rows[0];
    if (!meta) return null;
    if (meta.request_id)
      await requestAccess(db, system, meta.request_id, 404, true);
    const attempt = (
      await db.query("SELECT * FROM attempts WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    const call = (
      await db.query(
        "SELECT * FROM voice_calls WHERE attempt_id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    return { attempt, call };
  }
  async function changeAttempt(
    db,
    before,
    status,
    reason = before.reason,
    externalId = before.external_id,
    payload = before.payload,
  ) {
    const row = (
      await db.query(
        "UPDATE attempts SET status=$2,reason=$3,external_id=$4,payload=$5 WHERE id=$1 RETURNING *",
        [before.id, status, reason, externalId, payload],
      )
    ).rows[0];
    await audit(
      db,
      clock,
      system,
      "attempt.updated",
      "attempt",
      row.id,
      before,
      row,
      row.site_id,
    );
    return row;
  }
  async function bindCall(id, params, statusHint) {
    return mutate(pool, clock, async (db) => {
      const locked = await lockCall(db, id);
      if (!locked?.call) return null;
      const { attempt, call } = locked;
      if (call.call_sid && call.call_sid !== params.CallSid)
        fail(409, "Call SID does not match this attempt");
      if (params.From !== call.from_number || params.To !== call.to_number)
        fail(409, "Call endpoints do not match this attempt");
      const rawSequence = params.SequenceNumber;
      if (rawSequence !== undefined && !/^\d+$/.test(rawSequence))
        validation("SequenceNumber", "Invalid call sequence");
      const sequence = rawSequence === undefined ? null : Number(rawSequence);
      if (sequence !== null && !Number.isSafeInteger(sequence))
        validation("SequenceNumber", "Invalid call sequence");
      const status = params.CallStatus ?? statusHint;
      const advances =
        status in rank &&
        !terminal.has(call.last_status) &&
        (sequence === null || sequence >= Number(call.last_sequence)) &&
        rank[status] >= (rank[call.last_status] ?? -1);
      const nextStatus = advances ? status : call.last_status;
      const nextState = terminal.has(nextStatus)
        ? nextStatus === "canceled"
          ? "cancelled"
          : "finished"
        : ["reserved", "submitting", "unknown"].includes(call.state)
          ? "submitted"
          : call.state;
      const row = (
        await db.query(
          "UPDATE voice_calls SET call_sid=$2,state=$3,last_status=$4,last_sequence=$5,last_error=NULL WHERE attempt_id=$1 RETURNING *",
          [
            id,
            params.CallSid,
            nextState,
            nextStatus,
            advances && sequence !== null ? sequence : call.last_sequence,
          ],
        )
      ).rows[0];
      let updated = attempt;
      if (
        attempt.external_id !== params.CallSid ||
        ["queued", "submitting", "submission_unknown"].includes(attempt.status)
      ) {
        updated = await changeAttempt(
          db,
          attempt,
          ["queued", "submitting", "submission_unknown"].includes(
            attempt.status,
          )
            ? "sent"
            : attempt.status,
          null,
          params.CallSid,
        );
      }
      return { attempt: updated, call: row, advances };
    });
  }
  async function unknownSubmission(id, code) {
    return mutate(pool, clock, async (db) => {
      const locked = await lockCall(db, id);
      if (!locked?.call || locked.call.call_sid) return;
      await db.query(
        "UPDATE voice_calls SET state='unknown',last_error=$2 WHERE attempt_id=$1",
        [id, code],
      );
      if (["queued", "submitting"].includes(locked.attempt.status))
        await changeAttempt(
          db,
          locked.attempt,
          "submission_unknown",
          "twilio_submission_unknown",
        );
    });
  }
  async function awaitOfferEnd(id) {
    const current = (
      await pool.query(
        "SELECT candidate_id,purpose FROM attempts WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (
      !current?.candidate_id ||
      !["confirmation", "filled", "cancellation"].includes(current.purpose)
    )
      return false;
    const prior = (
      await pool.query(
        "SELECT v.* FROM voice_calls v JOIN attempts a ON a.id=v.attempt_id WHERE a.candidate_id=$1 AND a.purpose='offer' AND v.state NOT IN ('cancelled','finished','rejected')",
        [current.candidate_id],
      )
    ).rows;
    for (const call of prior) {
      if (!call.call_sid) return true;
      try {
        const live = await gateway.fetchCall(call.call_sid);
        await bindCall(call.attempt_id, {
          AccountSid: config.accountSid,
          CallSid: call.call_sid,
          From: call.from_number,
          To: call.to_number,
          CallStatus: live.status,
        });
        if (!terminal.has(live.status)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
  async function sendAttempt(id) {
    if (await awaitOfferEnd(id))
      return { deferUntil: new Date(+clock() + 2000) };
    const prepared = await mutate(pool, clock, async (db) => {
      const previous = (
        await db.query("SELECT * FROM voice_calls WHERE attempt_id=$1", [id])
      ).rows[0];
      if (previous && previous.state !== "reserved") {
        if (
          previous.state === "submitting" &&
          !previous.call_sid &&
          +clock() - new Date(previous.submission_started_at).getTime() < 30000
        )
          return {
            deferUntil: new Date(
              new Date(previous.submission_started_at).getTime() + 30000,
            ),
          };
        if (
          previous.state === "submitting" &&
          +clock() - new Date(previous.submission_started_at).getTime() >= 30000
        ) {
          const locked = await lockCall(db, id);
          if (locked?.call.state === "submitting" && !locked.call.call_sid) {
            await db.query(
              "UPDATE voice_calls SET state='unknown',last_error='submission_interrupted' WHERE attempt_id=$1",
              [id],
            );
            if (locked.attempt.status === "submitting")
              await changeAttempt(
                db,
                locked.attempt,
                "submission_unknown",
                "twilio_submission_unknown",
              );
          }
        }
        return null;
      }
      const ready = await prepareAttempt(db, clock, id, { voiceTexts: config.voiceTexts, voiceClips: config.voiceClips, publicBaseUrl: config.publicBaseUrl, settingsVersion: config.settingsVersion });
      if (!ready) return null;
      const inserted = await db.query(
        "INSERT INTO voice_calls(attempt_id,state,from_number,to_number,payload,submission_started_at,settings_version_id) VALUES($1,'submitting',$2,$3,$4,$5,$6) ON CONFLICT(attempt_id) DO UPDATE SET state='submitting',submission_started_at=$5,payload=$4,from_number=$2,to_number=$3,last_error=NULL WHERE voice_calls.state='reserved' RETURNING *",
        [
          id,
          config.fromNumber,
          ready.payload.to,
          ready.payload,
          clock(),
          config.settingsVersion ?? null,
        ],
      );
      if (!inserted.rowCount) return null;
      await changeAttempt(
        db,
        ready.attempt,
        "submitting",
        null,
        null,
        ready.payload,
      );
      return ready.payload;
    });
    if (!prepared) return;
    if (prepared.deferUntil) return prepared;
    let call;
    try {
      call = await gateway.createCall(prepared);
    } catch (error) {
      const status = Number(error.status);
      if (status >= 400 && status < 500) {
        const retry = status === 429;
        await mutate(pool, clock, async (db) => {
          const locked = await lockCall(db, id);
          if (!locked?.call || locked.call.call_sid) return;
          await db.query(
            "UPDATE voice_calls SET state=$2,last_error=$3 WHERE attempt_id=$1",
            [id, retry ? "reserved" : "rejected", "HTTP_" + status],
          );
          if (locked.attempt.status === "submitting")
            await changeAttempt(
              db,
              locked.attempt,
              "queued",
              "twilio_HTTP_" + status,
            );
        });
        error.retryable = retry;
        throw error;
      }
      await unknownSubmission(id, error.code ?? "submission_uncertain");
      return;
    }
    // Local persistence errors must never be mistaken for a provider rejection.
    await bindCall(id, {
      AccountSid: config.accountSid,
      CallSid: call.sid,
      From: config.fromNumber,
      To: prepared.to,
      CallStatus: call.status,
    });
    await reconcile();
  }
  async function reconcile() {
    const rows = (
      await pool.query(
        `SELECT v.*,a.purpose,a.status AS attempt_status FROM voice_calls v JOIN attempts a ON a.id=v.attempt_id LEFT JOIN requests r ON r.id=a.request_id LEFT JOIN candidates c ON c.id=a.candidate_id WHERE v.state IN ('submitting','submitted','unknown') AND (v.next_cancel_at IS NULL OR v.next_cancel_at<=$1) AND (v.cancel_requested=false OR v.call_sid IS NOT NULL) AND (a.status='cancelled' OR (a.purpose='offer' AND (r.status<>'open' OR c.final_response IS NOT NULL)) OR (a.purpose='confirmation' AND NOT EXISTS(SELECT 1 FROM assignments x WHERE x.candidate_id=a.candidate_id AND x.status='confirmed'))) AND NOT (a.purpose='offer' AND coalesce(v.last_status,'')='in-progress') AND (v.settings_version_id=$2::uuid OR $2::uuid IS NULL) ORDER BY v.ctime,v.attempt_id LIMIT 25`,
        [clock(), config.settingsVersion ?? null],
      )
    ).rows;
    for (const row of rows) {
      await pool.query(
        "UPDATE voice_calls SET cancel_requested=true WHERE attempt_id=$1",
        [row.attempt_id],
      );
      if (!row.call_sid) continue;
      try {
        const call = await gateway.fetchCall(row.call_sid);
        let status = call.status;
        if (
          status === "queued" ||
          status === "ringing" ||
          status === "initiated"
        )
          status = (await gateway.cancelCall(row.call_sid)).status;
        else if (status === "in-progress" && row.purpose !== "offer")
          status = (await gateway.completeCall(row.call_sid)).status;
        const bound = await bindCall(row.attempt_id, {
          AccountSid: config.accountSid,
          CallSid: row.call_sid,
          From: row.from_number,
          To: row.to_number,
          CallStatus: status,
        });
        if (status === "canceled" && bound) {
          await mutate(pool, clock, async (db) => {
            const locked = await lockCall(db, row.attempt_id);
            if (
              !["replied", "failed", "cancelled"].includes(
                locked.attempt.status,
              )
            )
              await changeAttempt(
                db,
                locked.attempt,
                "cancelled",
                "request_closed",
              );
          });
        }
      } catch (error) {
        await pool.query(
          "UPDATE voice_calls SET next_cancel_at=$2,last_error=$3 WHERE attempt_id=$1",
          [
            row.attempt_id,
            new Date(+clock() + 5000),
            error.code ? "cancel_" + error.code : "cancel_pending",
          ],
        );
      }
    }
  }
  async function available(attempt) {
    if (attempt.purpose === "confirmation")
      return Boolean(
        (
          await pool.query(
            "SELECT 1 FROM assignments WHERE candidate_id=$1 AND status='confirmed'",
            [attempt.candidate_id],
          )
        ).rowCount,
      );
    if (attempt.purpose !== "offer") return true;
    return Boolean(
      (
        await pool.query(
          "SELECT 1 FROM requests r JOIN candidates c ON c.request_id=r.id WHERE r.id=$1 AND c.id=$2 AND r.status='open' AND r.deadline_at>$3 AND c.final_response IS NULL",
          [attempt.request_id, attempt.candidate_id, clock()],
        )
      ).rowCount,
    );
  }
  function register(app) {
    const form = express.urlencoded({
      extended: false,
      limit: "64kb",
      verify: (req, res, raw) => {
        req.rawBody = raw;
      },
    });
    for (const kind of ["twiml", "gather", "status"])
      app.post(
        `/integrations/twilio/voice/:id/${kind}`,
        form,
        async (req, res) => {
          if (
            !validateTwilioWebhook(
              config,
              req.get("X-Twilio-Signature"),
              req.originalUrl,
              req.body ?? {},
            )
          ) {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "twilio.invalid_signature",
              }),
            );
            fail(401, "Invalid Twilio signature");
          }
          if (!z.uuid().safeParse(req.params.id).success)
            validation("id", "Invalid attempt ID");
          const bound = await bindCall(
            req.params.id,
            req.body,
            kind === "status" ? undefined : "in-progress",
          );
          res.set("Cache-Control", "no-store");
          if (!bound) {
            await receiveEvent(
              pool,
              clock,
              {
                event_id: `twilio:${req.body.CallSid}:unmatched:${kind}`,
                correlation_id: req.params.id,
                type: "provider_unmatched",
              },
              req.rawBody.toString("utf8"),
            );
            return kind === "status"
              ? res.json({ ok: true })
              : res
                  .type("text/xml")
                  .send(
                    voiceMessage(
                      null,
                      "unavailable",
                    ),
                  );
          }
          const { attempt, call } = bound;
          if (kind === "twiml")
            return res
              .type("text/xml")
              .send(
                (await available(attempt))
                  ? voiceTwiml(
                      call.payload,
                      gateway.callbackUrl(attempt.id, "gather"),
                    )
                  : voiceMessage(
                      call.payload,
                      "unavailable",
                    ),
              );
          let event,
            repeat = false;
          if (kind === "gather") {
            const digit = mapDigits(req.body.Digits ?? "");
            repeat = ["repeat", "invalid"].includes(digit.type);
            event = {
              ...digit,
              type: repeat ? "provider_repeat" : digit.type,
              event_id: `twilio:${req.body.CallSid}:digits:${req.body.Digits || "empty"}`,
            };
          } else
            event = {
              event_id: `twilio:${req.body.CallSid}:status:${req.body.SequenceNumber ?? req.body.CallStatus}`,
              type:
                req.body.CallStatus === call.last_status
                  ? (mapTwilioStatus(req.body.CallStatus) ?? "provider_unknown")
                  : "provider_status_ignored",
              reason: req.body.ErrorCode ?? null,
            };
          await receiveEvent(
            pool,
            clock,
            {
              ...event,
              correlation_id: attempt.id,
              external_id: req.body.CallSid,
              occurred_at: clock().toISOString(),
            },
            req.rawBody.toString("utf8"),
          );
          // Provider I/O belongs to the worker, not the live TwiML response.
          if (kind === "status") return res.json({ ok: true });
          if (repeat)
            return res
              .type("text/xml")
              .send(
                (await available(attempt))
                  ? voiceTwiml(
                      call.payload,
                      gateway.callbackUrl(attempt.id, "gather"),
                    )
                  : voiceMessage(
                      call.payload,
                      "unavailable",
                    ),
              );
          return res
            .type("text/xml")
            .send(
              voiceMessage(
                call.payload,
                event.type === "no_input" ? "no_input" : "ack",
              ),
            );
        },
      );
  }
  return { sendAttempt, reconcile, register };
}
