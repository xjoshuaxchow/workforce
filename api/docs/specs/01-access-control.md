# 01 — Users & Access Control

## U-01 Login

**Test level:** Integration

**Rules**
- Login with email (case-insensitive) + password.
- Passwords are stored hashed (never plain text).
- Successful login returns a session/token; all other API endpoints require it.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-U-01-01 | An active user `a@x.com` with password `P` | They log in with `A@X.com` / `P` | Login succeeds and a session token is returned |
| AC-U-01-02 | An active user | They log in with a wrong password | `401`, generic message "Invalid email or password" (does not reveal which was wrong) |
| AC-U-01-03 | No user with email `z@x.com` | Someone logs in as `z@x.com` | `401`, same generic message as AC-U-01-02 |
| AC-U-01-04 | A deactivated user | They log in with correct credentials | `401` |
| AC-U-01-05 | No token | Any protected endpoint is called | `401` |
| AC-U-01-06 | A user is created | The DB record is read | The password field is a hash, not the plain password |
| AC-U-01-07 | A logged-in user | They log out | Their token no longer works (`401`) |

## U-02 Roles

**Test level:** Unit (permission function) + Integration

**Rules**
- Every user has exactly one role: `admin` or `site_manager`.
- Admin can do everything.
- Site Manager permissions are defined in U-04 / U-05.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-U-02-01 | A user is created without a role | — | `400` (role required) |
| AC-U-02-02 | A user is created with role `superuser` | — | `400` (invalid role) |
| AC-U-02-03 | An admin | They call any endpoint for any site | Allowed |
| AC-U-02-04 | A site manager | They call an admin-only endpoint (create staff, create site, manage users, manage linkage) | `403` |

## U-03 Assign Site Managers to Sites

**Test level:** Integration

| ID | Given | When | Then |
|----|-------|------|------|
| AC-U-03-01 | Admin, site manager M, sites S1, S2 | Admin assigns M to S1 and S2 | M's site list = [S1, S2] |
| AC-U-03-02 | M assigned to S1 | Admin assigns M to S1 again | No duplicate; still [S1] (idempotent) |
| AC-U-03-03 | M assigned to S1, S2 | Admin removes S2 | M's site list = [S1] |
| AC-U-03-04 | A site manager | They try to assign themselves to a site | `403` |
| AC-U-03-05 | An admin user | Admin tries to assign sites to them | `400` (site assignment only applies to site managers) |

## U-04 Site-scoped Requests & Roster

**Test level:** Integration

**Rules**
- A site manager can list, view, create, change and cancel requests and shifts **only** for sites they are assigned to.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-U-04-01 | M assigned to S1; requests exist for S1 and S2 | M lists requests | Only S1 requests are returned |
| AC-U-04-02 | M assigned to S1 | M opens a request of S2 by ID | `404` (do not reveal it exists) |
| AC-U-04-03 | M assigned to S1 | M creates a request for S2 | `403` |
| AC-U-04-04 | M assigned to S1 | M creates / edits / cancels a shift at S2 | `403` |
| AC-U-04-05 | M was assigned to S1, then removed | M lists requests | S1 requests are no longer returned |

## U-05 Site-scoped Staff Visibility

**Test level:** Integration

**Rules**
- A site manager sees staff linked to **at least one** of their sites.
- When a site manager views a staff member's roster, shifts at sites they do not manage are shown only as `busy` with start/end time — no site name, no notes.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-U-05-01 | M assigned to S1; staff A linked to S1, B linked only to S2 | M lists staff | A is returned, B is not |
| AC-U-05-02 | Same as above | M opens B by ID | `404` |
| AC-U-05-03 | A linked to S1 and S2; A has a shift at S2 | M (S1 only) views A's roster | The S2 shift appears as `{ type: "busy", start, end }` with no site details |
| AC-U-05-04 | A linked to S1 only | Admin unlinks A from S1 | M can no longer see A |
