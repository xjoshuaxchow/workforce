# 06 — Channels, Follow-ups & Response Handling

All sending goes through the Company Messaging Microservice (see [07-integration.md](07-integration.md)). Tests use the mock service (I-04).

## Attempt record

| Field | Rules |
|-------|-------|
| `id` | Also used as `correlation_id` sent to the Messaging Service |
| `candidate_id` | |
| `channel` | `whatsapp` \| `voice` |
| `purpose` | `offer` \| `confirmation` \| `filled` \| `cancellation` \| `roster_publish` \| `roster_change` |
| `status` | See below |
| `external_id` | ID returned by the Messaging Service |
| `response` | `accept` \| `decline` \| `null` |

**Attempt status**

| Status | WhatsApp | Voice |
|--------|----------|-------|
| `queued` | ✓ | ✓ |
| `cancelled` | ✓ (cancelled before send) | ✓ |
| `sent` | ✓ | ✓ (call placed) |
| `delivered` | ✓ | — |
| `read` | ✓ | — |
| `answered` | — | ✓ |
| `no_answer` / `busy` | — | ✓ |
| `no_input` | — | ✓ (answered, hung up without pressing a valid key) |
| `replied` | ✓ | ✓ |
| `failed` | ✓ | ✓ |

**Status never moves backwards.** Order: `queued → sent → delivered → read → replied` (WhatsApp) and `queued → sent → answered → replied` (voice). A late `delivered` after `read` is stored in history but does not change the status. `failed` and `replied` are final.

## Follow-up channel rule

Follow-up messages for **requests** (F-01, F-02, F-03) go by **WhatsApp if the staff member is WhatsApp-contactable, otherwise by an info-only voice call** (text-to-speech, no keypad options). Roster messages (RO-21, RO-22) are WhatsApp only in P0.

---

## W-01 WhatsApp Shift Offer (template)

**Test level:** Unit (payload builder) + Contract

**Template:** `shift_offer_v1`, language `en` in P0. Variables:

| Variable | Example | Rule |
|----------|---------|------|
| `staff_name` | Anna | First name or full name |
| `site_name` | North Depot | |
| `date` | Mon 3 Nov 2026 | In site timezone |
| `start_time` | 07:00 | 24h, site timezone |
| `end_time` | 15:00 | If next day: `06:00 (+1 day)` |
| `message` | Bring PPE | Request `message`, or empty |

| ID | Given | When | Then |
|----|-------|------|------|
| AC-W-01-01 | Request at S1 (`Asia/Singapore`) 2026-11-03 07:00–15:00 local | Offer built for Anna | Payload has template `shift_offer_v1` and the variables above |
| AC-W-01-02 | Request 22:00–06:00 | Offer built | `end_time = "06:00 (+1 day)"` |
| AC-W-01-03 | Request with no message | Offer built | `message = ""` |
| AC-W-01-04 | Offer sent | — | Payload `to` is the staff `mobile` in E.164; `correlation_id` = attempt id |

## W-02 Yes / No Buttons

**Test level:** Unit + Contract

| ID | Given | When | Then |
|----|-------|------|------|
| AC-W-02-01 | Offer built | — | `options = [{ id: "ACCEPT", label: "Yes" }, { id: "DECLINE", label: "No" }]` |

## W-03 WhatsApp Delivery Status

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-W-03-01 | Attempt `sent` | Event `delivered` | Attempt `delivered` |
| AC-W-03-02 | Attempt `read` | Late event `delivered` | Attempt stays `read`; event stored in history |
| AC-W-03-03 | Attempt `sent` | Event `failed` (reason `not_on_whatsapp`) | Attempt `failed` with reason |
| AC-W-03-04 | Candidate's only attempt fails | — | Candidate `failed` |
| AC-W-03-05 | Candidate has WhatsApp `failed` and voice still `queued`/`sent` | — | Candidate stays `contacting` |

## W-04 WhatsApp Reply

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-W-04-01 | Offer attempt `read` | Event `reply`, `option_id = ACCEPT` | Attempt `replied`, response `accept`; accept flow runs (R-06) |
| AC-W-04-02 | Same | `option_id = DECLINE` | Response `decline`; decline flow runs |
| AC-W-04-03 | Same | Event `reply` with unknown `option_id` or free text | Stored; no state change (free-text parsing is P1) |
| AC-W-04-04 | — | Reply for a `correlation_id` we don't know | `200` (so the service doesn't retry forever); logged as `unmatched_event` |
| AC-W-04-05 | Reply to a **follow-up** message (not an offer) | — | Stored; no state change |

