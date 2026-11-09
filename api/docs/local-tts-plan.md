# Local TTS Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Follow each test-first task sequentially; run a fresh final review.

**Goal:** Use approved local Cantonese and English voices for reusable full MP3 notifications.

**Architecture:** Extend the existing versioned synthesis cache with a local provider. Keep immutable dispatch snapshots and Twilio DTMF. Run bounded CPU inference in a private Python environment.

**Tech Stack:** Node 26, PostgreSQL, React, Python 3.9+, sherpa-onnx, OpenCC, lameenc.

**Spec:** `docs/local-tts-design.md`

## Global constraints

- No real calls, cloud synthesis, commits, global installs or worktrees.
- Preserve Azure hash compatibility and pending/historical snapshots.
- Only local Cantonese and English; unsupported staff languages block dispatch.
- Reuse complete MP3, shared endings and current access/version checks.

## Review focus

- Traditional Cantonese variants, dates/numbers and unknown lexicon entries must not silently disappear.
- Provider/speed changes must not reuse incompatible audio.
- Local process failure or overload must release reservation and permit an explicit retry without billing warnings.
- Old settings clients must not erase new local settings.
- Workers/callbacks must play pinned files without generating speech or falling back to Say.

### Task 1: Provider and installation

- [x] Write and run failing unit tests for local descriptors, unsupported language and bounded adapter inputs.
- [x] Implement descriptor hashes, local child-process adapter, reproducible installer and Python worker.
- [x] Install both models and produce/validate real Cantonese and English MP3.
- [x] Run unit suite; record measured install sizes and normalization behavior.

### Task 2: Versioned API and dispatch

- [x] Add failing integration tests for local settings/cache, stale script/speed, failures and pinned Play/DTMF.
- [x] Extend settings defaults/schema/status, synthesis route and plan resolution with local mode.
- [x] Run all API unit and integration tests sequentially against the dedicated test database.

### Task 3: AMS and activation

- [x] Add failing browser coverage for local settings, generation, preview and cost-free retry wording.
- [x] Share full-file UI across providers, expose local speed/status and preserve existing Azure controls.
- [x] Run AMS unit tests, build and browser suite; inspect rendered UI and real generated audio.
- [x] Fresh review and fixes, then activate local mode in saved development settings preserving credentials and historical jobs.

## Execution ledger

- Baseline snapshot: `/private/tmp/workforce-local-tts/before`, excludes credentials/models.
- User approved VITS Cantonese after audition and Piper English in the async reply.
- Ruling: keep output MP3 using a small local encoder to honor the earlier complete-MP3 requirement; WAV is only the audition format.
- Ruling: proceed with the already approved engine and full-file workflow; no repeated design confirmation or commit/worktree ceremony.

- Final evidence: API unit55; integration152 passing plus separately opted-in real-model smoke1; AMS unit7/build/browser25 and final local-browser recheck2; Python normalization6/installer1. Logs and real audio: `/private/tmp/workforce-local-tts/`.
- Review fixes: preserve leading zeros, reject unsupported semantic symbols and non-Latin English input, bump normalization hash version; fresh recheck reports no important defects. Seeded auxiliaries now verify upstream Git blob identity and copy atomically.
- Runtime correction: sherpa 2 removed the built-in Piper frontend; pinned 1.12.35. Final runtime plus both models is approximately306 MB.
- Activation: saved development mode `local-mp3`, speed1, revision `4d791968-228a-4885-9577-d5e8342b42ce`; asserted unchanged Twilio/WhatsApp/Azure credentials, voice texts and readable old version. No real call.
