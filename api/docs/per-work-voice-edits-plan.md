# Per-work voice editor implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Work sequentially with test-first checks and a fresh final review.

**Goal:** Let AMS users edit and regenerate one draft audio purpose while keeping other approved audio.

**Architecture:** Store request-scoped fixed-text overrides and resolve them through existing descriptors/cache/plans. Reuse provider generation and immutable published snapshots.

**Tech stack:** Node26, PostgreSQL, React.

**Spec:** `docs/per-work-voice-edits-design.md`

## Global constraints

- Dynamic values and DTMF remain automatic; work language/purpose overrides do not mutate global settings.
- Custom shared prompts use request-bound scope/assets. Legacy provider hashes stay unchanged without edits.
- No real calls, publishing, commits or worktrees. DB/E2E suites run sequentially.

## Review focus

- An in-flight old generation must never mark an edited script ready.
- Restore-default should recover the old cached asset and shared status.
- Location/date changes still update locked tokens and invalidate affected audio.
- Stale edits, changed global settings, forbidden Site access and published work must be rejected.
- Schema migration and old plans remain readable without overrides.

### Task 1: Domain and API

- [x] Write/run failing tests for single-purpose isolation, scope/privacy, restore, stale/concurrent saves, permissions and published snapshots.
- [x] Add SQL012, shared text schema, token-value rendering and request override service.
- [x] Use override descriptors consistently in preview/generation/dispatch; run unit and integration suites.

### Task 2: AMS

- [x] Add failing browser test for card-specific editing and regeneration.
- [x] Implement editable fixed parts with locked actual values, save-only/save-and-generate and restore actions.
- [x] Verify other audio assets remain unchanged; run AMS unit/build and browser checks.

### Task 3: Live verification

- [x] Fresh review/fixes; migrate development DB and verify existing draft recordings survive.
- [x] Check actual AMS shows edit controls, document operation and report completion with a screenshot.

## Ledger

- User explicitly clarified editing must be available to AMS users.
- User explicitly confirmed fixed-parts editing; dynamic values/DTMF remain automatic.
- Prior bugfix source snapshot `/private/tmp/workforce-local-tts-fix/before`; new editor baseline `/private/tmp/workforce-voice-edits/before`.

- API unit57 and integration156 passed (real-model smoke opt-in skipped in regular suite); AMS unit7/build passed. Browser suite and final live-UI evidence are logged under `/private/tmp/workforce-voice-edits`.
- Fresh review: no blocking findings. Minor save-success/refresh-failure revision recovery was fixed; browser coverage simulates that read failure then saves a further edit successfully.
- Live API confirms the existing six user-draft assets are unchanged and now expose editor metadata. Actual AMS opens the nine fixed-word fields with read-only real Site/time/DTMF values; no user text was modified in live verification.

- Final browser suite25/25 and build passed; live proof `/private/tmp/workforce-voice-edits/editor-live.png`. No real dispatch or call, and the live user draft six MP3 remain unchanged.
