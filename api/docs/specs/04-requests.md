# 04 — Shift / Contact Requests

## Request record

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `site_id` | ref | yes | Active site the user can access |
| `start_at`, `end_at` | timestamp | yes | G-02, G-03. `start_at` must be in the future |
| `headcount` | int | yes | 1–50 |
| `channels` | enum[] | yes | Non-empty subset of `whatsapp`, `voice` |
| `deadline_at` | timestamp | no | Default = `start_at`. Must be after now and ≤ `start_at` |
| `message` | string | no | Extra text added to the offer, max 500 chars |
| `mode` | enum | yes | `broadcast` \| `direct` (P0). `sequential`, `waves` are P1 |
| `open_shift_ids` | ref[] | no | Set when created from roster "Find staff" (RO-06) |
| `status` | enum | — | See state machine |

## State machines

**Request**

```
draft ──send──▶ open ──(accepted = headcount)──▶ filled
  │               ├──(deadline reached)────────▶ expired
  └──cancel──▶ cancelled ◀──cancel──┘
```

| From | Event | To |
|------|-------|----|
| `draft` | send | `open` |
| `draft` | cancel | `cancelled` |
| `open` | accepted count reaches headcount | `filled` |
| `open` | `deadline_at` reached, not filled | `expired` |
| `open` | cancel | `cancelled` |
| `filled` | cancel | `cancelled` |
| `filled` | manager removes an accepted staff (AC-D-05-02) and `deadline_at` not passed | `open` (skipped candidates are **not** re-contacted in P0; `contacting` ones can still accept) |
| `filled` | manager removes an accepted staff after `deadline_at` | `expired` |
| `expired` / `cancelled` | any | — (final, `409`) |

**Candidate**

| Status | Meaning |
|--------|---------|
| `pending` | Selected, not contacted yet |
| `contacting` | At least one attempt sent, no final response |
| `accepted` | Said yes and got a slot (has an assignment) |
| `declined` | Said no |
| `too_late` | Said yes after the request was filled / expired / cancelled |
| `no_response` | No final response by deadline |
| `failed` | Every attempt failed (e.g. invalid number, not on WhatsApp) |
| `skipped` | Never contacted because the request closed first, or staff became non-contactable |

---

## R-01 Create Request

**Test level:** Unit (validation) + Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-01-01 | Site manager of S1 | Creates request for S1, tomorrow 07:00–15:00, headcount 3, channels [whatsapp] | `201`, status `draft`, `deadline_at` = `start_at` |
| AC-R-01-02 | — | `start_at` in the past | `400` field `start_at` |
| AC-R-01-03 | — | `end_at` ≤ `start_at` | `400` field `end_at` |
| AC-R-01-04 | — | Duration 25 hours | `400` (max 24h) |
| AC-R-01-05 | — | Headcount 0 or 51 | `400` field `headcount` |
| AC-R-01-06 | — | `channels = []` | `400` field `channels` |
| AC-R-01-07 | — | `deadline_at` after `start_at` | `400` field `deadline_at` |
| AC-R-01-08 | — | Times entered 22:00–06:00 (crosses midnight) at a site in `Asia/Singapore` | Accepted; stored in UTC; end is next day |
| AC-R-01-09 | Draft request whose `start_at` has since passed | User sends it | `409` "start time has passed" |
| AC-R-01-10 | Open request | User edits time / headcount | `409` (only cancel allowed once open) |

## R-02 Automatic Candidate Selection

**Test level:** Unit (selection function) + Integration

**Rules** — a staff member is an **eligible candidate** when ALL are true:
1. Actively linked to the request's site (L-01).
2. `status = active` (S-03).
3. Contactable on at least one of the request's channels (S record, "Contactable rule").
4. No overlapping non-cancelled shift at any site (R-10).

