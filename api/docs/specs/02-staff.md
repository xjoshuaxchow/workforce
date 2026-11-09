# 02 — Staff Management

## Staff record

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `name` | string | yes | 1–100 chars, trimmed |
| `mobile` | E.164 | yes | **Unique** across all staff (including inactive) |
| `landline` | E.164 | no | |
| `language` | string | yes | ISO 639-1 code, default `en` |
| `preferred_channel` | enum | yes | `whatsapp` \| `voice`, default `whatsapp` |
| `status` | enum | yes | `active` \| `on_leave` \| `blocked` \| `inactive`, default `active` |
| `whatsapp_opt_in` | boolean | yes | default `false` |
| `whatsapp_opt_in_at` | timestamp | when opt-in is true | |
| `whatsapp_opt_in_source` | string | when opt-in is true | e.g. `paper_form`, `whatsapp_reply`, `import` |

**Contactable rule (used by requests and roster notifications)**

| Channel | Staff is contactable when |
|---------|---------------------------|
| WhatsApp | `status = active` AND `whatsapp_opt_in = true` |
| Voice | `status = active` AND (`mobile` or `landline` present). Calls go to `mobile`; `landline` is used only if the request explicitly targets landline (P1). |

## S-01 Create / Edit / Deactivate Staff

**Test level:** Integration (Admin only — see A-01)

| ID | Given | When | Then |
|----|-------|------|------|
| AC-S-01-01 | Admin | Creates staff with name + mobile only | `201`; defaults applied: language `en`, channel `whatsapp`, status `active`, opt-in `false` |
| AC-S-01-02 | Admin | Creates staff with no name | `400` field `name` |
| AC-S-01-03 | Admin | Creates staff with name of only spaces | `400` field `name` |
| AC-S-01-04 | Staff with mobile `+6591234567` exists | Admin creates another staff with mobile `+65 9123-4567` | `409` duplicate mobile (normalised before comparing) |
| AC-S-01-05 | Inactive staff with mobile X exists | Admin creates new staff with mobile X | `409` (uniqueness includes inactive) |
| AC-S-01-06 | Admin | Edits staff name | `200`; audit log has before/after |
| AC-S-01-07 | Admin | Deactivates staff | Status becomes `inactive`; record is still readable |
| AC-S-01-08 | Site manager | Calls create / edit / deactivate | `403` |
| AC-S-01-09 | Staff has a future confirmed shift | Admin deactivates them | Deactivation succeeds **and** response includes a warning listing the future shifts (shifts are not auto-cancelled) |

## S-02 Staff Profile Fields

**Test level:** Unit (validation) + Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-S-02-01 | — | Mobile `91234567` with no country code | `400` (must include country code) |
| AC-S-02-02 | — | Mobile `+65 9123 4567` | Stored as `+6591234567` |
| AC-S-02-03 | — | Mobile `hello` | `400` field `mobile` |
| AC-S-02-04 | — | `preferred_channel = sms` | `400` (not supported in P0) |
| AC-S-02-05 | — | `language = english` | `400` (must be ISO 639-1 code) |
| AC-S-02-06 | — | Landline omitted | Accepted; landline is `null` |

## S-03 Staff Status

**Test level:** Unit + Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-S-03-01 | Active staff | Status set to `on_leave` | Saved; staff is excluded from new request candidates |
| AC-S-03-02 | Staff `blocked` | Candidates are generated for a request | Staff is excluded |
| AC-S-03-03 | Staff `inactive` | Candidates are generated | Staff is excluded |
| AC-S-03-04 | Staff becomes `on_leave` while a request is already being sent | Next attempt for that staff is due | Attempt is not sent; candidate status becomes `skipped` with reason `staff_not_active` |
| AC-S-03-05 | — | Status set to `deleted` | `400` invalid status |

## S-04 WhatsApp Opt-in

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-S-04-01 | Staff with opt-in false | Admin sets opt-in true with source `paper_form` | Saved; `whatsapp_opt_in_at` = now |
| AC-S-04-02 | — | Admin sets opt-in true **without** a source | `400` field `whatsapp_opt_in_source` |
| AC-S-04-03 | Staff opted in | Admin sets opt-in false | Saved; opt-in timestamp kept in audit log; staff no longer WhatsApp-contactable |
| AC-S-04-04 | Staff opt-in false, active | Contactability is checked | WhatsApp: no; Voice: yes |

## S-05 Bulk Import Staff (CSV)

**Test level:** Integration

**Format**
- Header row required. Columns: `name, mobile, landline, language, preferred_channel, whatsapp_opt_in, whatsapp_opt_in_source`.
- Only `name` and `mobile` must have values; others use defaults.
- Max 5,000 rows; max file size 5 MB.
- Create-only in P0: an existing mobile is an error (no update).
- All-or-nothing (A-08).

| ID | Given | When | Then |
|----|-------|------|------|
| AC-S-05-01 | Valid CSV with 3 rows | Admin imports | `200`, 3 staff created, response `{ created: 3 }` |
| AC-S-05-02 | CSV where row 2 has invalid mobile | Admin imports | `400`, nothing created, errors `[{ row: 2, field: "mobile", message }]` |
| AC-S-05-03 | CSV with the same mobile on rows 1 and 3 | Admin imports | `400`, error on row 3 "duplicate in file" |
| AC-S-05-04 | Mobile on row 1 already exists in DB | Admin imports | `400`, error on row 1 "already exists" |
| AC-S-05-05 | CSV missing the `mobile` column | Admin imports | `400` "missing required column: mobile" |
| AC-S-05-06 | CSV with extra unknown column | Admin imports | Unknown column ignored; import succeeds |
| AC-S-05-07 | CSV with 5,001 rows | Admin imports | `400` too many rows |
| AC-S-05-08 | Row has `whatsapp_opt_in = true` and empty source | Admin imports | Source defaults to `import` |
| AC-S-05-09 | Site manager | Imports | `403` |

## S-06 Search & Filter Staff

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-S-06-01 | Staff "Anna Lee", "Ben Tan" | Search `anna` | Returns Anna Lee (case-insensitive, partial match) |
| AC-S-06-02 | Staff with mobile `+6591234567` | Search `9123` | Returns that staff (matches mobile digits) |
| AC-S-06-03 | Staff linked to S1 and S2 | Filter `site=S1` | Only staff linked to S1 |
| AC-S-06-04 | Mixed statuses | Filter `status=active` | Only active staff |
| AC-S-06-05 | Default list | No status filter | Excludes `inactive` staff |
| AC-S-06-06 | 120 staff | List with no page params | 50 returned, `total = 120` |
| AC-S-06-07 | Site manager (S1 only) | Filter `site=S2` | Empty list (cannot see S2-only staff) |
