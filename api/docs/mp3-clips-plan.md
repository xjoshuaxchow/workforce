# MP3 clips implementation plan

> Execute inline with superpowers:executing-plans. User selected prerecorded fragments and generic greeting; no more approval gate. Preserve the established no commit/worktree preference.

**Goal:** Add a usable MP3 fragment library, draft preview and validated dispatch without TTS.

**Architecture:** Pure catalog and manifest in voice-clips.js, DB resolution in voice-clip-service.js, immutable settings mappings, existing immutable audio assets. Extend the existing TwiML renderer to Play arrays.

**Tech Stack:** Node 26, Express, PostgreSQL, React, Playwright.

**Spec:** docs/mp3-clips-design.md

## Constraints

- Keep current live settings and credentials unchanged; no actual calls.
- No TTS fallback in clips mode; preserve legacy Say and single audio snapshots.
- DB integration and browser E2E sequential on isolated workforce_test.

## Review focus

- DST repeated clocks and Site-local year rollover need correct UTC offset and both dates.
- Changed Site address needs a new mapping; archived audio must still serve queued work.
- WhatsApp-only offers may need voice confirmation after opt-out.
- Nonempty message needs its own language recording; no staff name recordings.
- Stale settings saves and dispatch mapping must use one locked version.

## Tasks

- [x] 1. RED/GREEN pure manifest tests for midnight, leap day, English date ordering, DST, generic greeting and multiple Play inside Gather. Implement catalog + manifest.
- [x] 2. RED/GREEN integration tests for library validation, missing preflight preserving draft, message upload, snapshot pinning and signed DTMF. Implement resolver, settings, runtime, preview and migration.
- [x] 3. RED/GREEN browser tests for upload/mapping/save/reload and draft missing list/preview. Implement settings library and request panel.
- [x] 4. Run unit, integration, E2E and build; fresh read-only review, address findings, document setup and restart local API safely.

## Ledger

Pre-flight: resolver consumes manifest keys; runtime passes pinned config to prepareAttempt. Preview shares resolver. UI consumes catalog metadata from admin endpoint and request previews.
Ruling: ordered Play clips are the composition method. This avoids an external encoder dependency and supports uploaded MP3s of differing formats, with possible short playback gaps.

Task 1 complete: three new unit cases observed RED then GREEN. Unit suite 47/47.
Task 2 complete: missing recording preflight preserved draft; language validation, optional message upload, immutable plans after Site/address/settings/archive changes, recorded 1/2/9/no-input callbacks exercised. WhatsApp-only requirements and ineligible preview filtering observed RED then GREEN. Integration 142/142.
Task 3 complete: real upload, mapping/save/reload, missing lists, message upload, complete queue preview and /media HTTP200 verified in browser. Browser screenshots visually inspected. Initial stale upload notice after saving corrected.
Task 4 complete: AMS unit7/7, browser21/21, production build passed. Fresh read-only review found one P2: WhatsApp-only request panel was hidden despite voice-followup preflight. New E2E observed RED, panel rendered for all requests with fallback explanation, full21 GREEN. Reviewer rechecked and reported no remaining important findings.

Evidence: `/private/tmp/workforce-mp3-clips/` includes original source snapshots, RED/GREEN logs, final unit/integration/browser/build logs, library and draft screenshots. API8310 restarted with empty pending-attempt list. Active settings version and encrypted checksum unchanged, content remains say, no development recordings created. API health, AMS and new JSX module returned HTTP200; additive request_voice_plans table confirmed. No real calls, synthesis, commit, staging, push or Core changes. Human recordings and live Twilio multi-clip quality remain for subsequent explicitly authorized testing.
