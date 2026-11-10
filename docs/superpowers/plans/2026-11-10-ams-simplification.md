# AMS simplification implementation plan

> Execute inline using superpowers:executing-plans. No external messages or server changes.

Goal: implement the six requested AMS improvements with reusable automatic local audio.
Architecture: normalize active configuration at the settings boundary, keep historical pinned playback, content-address local synthesis, and prepare missing audio before dispatch outside the dispatch transaction.
Tech stack: React, Node 26, Express, PostgreSQL, VITS/Piper.
Spec: ../specs/2026-11-10-ams-simplification-design.md

## Global constraints
- English/Cantonese; Asia/Hong_Kong; UTC persistence.
- Explicit send action; generation failure sends nothing.
- Preserve historical pinned audio and existing consent records.

## Review focus
- Concurrent identical synthesis and engine contention must converge to one asset.
- A site manager must not browse another site's private recordings via the admin library.
- Old saved text token counts/settings versions remain readable.
- Automatic preparation cannot send while configuration changes during preparation.
- Opt-out/unknown consent must remain ineligible for WhatsApp.

## Tasks
- [x] Add failing tests for bilingual settings, consent defaults, Hong Kong time, shared scripts and identical cross-work audio.
- [x] Normalize active configuration, simplify UI options, remove new Azure generation, default HK site creation and consent audit source.
- [x] Implement reusable fixed prompt descriptors and content-based audio reservations, preserve historical snapshots.
- [x] Prepare local audio automatically before dispatch and allow optional automatic audition without confirmation prompts. Test failure and concurrency behavior against real local test DB with a fake synthesis engine only.
- [x] Run full unit/integration suites, build AMS, inspect UI and review diff; publish the verified update through the established Git workflow.

## Execution record

- Baseline unit suite green after allowing loopback HTTP test servers.
- Red/green evidence: `/private/tmp/workforce-simplify-red.log`, `workforce-simplify-green.log`, `workforce-simplify-auto-red.log`, `workforce-simplify-auto-green.log`.
- UI preparation uses one synthesis request per file, reducing proxy timeout risk on a cold cache. Send endpoint also prepares missing audio and fails closed before creating any attempts.
- Active configuration and historical runtime profiles use distinct cache entries so normalization cannot overwrite an old call's pinned configuration.
- Existing encrypted settings/audio history is retained; no destructive cleanup added.

## Final verification

- Unit suites: root 3, AMS 18, API 75, microservice 33, all passing.
- API integration: 163 passed, 1 opt-in real-model smoke test skipped.
- Production AMS build passed.
- CUA browser acceptance against dedicated local test DB/fake synthesis: created an employee without source entry, a site without timezone input, selected local MP3 with no Azure option, created a voice-only draft, observed all six audio controls ready without clicking Generate, and used one Send action in mock mode. No real messages or calls. Screenshot: `/private/tmp/workforce-ams-simplified.jpg`.
- Review fixes: historical five-part draft editing; consistent HK dates/times in WhatsApp/Say/clips/roster and AMS warnings/audit; bilingual clip library; automatic-flow E2E selectors. Regression tests observed red then green.
- Historical audio retained. No server configuration, company data, credentials, or Meta templates changed by this implementation.