Candidates are generated when the request is created (in `draft`) and are re-checked just before each attempt is sent. Each excluded staff is returned with a reason.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-02-01 | S1 has linked staff A (active, opted in), B (active, opted in) | Request for S1, channels [whatsapp] | Candidates = [A, B] |
| AC-R-02-02 | C linked to S2 only | Request for S1 | C is not a candidate (not in exclusion list either — not linked) |
| AC-R-02-03 | D linked to S1, `on_leave` | Request for S1 | D excluded, reason `not_active` |
| AC-R-02-04 | E linked to S1, active, opt-in false | Channels [whatsapp] | E excluded, reason `not_contactable` |
| AC-R-02-05 | E as above | Channels [whatsapp, voice] | E is a candidate (voice only) |
| AC-R-02-06 | F linked to S1, has shift at S2 overlapping the request | Request for S1 | F excluded, reason `overlapping_shift` |
| AC-R-02-07 | G has shift ending exactly at request start | Request for S1 | G is a candidate (G-02 half-open) |
| AC-R-02-08 | Linked but unlinked (`active = false`) staff H | Request for S1 | H not a candidate |
| AC-R-02-09 | No eligible staff | Request created | `201` with 0 candidates; sending it returns `409` "no candidates" |

## R-03 Manually Edit Candidates (draft only)

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-03-01 | Draft request with candidates [A, B] | User removes B | Candidates = [A] |
| AC-R-03-02 | Draft; staff C linked to S1, eligible, previously removed | User adds C | Candidates = [A, C] |
| AC-R-03-03 | Draft; staff F has overlapping shift | User adds F | `409` reason `overlapping_shift` |
| AC-R-03-04 | Draft; staff C not linked to S1 | User adds C | `409` reason `not_linked` |
| AC-R-03-05 | Open request | User adds or removes a candidate | `409` |

## R-04 Direct Request (one specific staff)

**Test level:** Integration

**Rules:** `mode = direct`, exactly one `staff_id`, headcount forced to 1. Same eligibility as R-02.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-04-01 | Eligible staff A | User creates direct request for A | `201`, candidates = [A], headcount 1 |
| AC-R-04-02 | — | Direct request with headcount 3 | Headcount stored as 1 |
| AC-R-04-03 | — | Direct request with no `staff_id` | `400` |
| AC-R-04-04 | A has overlapping shift | Direct request for A | `409` reason `overlapping_shift` |
| AC-R-04-05 | A accepts | — | Request `filled` |
| AC-R-04-06 | A declines | — | Request stays `open` until deadline, then `expired` (manager sees "declined") |

## R-05 Channel Selection

**Test level:** Unit + Integration (with mock messaging service)

**Rules**
- `[whatsapp]` → one WhatsApp attempt per candidate.
- `[voice]` → one call attempt per candidate.
- `[whatsapp, voice]` → both sent **at the same time** (parallel). If the candidate is contactable on only one, only that one is sent.
- When a candidate gives a final response on one channel, any **not-yet-sent** attempt on the other channel is cancelled.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-05-01 | Channels [whatsapp], 2 candidates | Request sent | 2 WhatsApp attempts, 0 calls |
| AC-R-05-02 | Channels [voice], 2 candidates | Request sent | 2 call attempts, 0 WhatsApp |
| AC-R-05-03 | Channels [whatsapp, voice], candidate opted in | Request sent | 1 WhatsApp + 1 call attempt for that candidate |
| AC-R-05-04 | Channels [whatsapp, voice], candidate not opted in | Request sent | Only 1 call attempt |
| AC-R-05-05 | Both attempts queued; candidate accepts via WhatsApp before the call is placed | — | Call attempt status `cancelled`; Messaging Service never receives it |
| AC-R-05-06 | Candidate replies on WhatsApp **and** presses 1 on the call | — | Only the first is acted on (A-05); one assignment |

## R-06 Broadcast — First N Accepters Win

**Test level:** Unit + Integration (concurrency test required)

**Rules**
- On send: all candidates are contacted.
- Each **accept** is processed in a DB transaction that locks the request row:
  - if `accepted < headcount` → create assignment, candidate `accepted`, send confirmation (F-01), create/fill roster shift (RO-05);
  - else → candidate `too_late`, send "already filled" (F-02).
