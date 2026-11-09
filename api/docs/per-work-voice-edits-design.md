# Per-work voice text editing

The user wants AMS users to adjust an individual generated MP3, rather than asking a developer or regenerating every audio file. The user explicitly confirmed fixed wording only; Site location, dates/times, message and DTMF digits remain system-filled.

Each draft audio card gets 修改這段講稿, with fixed text fields interleaved with the actual locked dynamic values. Save or save-and-generate changes only this work, language and purpose. Restore-default removes the override and reuses the original recording if cached. Other work audio and other purposes keep their hashes/assets. A custom shared ending becomes request-scoped, so it cannot change any other work or expose its text as a global asset.

## Data and ownership

- Add `request_voice_texts` keyed by request/language/purpose, storing fixed parts, a UUID revision, actor and time.
- A shared fixed-parts schema enforces the existing 400 characters per part, 1200 combined, locked part count, nonblank and valid text constraints.
- A text service loads overrides, renders descriptors through the existing provider-specific hash logic, and registers draft-only PATCH `/api/requests/:id/voice-text`.
- PATCH accepts language, purpose, expectedHash, expectedTextRevision and parts; null parts restores defaults. Lock request, active settings and Site in the existing order. Check Site permission and optimistic revision/hash before writing; audit the change. No synthesis or phone call occurs in PATCH.
- Synthesis preview, generation and dispatch all use the same override resolver. A generation started before an edit may finish saving its old hash, but cannot become the current script or satisfy dispatch readiness. Published jobs continue using pinned plans and refuse text edits.
- Descriptors expose current parts, actual locked token values, customized flag and text revision. Their audio hash still depends on actual rendered script/provider/speed/scope, not the edit revision.

## Alternatives

Global template edits already exist but affect other new work and cannot solve a one-off reading. Free-form full-script replacement risks stale embedded work data and contradicts the earlier dynamic-data constraint; defer it unless the user chooses that scope. Fixed-parts overrides retain automatic Site/date rendering and need no stale embedded-data repair mechanism.

## Validation

Tests must prove one changed purpose invalidates only its audio, other recordings stay reusable, customized shared endings remain private to their work, restore reuses defaults, concurrent/stale saves fail, malformed parts cannot alter dynamic tokens, Site access and post-dispatch editing are blocked, and pending old generation cannot satisfy the updated script. Browser coverage edits one card, regenerates only that card, plays it and restores the cached default.

No commits/worktrees, cloud synthesis, real dispatch or calls. Baseline `/private/tmp/workforce-voice-edits/before/{api,ams}`. The preceding floor/GMT fix is complete: actual user draft six MP3 ready, API unit57/integration152, Python7 and local browser2 passed; independent review found no important issue. Public MP3 download verified against local bytes.
