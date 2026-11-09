import { audit } from "./service.js";
export async function enqueueJob(db, clock, kind, payload, key, at = clock()) {
  await db.query(
    "INSERT INTO jobs(kind,payload,run_at,dedupe_key) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",
    [kind, payload, at, key],
  );
}
export async function queueAttempt(
  db,
  clock,
  {
    candidateId = null,
    requestId = null,
    siteId,
    staffId,
    channel,
    purpose,
    key,
    payload = {},
    language = null,
  },
) {
  const row = (
    await db.query(
      "INSERT INTO attempts(candidate_id,request_id,site_id,staff_id,channel,purpose,dedupe_key,payload,settings_version_id,language_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,coalesce((SELECT settings_version_id FROM attempts WHERE request_id=$2 AND purpose='offer' ORDER BY ctime,id LIMIT 1),(SELECT version_id FROM messaging_settings_active WHERE singleton)),coalesce((SELECT language_snapshot FROM attempts WHERE candidate_id=$1 AND purpose='offer' ORDER BY ctime,id LIMIT 1),$9,(SELECT language FROM staff WHERE id=$4))) ON CONFLICT(dedupe_key) DO NOTHING RETURNING *",
      [
        candidateId,
        requestId,
        siteId,
        staffId,
        channel,
        purpose,
        key,
        payload,
        language,
      ],
    )
  ).rows[0];
  if (row) {
    await audit(
      db,
      clock,
      { actor_type: "system", id: null },
      "attempt.created",
      "attempt",
      row.id,
      null,
      row,
      siteId,
    );
    await enqueueJob(
      db,
      clock,
      "send-attempt",
      { attempt_id: row.id },
      `send:${row.id}`,
    );
  }
  return row;
}