## V-01 Outbound Call (TTS)

**Test level:** Unit (script builder) + Contract

**Script** (P0, `en`):
> "Hello {staff_name}. This is a shift offer at {site_name} on {date}, from {start_time} to {end_time}. {message} Press 1 to accept. Press 2 to decline. Press 9 to repeat."

| ID | Given | When | Then |
|----|-------|------|------|
| AC-V-01-01 | Request as in AC-W-01-01 | Call payload built | Channel `voice`, `to` = mobile, script text with variables filled, `correlation_id` = attempt id |
| AC-V-01-02 | Request 22:00–06:00 | Script built | Says "to 6 AM the next day" (spoken form of the time) |

## V-02 Keypad Input

**Test level:** Unit + Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-V-02-01 | Call payload built | — | `options = [{ id: "ACCEPT", dtmf: "1" }, { id: "DECLINE", dtmf: "2" }]`, `repeat_dtmf: "9"` |
| AC-V-02-02 | Call answered | Event `reply`, `option_id = ACCEPT` | Same effect as AC-W-04-01 |
| AC-V-02-03 | Call answered | Event `reply`, `option_id = DECLINE` | Same effect as AC-W-04-02 |

## V-03 Call Status

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-V-03-01 | Call `sent` | Event `answered` | Attempt `answered` |
| AC-V-03-02 | Call `sent` | Event `no_answer` | Attempt `no_answer`; candidate stays `contacting` until deadline (retry is P1) |
| AC-V-03-03 | Call `answered` | Event `completed` with no reply | Attempt `no_input`; candidate stays `contacting` |
| AC-V-03-04 | Call `sent` | Event `failed` (invalid number) | Attempt `failed` |
| AC-V-03-05 | Candidate's attempts: WhatsApp `failed`, voice `failed` | — | Candidate `failed` |
| AC-V-03-06 | Candidate's attempts: WhatsApp `failed`, voice `no_answer` | Deadline reached | Candidate `no_response` (not `failed` — the number works) |

## F-01 Confirmation

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-F-01-01 | A accepts and gets a slot; A WhatsApp-contactable | — | WhatsApp `shift_confirmed_v1` with site name, address, date, times |
| AC-F-01-02 | A accepts via call; A **not** WhatsApp-contactable | — | Info-only voice call with the confirmation |
| AC-F-01-03 | Duplicate accept event | — | Only one confirmation sent (RH-02) |

## F-02 "Already Filled / No Longer Available"

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-F-02-01 | Candidate becomes `too_late` | — | Receives `shift_unavailable_v1` ("Thanks — this shift is no longer available") |
| AC-F-02-02 | Candidate declines after filled | — | No message |

## F-03 Cancellation Notice

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-F-03-01 | Confirmed assignment, request cancelled | — | Staff receives `shift_cancelled_v1` with site, date, time |
| AC-F-03-02 | Request cancelled; candidate only `contacting` | — | No message (AC-R-09-03) |

---

## RH-01 Unified Response Model

**Test level:** Unit

| Source | Input | Response |
|--------|-------|----------|
| WhatsApp | `option_id = ACCEPT` | `accept` |
| WhatsApp | `option_id = DECLINE` | `decline` |
| Voice | `option_id = ACCEPT` (dtmf 1) | `accept` |
| Voice | `option_id = DECLINE` (dtmf 2) | `decline` |
| Any | anything else | `null` (no action) |

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RH-01-01 | Each row in the table above | Mapper runs | Returns the listed response |

## RH-02 Idempotent Event Processing

**Test level:** Integration

**Rule:** Each event has an `event_id` from the Messaging Service. An `event_id` already processed is acknowledged (`200`) and skipped.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RH-02-01 | Event E (ACCEPT) processed | E delivered again | `200`; no second assignment; no second confirmation |
| AC-RH-02-02 | Candidate already `accepted` | A **different** event with ACCEPT on the other channel | Logged; no change (A-05) |
| AC-RH-02-03 | Event processing throws mid-way | Same event retried | Processed exactly once in effect (transaction rolled back the first time) |

## RH-03 Concurrency-safe Acceptance

**Test level:** Integration (concurrency)

Covered by AC-R-06-04, AC-R-10-05 and AC-RO-16-04. Tests must fire the events **in parallel** against a real Postgres (not mocked).

## RH-04 Store Raw Payload

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RH-04-01 | Any event received (matched, unmatched, duplicate, invalid option) | — | Raw body stored with received time |
| AC-RH-04-02 | Event rejected for bad signature (I-03) | — | Not stored as an event; logged as a security warning |
