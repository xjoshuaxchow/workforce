# 03 — Sites & Site ↔ Staff Linkage

## Site record

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `code` | string | yes | Unique, 2–20 chars, uppercase letters/digits/dash. Used in CSV imports. |
| `name` | string | yes | 1–100 chars, unique among active sites |
| `address` | string | no | |
| `timezone` | IANA tz | yes | e.g. `Asia/Singapore`; must be a valid IANA name |
| `status` | enum | yes | `active` \| `inactive`, default `active` |

## SI-01 Create / Edit / Deactivate Sites

**Test level:** Integration (Admin only)

| ID | Given | When | Then |
|----|-------|------|------|
| AC-SI-01-01 | Admin | Creates site with code, name, timezone | `201`, status `active` |
| AC-SI-01-02 | Site with code `NORTH` exists | Admin creates another with code `north` | `409` (codes compared uppercase) |
| AC-SI-01-03 | Admin | Creates site with code `a b` | `400` field `code` |
| AC-SI-01-04 | Admin | Deactivates site | Status `inactive`; existing data readable |
| AC-SI-01-05 | Site is inactive | Anyone creates a request or shift there | `409` "site is inactive" |
| AC-SI-01-06 | Site has open requests | Admin deactivates site | `409` "site has open requests" — cancel them first |
| AC-SI-01-07 | Site manager | Creates / edits a site | `403` |

## SI-02 Site Profile — Timezone

**Test level:** Unit + Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-SI-02-01 | — | Timezone `Mars/Base` | `400` field `timezone` |
| AC-SI-02-02 | Site in `Asia/Singapore` (UTC+8) | A shift is entered as 07:00 local | Stored as 23:00 UTC previous day; displayed as 07:00 |
| AC-SI-02-03 | Site with shifts | Admin changes the timezone | `409` if the site has future shifts or open requests (avoid silently moving times) |

## L-01 Link / Unlink Staff to Sites

**Test level:** Integration (Admin only — A-01)

**Rules**
- Many-to-many. A link is `{ site_id, staff_id, active, linked_at }`.
- Unlink = set `active = false` (soft).

| ID | Given | When | Then |
|----|-------|------|------|
| AC-L-01-01 | Staff A, site S1 | Admin links A to S1 | Link exists, active |
| AC-L-01-02 | A already linked to S1 | Admin links again | No duplicate; `200` (idempotent) |
| AC-L-01-03 | A linked to S1 | Admin unlinks | Link inactive; A is no longer a candidate for S1 requests |
| AC-L-01-04 | A unlinked from S1 | Admin links again | Same link reactivated |
| AC-L-01-05 | A has future shifts at S1 | Admin unlinks | Succeeds with warning listing those shifts (not cancelled) |
| AC-L-01-06 | Inactive site | Admin links staff | `409` |
| AC-L-01-07 | Site manager | Links / unlinks | `403` |

## L-02 View Staff by Site / Sites by Staff

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-L-02-01 | A, B linked to S1; C unlinked | List staff of S1 | [A, B] |
| AC-L-02-02 | A linked to S1, S2 | List sites of A | [S1, S2] |
| AC-L-02-03 | Site manager of S1 | Lists staff of S1 | Allowed |
| AC-L-02-04 | Site manager of S1 | Lists staff of S2 | `404` |

## L-03 Bulk Link

**Test level:** Integration

**Format:** CSV columns `site_code, staff_mobile`. All-or-nothing (A-08). Also an API that accepts `{ site_id, staff_ids: [] }`.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-L-03-01 | Valid CSV, 4 rows | Admin imports | 4 links created; response `{ linked: 4, already_linked: 0 }` |
| AC-L-03-02 | Row with unknown site code | Admin imports | `400`, error on that row, nothing linked |
| AC-L-03-03 | Row with unknown mobile | Admin imports | `400`, error on that row, nothing linked |
| AC-L-03-04 | Some rows already linked | Admin imports | Succeeds; they are counted in `already_linked` |
| AC-L-03-05 | Admin | Multi-select 10 staff → link to S1 | 10 links created in one transaction |
