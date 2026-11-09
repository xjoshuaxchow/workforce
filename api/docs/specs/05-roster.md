# 05 — Staff Roster

## Shift record

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `site_id` | ref | yes | Active site the user can access |
| `staff_id` | ref | no | `null` = **open shift** |
| `start_at`, `end_at` | timestamp | yes | G-02, G-03 |
| `notes` | string | no | Max 500 chars |
| `status` | enum | — | See state machine |
| `source` | enum | — | `manual` \| `request` |
| `request_id` | ref | no | Set when created or filled by a request |

## State machine

```
draft ──publish──▶ published ──(end_at passed)──▶ completed
                                    ▲
request accept ──▶ confirmed ───────┘ (end_at passed)

draft / published / confirmed ──cancel──▶ cancelled
```

| From | Event | To |
|------|-------|----|
| — | created manually | `draft` |
| — | created by request accept (RO-05) | `confirmed` |
| open `draft`/`published` | filled by request accept (RO-06) | `confirmed` |
| `draft` | publish | `published` |
| `published`, `confirmed` | `end_at` passed (job) | `completed` |
| `draft`, `published`, `confirmed` | cancel | `cancelled` |
| `completed`, `cancelled` | any edit | — (`409`) |

---

## RO-01 / RO-02 / RO-03 Create, Edit, Cancel Shifts

**Test level:** Unit (state machine) + Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-03-01 | Site manager of S1, staff A eligible | Creates shift at S1 for A, tomorrow 07:00–15:00 | `201`, status `draft`, source `manual` |
| AC-RO-03-02 | — | Creates shift with no staff | `201`, open shift (`staff_id = null`) |
| AC-RO-03-03 | — | `end_at` ≤ `start_at` | `400` |
| AC-RO-03-04 | Draft shift | Change staff from A to B | Saved; overlap & eligibility checks run for B |
| AC-RO-03-05 | Draft shift | Cancel | Status `cancelled` (soft — G-05) |
| AC-RO-03-06 | Completed shift | Edit or cancel | `409` |
| AC-RO-03-07 | Cancelled shift | Edit | `409` |
| AC-RO-03-08 | Published shift, `end_at` passed | Completion job runs | Status `completed` |
| AC-RO-03-09 | Draft shift, `end_at` passed | Completion job runs | Stays `draft` (never published → not completed) |
| AC-RO-03-10 | Shift start in the past | User creates it | Allowed (back-filling a record) but no notifications are ever sent for it |

## RO-04 Open Shifts

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-04-01 | Open shift | Assign staff A (eligible) | `staff_id = A`; status unchanged |
| AC-RO-04-02 | Shift with staff A, draft | Remove staff | Becomes open shift |
| AC-RO-04-03 | Open shift linked to an `open` request | User manually assigns staff | `409` "shift is being filled by request" — cancel request first |

## RO-05 Request Accept Creates Roster Shift

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-05-01 | Request **without** open shifts, at S1, 07:00–15:00 | A accepts | New shift: site S1, staff A, same times, status `confirmed`, source `request`, `request_id` set |
| AC-RO-05-02 | Headcount 3, 3 accept | — | 3 confirmed shifts |
| AC-RO-05-03 | A's assignment is cancelled (request cancelled) | — | A's shift `cancelled` (see AC-R-09-02) |

## RO-06 "Find Staff" From Open Shifts

**Test level:** Integration

**Rules**
- User selects one or more open shifts at the **same site** with **identical** start/end.
- A request is created in `draft` with `headcount` = number of shifts, `open_shift_ids` set, times copied.
- On each accept, the **earliest-created** (lowest `ctime`) unfilled shift in `open_shift_ids` gets the staff and becomes `confirmed`.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-06-01 | 2 open shifts at S1, 07:00–15:00 | Find staff | Draft request: S1, 07:00–15:00, headcount 2, `open_shift_ids` = both |
| AC-RO-06-02 | Open shifts with different times | Find staff | `400` "shifts must have the same time" |
| AC-RO-06-03 | Open shifts at different sites | Find staff | `400` |
| AC-RO-06-04 | Shift already has staff | Find staff | `400` "shift is not open" |
| AC-RO-06-05 | Shift already linked to an `open` or `draft` request | Find staff again | `409` |
| AC-RO-06-06 | Request from shifts X (older), Y | A accepts | X gets A, status `confirmed`; Y still open |
| AC-RO-06-07 | Same request | Request expires with only A accepted | Y stays open; Y can be used for a new "Find staff" |
| AC-RO-06-08 | Same request, A accepted into X | Request cancelled | X back to open, A removed, A receives F-03 (see AC-R-09-07) |

## RO-10 Site Roster View

**Test level:** Integration (API) + E2E (UI)

**Rules:** `GET /sites/:id/roster?from=&to=` — max range 31 days. Returns shifts (excluding `cancelled` unless `include_cancelled=true`), grouped by staff, with open shifts in their own group. Times returned in UTC plus the site timezone; UI shows local time.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-10-01 | S1 has shifts for A, B, and one open shift this week | Get roster for the week | Groups: A, B, `open`; each with their shifts |
| AC-RO-10-02 | A cancelled shift | Get roster | Not included |
| AC-RO-10-03 | Same | Get roster with `include_cancelled=true` | Included |
| AC-RO-10-04 | — | Range of 32 days | `400` |
| AC-RO-10-05 | Shift 22:00–06:00 starting Monday | Week view | Shift appears on Monday (by start date in site timezone) |
| AC-RO-10-06 | Site manager of S1 | Get roster of S2 | `404` |
| AC-RO-10-07 | UI: week view | Click "Next week" | Shows the following 7 days |

