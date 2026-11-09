# Azure MP3 implementation plan

> Execute inline, following test-driven-development and verification-before-completion. User selected provider and workflow; no extra approval gate. No git commit/worktree, matching established preference.

**Goal:** Generate and cache full MP3s per work/language/purpose, then reuse across phone calls.
**Spec:** docs/azure-mp3-design.md
**Architecture:** Pure shared script/hash descriptors, bounded Azure REST client, durable synchronous synthesis service, existing immutable assets/plans and TwiML renderer.

## Tasks

- [x] 1. RED/GREEN script/hash/REST client tests. Implement azure-speech.js and voice-synthesis-content.js.
- [x] 2. RED/GREEN settings secrecy, durable dedup/concurrency, unknown retry and preflight/playback integration. Implement schema, service/routes and runtime.
- [x] 3. RED/GREEN AMS settings and complete-file preview/generation flow. Implement UI, preserving Say and manual fragments.
- [x] 4. All API/AMS tests and build, independent read-only review, docs, safe local restart and encrypted settings checksum verification.

## Review focus

- Concurrent or lost generation responses must not trigger automatic duplicate spending.
- Azure errors and audit never contain Key; endpoints cannot be redirected to leak credentials.
- Current hash reflects Site/voice/text changes; old dispatch stays pinned.
- Cross-Site preview remains authorized; unsupported languages do not silently use English.
- WhatsApp-only followups, common prompt reuse and unconfigured Key produce usable UI states.

## Ledger

Interfaces: shared descriptors -> synthesis status/ready cache -> request_voice_plans -> recordedVoice -> existing Play renderer. Settings public config provides only keyConfigured, Region, selected voice. Browser consumes preview rows and POST language/purpose/generation.
Ruling: synchronous per-file generation, explicitly triggered. Keeps phone and worker paths free of synthesis calls. Unknown submissions need an explicit versioned retry.

Ruling: user clarified private account first, company account later. Key and Region are both excluded from cache identity. Changing either preserves saved MP3s, including successful generations completed during a settings change.

Task1 complete: three unit tests observed RED then GREEN; all50 API unit tests passed. Azure regional endpoint, escaped SSML, MP3 headers, bounded response, error classification and no provider response-body secrets.
Task2 complete: all148 API integration tests passed. New cases cover partial config, Key redaction/preservation, wrong Region/voice validation, concurrent reservation, same-asset reuse, in-flight credentials replacement, stale expectedHash, Site authorization, unknown versioned retry, cached shared prompts and single-Play pinned dispatch.
Task3 complete: new browser flow observed RED then GREEN. English full MP3 UI generates six artifacts with fake Azure, previews audio MIME200, reuses artifact after company Key/Region replacement. Unknown-result UI confirms possible extra spend before retry; no automatic submission on refresh. Test helpers wait for login and refresh externally mutated settings revisions.

Fresh independent review found one P2: completion locked synthesis before its request FK lock, reversing reservation order. Deterministic Postgres regression held request and tested synthesis NOWAIT, observed RED then GREEN. Completion now takes request KEY SHARE before synthesis FOR UPDATE. Reviewer rechecked and reported no remaining important findings.

Task4 complete: final API50/50 unit,148/148 integration; AMS7/7 unit,23/23 browser, production build passed. The first unknown-result browser test had fixture races at login and an API-updated configuration revision; helpers now wait for login and refresh that external change. The final bare browser suite passed23/23.

Local runtime started with pending attempts empty. API/AMS/new Azure UI module HTTP200; current encrypted settings version/hash unchanged, still Say, Azure Key absent and synthesis rows0. No real Azure requests or calls. Evidence, original snapshots, logs and visually inspected screenshots are in `/private/tmp/workforce-azure-mp3/`. No git staging/commit/push, Core changes or account registration. Real Azure credentials, voice quality and live multi-recipient calls remain untested until user supplies their own account via AMS.
