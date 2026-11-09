# Specifications (TDD)

These specs turn each **P0** feature in [FEATURES.md](../FEATURES.md) into testable acceptance criteria. Write the tests from these specs **before** the code.

## How to use

1. Pick a feature (e.g. `R-06`).
2. Each acceptance criterion has an ID: `AC-<feature>-<n>`, e.g. `AC-R-06-03`.
3. Write one failing test per criterion and put the AC ID in the test name:
   ```ts
   describe('R-06 Broadcast', () => {
     it('AC-R-06-03 confirms only the first N accepters', async () => { ... });
   });
   ```
4. Make it pass, refactor, move on.
5. If a criterion is unclear while writing the test, **fix the spec first**, then the test.

## Spec files

| File | Features |
|------|----------|
| [01-access-control.md](01-access-control.md) | U-01 … U-05 |
| [02-staff.md](02-staff.md) | S-01 … S-06 |
| [03-sites-and-linkage.md](03-sites-and-linkage.md) | SI-01, SI-02, L-01 … L-03 |
| [04-requests.md](04-requests.md) | R-01 … R-10 |
| [05-roster.md](05-roster.md) | RO-01 … RO-06, RO-10 … RO-12, RO-16, RO-17, RO-21, RO-22 |
| [06-channels-and-responses.md](06-channels-and-responses.md) | W-01 … W-04, V-01 … V-03, F-01 … F-03, RH-01 … RH-04 |
| [07-integration.md](07-integration.md) | I-01 … I-04 |
| [08-platform-and-dashboard.md](08-platform-and-dashboard.md) | N-01 … N-03, D-01 … D-05, D-07 |

## Test levels

| Level | Tool (suggested) | Covers |
|-------|------------------|--------|
| **Unit** | Vitest | Pure domain rules: overlap checks, candidate selection, state transitions, response mapping |
| **Integration** | Vitest + Supertest + test Postgres | API endpoints, DB constraints, transactions, permissions |
| **Contract** | Vitest against mock messaging service | Request/event shapes exchanged with the Company Messaging Microservice |
| **E2E** | Playwright | Dashboard flows (section D) |

Each feature lists its main test level. Prefer the lowest level that can prove the criterion.

Time-dependent criteria must use an injectable clock (never `Date.now()` directly) so tests control "now".

---

## Glossary

| Term | Meaning |
|------|---------|
| **Admin** | Dashboard user with access to all sites and global staff management |
| **Site Manager** | Dashboard user limited to the sites assigned to them |
| **Staff** | A worker who can be contacted. Not a dashboard user. |
| **Site** | A work location |
| **Linkage** | Staff is approved to work at a site |
| **Request** | "Need N staff at site X from A to B" — sent to candidates over channels |
| **Candidate** | A staff member selected to be contacted for a request |
| **Attempt** | One message or call to one candidate on one channel |
| **Response** | Candidate's answer: accept / decline (or no response / failed) |
| **Assignment** | A candidate confirmed for a request |
| **Shift** | A roster entry: site + time + (optional) staff |
| **Open shift** | A shift with no staff assigned |
| **Messaging Service** | The company's existing microservice that sends WhatsApp messages and places calls |

## Global rules

These apply to every spec. Tests may rely on them.

| ID | Rule |
|----|------|
| G-01 | All timestamps are stored in UTC. They are displayed and entered in the **site's timezone**. |
| G-01a | **DB time columns use Postgres `timestamptz`** (timestamp with time zone) — never `date`/`time` strings, epoch integers, or `timestamp` without time zone. Column names end in `_at` (e.g. `start_at`, `deadline_at`, `whatsapp_opt_in_at`). |
| G-01b | Every table has two record-time columns (`timestamptz`, `NOT NULL`, default `now()`) — the only exception to the `_at` naming in G-01a:<br>• **`ctime`** — when the row was created; never changes.<br>• **`utime`** — when the row was last updated; set to `now()` on every update (DB trigger or ORM hook). Equal to `ctime` on insert. |
| G-01d | API responses expose these as `ctime` and `utime` (ISO 8601 UTC, G-01c). Clients cannot set or change them — values sent in a request body are ignored. |
| G-01c | The API sends and receives times as ISO 8601 strings in UTC with `Z` (e.g. `2026-11-02T23:00:00Z`). Converting to and from the site's local time happens at the edges (UI, message text), never in the DB. |
| G-02 | Time ranges are half-open `[start, end)`. Shift A 07:00–15:00 and shift B 15:00–23:00 **do not** overlap. |
| G-03 | `end` must be after `start`. A shift or request may cross midnight. Maximum duration: 24 hours. |
| G-04 | Phone numbers are stored in E.164 format (e.g. `+6591234567`). Input with spaces/dashes is normalised; invalid numbers are rejected. |
| G-05 | Deletion of business records (staff, sites, requests, shifts) is **soft** (status change), never a hard delete. |
| G-06 | Every create / update / status change writes an audit log entry (see N-01). |
| G-07 | API validation errors return `400` with a list of `{ field, message }`. Permission errors return `403`. Missing records return `404`. Conflicts (e.g. overlap, duplicate) return `409`. |
| G-08 | Lists are paginated (default 50, max 200) and sorted by a stable key. |

## Assumptions to confirm

Specs below are written with these assumptions. If one is wrong, update the spec before writing tests.

| ID | Assumption | Related open question |
|----|------------|-----------------------|
| A-01 | Only **Admins** create/edit staff and manage site ↔ staff linkage. Site Managers manage requests and roster for their sites. | Q6 |
| A-02 | The Messaging Service accepts our `correlation_id` and returns it on every event. | Q2 |
| A-03 | The Messaging Service maps WhatsApp buttons and IVR keypad digits to our `option_id`, and handles IVR "repeat" itself. | Q1 |
| A-04 | Event delivery is **at-least-once**; we must deduplicate. | Q3 |
| A-05 | In P0, a candidate's **first final response wins** (accept or decline). Later responses are logged and ignored. Withdrawal is P1 (RH-05). | — |
| A-06 | In P0, a published roster shift does **not** need staff confirmation. | Q8 |
| A-07 | Login is email + password (SSO is P2). | — |
| A-08 | CSV import is **all-or-nothing**: if any row fails validation, nothing is imported. | — |