## RO-11 Staff Roster View

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-11-01 | A has shifts at S1 and S2 | Admin gets A's roster | Both shifts with site details |
| AC-RO-11-02 | Same | Site manager of S1 only gets A's roster | S1 shift full; S2 shift shown as `busy` with times only (AC-U-05-03) |

## RO-12 Highlight Open Shifts & Understaffed Days

**Test level:** Integration

**Rule:** A day is **understaffed** when it has at least one open (non-cancelled) shift at the site.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-12-01 | Monday has 1 open shift, Tuesday has none | Get week roster | Summary: Monday `open_shifts: 1, understaffed: true`; Tuesday `open_shifts: 0, understaffed: false` |
| AC-RO-12-02 | Open shift is filled via request | Get roster | That day's open count decreases by 1 |

## RO-16 Block Overlapping Shifts

**Test level:** Unit + Integration

**Rule:** A staff member cannot have two non-cancelled overlapping shifts at any site(s). Uses the same overlap function as R-10.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-16-01 | A has shift S1 07:00–15:00 | Create shift for A at S2 14:00–22:00 | `409` reason `overlapping_shift`, returns the conflicting shift (masked per U-05 if other site) |
| AC-RO-16-02 | Same | Create shift for A at S2 15:00–23:00 | `201` |
| AC-RO-16-03 | A's earlier shift is cancelled | Create the overlapping shift | `201` |
| AC-RO-16-04 | Two users assign A to overlapping shifts at the same moment | Both requests processed concurrently | Exactly one succeeds |
| AC-RO-16-05 | A has shift 07:00–15:00 | Edit that same shift to 08:00–16:00 | `200` (a shift does not conflict with itself) |

## RO-17 Eligibility Warnings

**Test level:** Integration

**Rules**

| Condition | Result |
|-----------|--------|
| Staff `inactive` or `blocked` | **Block** — `409` |
| Staff `on_leave` | **Warning** |
| Staff not actively linked to the site | **Warning** |

Warnings return `409` with `{ warnings: [...] }` unless the request includes `acknowledge_warnings: true`, in which case the save succeeds and the warnings are written to the audit log.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-17-01 | A not linked to S1 | Assign A to S1 shift | `409`, warnings `[not_linked]` |
| AC-RO-17-02 | Same | Assign with `acknowledge_warnings: true` | `201`; audit log records acknowledged warning |
| AC-RO-17-03 | A `on_leave` | Assign | `409`, warnings `[on_leave]` |
| AC-RO-17-04 | A `blocked` | Assign with `acknowledge_warnings: true` | `409` (blocked can't be overridden) |
| AC-RO-17-05 | A not linked and on leave | Assign | Warnings `[not_linked, on_leave]` |

## RO-21 Publish Roster

**Test level:** Integration (with mock messaging service)

**Rules**
- `POST /sites/:id/roster/publish { from, to }`.
- All `draft` shifts in the range → `published` (including open shifts).
- Each staff member with **one or more newly published** shifts gets **one** WhatsApp message listing those shifts (local times).
- Staff not WhatsApp-contactable are listed in `not_notified` in the response (no voice fallback in P0).
- Shifts with `start_at` in the past are published but not notified.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-21-01 | A has 3 draft shifts, B has 1, plus 1 open shift in range | Publish | 5 shifts `published`; A gets 1 message listing 3 shifts; B gets 1 message; response `{ published: 5, notified: 2, not_notified: [] }` |
| AC-RO-21-02 | C has a draft shift, not opted in | Publish | C's shift published; `not_notified: [C]` |
| AC-RO-21-03 | Range already published, no drafts | Publish again | `{ published: 0, notified: 0 }`; no messages |
| AC-RO-21-04 | A has a `confirmed` shift (from request) and a draft | Publish | Only the draft is listed in A's message |
| AC-RO-21-05 | Draft shift outside the range | Publish | Stays `draft` |
| AC-RO-21-06 | Site manager of S1 | Publishes S2 | `404` |

## RO-22 Notify on Change / Cancel

**Test level:** Integration (with mock messaging service)

**Rules** — applies only to shifts in `published` or `confirmed` status with `start_at` in the future.

| Change | Message |
|--------|---------|
| Time changed | Staff gets "shift changed" with old and new time |
| Staff reassigned A → B | A gets "shift cancelled"; B gets "new shift" |
| Shift cancelled | Staff gets "shift cancelled" |
| Notes only | No message |
| Any change to a `draft` shift | No message |

| ID | Given | When | Then |
|----|-------|------|------|
| AC-RO-22-01 | Published shift for A | Time changed 07:00 → 08:00 | A receives "shift changed" with both times |
| AC-RO-22-02 | Published shift for A | Reassigned to B | A gets "cancelled", B gets "new shift" |
| AC-RO-22-03 | Confirmed shift for A | Cancelled | A gets "cancelled" |
| AC-RO-22-04 | Published shift | Only notes changed | No message |
| AC-RO-22-05 | Draft shift | Time changed | No message |
| AC-RO-22-06 | Published shift that started yesterday | Edited | No message |
| AC-RO-22-07 | A not WhatsApp-contactable | Their published shift is cancelled | Response includes `not_notified: [A]` |