- **Decline** → candidate `declined`. No message in P0.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-06-01 | Draft request, 5 candidates | User sends | Status `open`; 5 candidates `contacting` |
| AC-R-06-02 | Headcount 2, A accepts | — | A `accepted`, 1 assignment, request still `open` |
| AC-R-06-03 | Headcount 2; A, B, C accept in that order | — | A, B `accepted`; C `too_late`; exactly 2 assignments |
| AC-R-06-04 | Headcount 1; A and B accept **concurrently** | Both processed in parallel | Exactly 1 assignment; the other is `too_late` |
| AC-R-06-05 | A declines | — | A `declined`; no assignment; no message sent |
| AC-R-06-06 | A accepts | — | A receives confirmation (F-01) |
| AC-R-06-07 | C is `too_late` | — | C receives "already filled" (F-02) |
| AC-R-06-08 | A declined, then later accepts | — | Ignored (A-05); A stays `declined`; logged |

## R-07 Auto-close When Filled

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-07-01 | Headcount 2, 1 accepted | Second accept | Request `filled` |
| AC-R-07-02 | Request filled | — | Candidates still `pending` → `skipped`; all queued attempts → `cancelled` |
| AC-R-07-03 | Request filled; D is `contacting` | D declines | D `declined`; nothing else changes |
| AC-R-07-04 | Request filled | Expiry job runs at deadline | Status stays `filled` (no change) |

## R-08 Deadline / Expiry

**Test level:** Integration (with fake clock)

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-08-01 | Open request, headcount 3, 1 accepted | Clock reaches `deadline_at` | Status `expired`; `contacting` candidates → `no_response`; queued attempts cancelled |
| AC-R-08-02 | Expired request with 1 accepted | — | That assignment and its roster shift **remain** confirmed |
| AC-R-08-03 | Expired request | Candidate accepts afterwards | Candidate `too_late`; receives F-02 |
| AC-R-08-04 | Open request | Clock is 1 second before deadline | Status still `open` |

## R-09 Cancel Request

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-09-01 | Draft request | User cancels | `cancelled`; no messages sent |
| AC-R-09-02 | Open request with 2 accepted | User cancels | `cancelled`; both assignments `cancelled`; their roster shifts `cancelled`; both receive F-03 |
| AC-R-09-03 | Open request | User cancels | Queued attempts cancelled; contacted-but-unanswered candidates receive nothing |
| AC-R-09-04 | Cancelled request | Candidate accepts afterwards | `too_late`; receives F-02 |
| AC-R-09-05 | Expired request | User cancels | `409` |
| AC-R-09-06 | Filled request | User cancels | `cancelled`; same effects as AC-R-09-02 |
| AC-R-09-07 | Request created from open shifts (RO-06), with 1 accepted | User cancels | The filled shift goes back to **open** (staff removed), not cancelled |

## R-10 Cross-site Overlap Exclusion

**Test level:** Unit (overlap function) + Integration

**Rules:** A staff member must not be confirmed for two overlapping time ranges. Checked (1) at candidate selection, (2) before each attempt is sent, (3) again inside the accept transaction.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-R-10-01 | Ranges 07:00–15:00 and 14:00–22:00 | Overlap check | `true` |
| AC-R-10-02 | Ranges 07:00–15:00 and 15:00–23:00 | Overlap check | `false` |
| AC-R-10-03 | Ranges 22:00–06:00 (+1 day) and 05:00–09:00 (+1 day) | Overlap check | `true` |
| AC-R-10-04 | A is a candidate on requests R1 (S1) and R2 (S2), overlapping times | A accepts R1, then accepts R2 | R1 accepted; on R2, A → `too_late` with reason `overlapping_shift` and receives F-02 |
| AC-R-10-05 | A accepts R1 and R2 concurrently | Both processed in parallel | Exactly one assignment for A |
| AC-R-10-06 | A has a **cancelled** shift overlapping the request | Candidate selection | A is eligible (cancelled shifts don't count) |
