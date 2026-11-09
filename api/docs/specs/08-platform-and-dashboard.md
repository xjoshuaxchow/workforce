# 08 — Platform & Dashboard

## N-01 Audit Log

**Test level:** Integration

**Entry:** `{ id, actor_type (user | system | staff), actor_id, action, entity_type, entity_id, before, after, metadata, at }`

**Rules**
- Written in the **same transaction** as the change it records.
- Append-only: no update or delete API.
- Admins can view all entries; site managers can view entries for entities of their sites.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-N-01-01 | Admin edits staff name | — | One entry: actor = admin, action `staff.updated`, before/after names |
| AC-N-01-02 | Staff accepts a request via WhatsApp | — | Entry with actor_type `staff`, action `candidate.accepted` |
| AC-N-01-03 | Request expires | — | Entry with actor_type `system`, action `request.expired` |
| AC-N-01-04 | The change fails (transaction rolled back) | — | No audit entry |
| AC-N-01-05 | — | Anyone calls update/delete on audit log | `404` / `405` (no such endpoint) |
| AC-N-01-06 | Site manager of S1 | Lists audit for an S2 request | `404` |

## Record Timestamps — `ctime` / `utime` (G-01b, G-01d)

**Test level:** Integration (run against every table / entity)

| ID | Given | When | Then |
|----|-------|------|------|
| AC-G-01b-01 | — | Any record is created | `ctime` and `utime` are set to now (fake clock) and are equal |
| AC-G-01b-02 | Record created at T1 | Updated at T2 | `ctime = T1`, `utime = T2` |
| AC-G-01b-03 | — | Client sends `ctime` / `utime` in a create or update body | Values ignored; server times used |
| AC-G-01b-04 | — | Schema check (migration test) | Every table has `ctime` and `utime` of type `timestamptz NOT NULL` |

## N-02 Background Jobs

**Test level:** Integration (with fake clock and real queue, or in-memory queue adapter)

**Jobs**

| Job | Trigger |
|-----|---------|
| `send-attempt` | Request sent; follow-up needed; roster published/changed |
| `request-deadline` | Scheduled at `deadline_at` |
| `shift-complete` | Periodic (every 5 min): shifts with `end_at` passed |

**Rules**
- Every job is **idempotent**: running it twice has the same effect as once.
- On worker restart, overdue scheduled jobs still run.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-N-02-01 | Request sent | — | One `send-attempt` job per attempt; one `request-deadline` job |
| AC-N-02-02 | `request-deadline` runs twice | — | Request expired once; one audit entry |
| AC-N-02-03 | Worker was down at deadline | Worker restarts | Request is expired |
| AC-N-02-04 | Request filled before deadline | Deadline job runs | No change (AC-R-07-04) |

## N-03 Timezone Handling

**Test level:** Unit

| ID | Given | When | Then |
|----|-------|------|------|
| AC-N-03-01 | Site `Asia/Singapore`, input `2026-11-03 07:00` | Converted | `2026-11-02T23:00:00Z` |
| AC-N-03-02 | Site `Australia/Sydney`, shift 2026-04-05 01:00–09:00 local (DST ends that night) | Duration computed | 9 hours (not 8) |
| AC-N-03-03 | Two sites in different timezones | Same staff, shifts compared for overlap | Compared in UTC (correct regardless of timezone) |
| AC-N-03-04 | Message built for site in `Asia/Singapore` | — | Times in Singapore local time |

---

## Dashboard (React)

**Test level:** E2E (Playwright) against API with seeded data and the mock messaging service. Component tests (Vitest + Testing Library) for forms and validation messages.

### D-01 Management Screens (staff, sites, linkage)

| ID | Scenario | Expected |
|----|----------|----------|
| AC-D-01-01 | Admin creates staff via form with invalid mobile | Inline error on mobile field; form not submitted |
| AC-D-01-02 | Admin creates staff with valid data | Staff appears in list |
| AC-D-01-03 | Admin uploads CSV with errors | Error table shows row number, field, message |
| AC-D-01-04 | Admin links 3 staff to a site via multi-select | Site's staff tab shows the 3 staff |
| AC-D-01-05 | Site manager logs in | "Add staff", "Add site", "Link staff" actions are not visible |

### D-02 Create Request

| ID | Scenario | Expected |
|----|----------|----------|
| AC-D-02-01 | Manager picks site, date, times, headcount, channels | Draft created; candidate list shown with excluded staff and reasons |
| AC-D-02-02 | Manager removes a candidate, then clicks Send | Confirmation dialog shows "Send to N staff via WhatsApp / Call" |
| AC-D-02-03 | Manager picks end time before start time | Inline error; Send disabled |
| AC-D-02-04 | Site dropdown for a site manager | Only their sites listed |
| AC-D-02-05 | Manager opens a staff profile and clicks "Contact directly" | Direct request form opens with staff pre-filled (R-04) |

### D-03 Request List

| ID | Scenario | Expected |
|----|----------|----------|
| AC-D-03-01 | Filter by status `open` | Only open requests |
| AC-D-03-02 | List shows | Site, date/time, `accepted / headcount`, status, created by |

### D-04 Live Request Detail

| ID | Scenario | Expected |
|----|----------|----------|
| AC-D-04-01 | Request open; mock emits ACCEPT for a candidate | Within 10 s (polling in P0), candidate shows "Accepted" and counter increases |
| AC-D-04-02 | Per candidate | Shows each channel's attempt status (e.g. WhatsApp: Read, Call: No answer) and response time |
| AC-D-04-03 | Request filled | Status badge "Filled"; Send/Cancel buttons reflect allowed actions |

### D-05 Manual Override

| ID | Scenario | Expected |
|----|----------|----------|
| AC-D-05-01 | Manager confirms a `contacting` candidate manually (e.g. they called in) | Same effect as accept: assignment, roster shift, confirmation message; audit actor = manager |
| AC-D-05-02 | Manager removes an `accepted` candidate | Assignment cancelled; roster shift cancelled (or back to open, RO-06); staff receives F-03; slot reopens if request still open and before deadline |
| AC-D-05-03 | Manual confirm when request is already filled | Error "Request is full" |
| AC-D-05-04 | Manual confirm of staff with overlapping shift | Error with reason `overlapping_shift` |

### D-07 Roster Screens

| ID | Scenario | Expected |
|----|----------|----------|
| AC-D-07-01 | Open site roster, week view | Grid: rows = staff (+ "Open shifts" row), columns = 7 days, shifts in local time |
| AC-D-07-02 | Day with an open shift | Day header highlighted as understaffed |
| AC-D-07-03 | Create shift that overlaps | Error message names the conflict |
| AC-D-07-04 | Assign staff not linked to site | Warning dialog; "Assign anyway" saves with acknowledgement |
| AC-D-07-05 | Select 2 open shifts → "Find staff" | Create-request form opens pre-filled, headcount 2 |
| AC-D-07-06 | Click "Publish week" | Summary dialog: published N, notified M, not notified list |
