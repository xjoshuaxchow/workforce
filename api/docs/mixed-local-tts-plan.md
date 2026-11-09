# Mixed local speech implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session with test-first steps and one fresh final reviewer.

**Goal:** Natural English phrases inside Cantonese MP3 plus independent English audition and Site spoken aliases.

**Architecture:** Reuse installed VITS/Piper and existing complete-file cache. Add optional Site aliases and an explicit preview-only API path, keeping dispatch employee-driven.

**Tech stack:** Python/sherpa-onnx/NumPy/LAME, Node26/PostgreSQL/React.

**Spec:** `docs/mixed-local-tts-design.md`

## Constraints and review focus

- Keep `tech nine` one English phrase and `28/F` Cantonese; preserve acronym spelling and number meaning.
- Never use an audition language for actual dispatch; preserve historical pinned files.
- Missing English address or Chinese supplement must produce an actionable issue, not silently omitted text.
- English field omission in old clients must preserve values. Site aliases must not invalidate Cantonese recordings on their own.
- One complete MP3, bounded resources, no new model download/cloud/real call/commit/worktree.

### Task 1: Mixed speech
- [x] Add failing segmentation/PCM tests; implement phrase routing and one-file encoding.
- [x] Produce a real mixed audition and verify MP3 bytes/duration.

### Task 2: Site aliases and preview API
- [x] Add failing domain/integration tests for aliases, independent audition, missing data and employee-driven dispatch.
- [x] Add SQL013, Site schema/create/update, alias descriptor rendering and preview-only route handling.
- [x] Run API unit/integration suites sequentially.

### Task 3: AMS and final verification
- [x] Add failing browser coverage, Site fields and audition selector with blocking hints.
- [x] Run AMS unit/build/browser checks, fresh review/fixes and real two-language audio check.
- [x] Verify live Site/draft UI, update docs and report concrete operation with screenshot/audio.

## Ledger
- User explicitly approved all three items in the prior proposal.
- Baseline `/private/tmp/workforce-mixed-tts/before/{api,ams}` excludes credentials/models.
- Existing services run independently with logs under API/AMS `.local`; verify live API metadata, not only disk imports, before completion.
- Verification: Python 10/10; API unit 58/58; integration 158 passed and 1 opt-in real-engine skip; AMS unit 7/7, build and browser 26/26. Fresh reviewer approved after stale preview-response and preview-only wording fixes. Both delayed reload and publish-with-English-selected regressions failed before fixes and passed in the full browser suite.
- Live draft regenerated all six Cantonese files using the mixed-v4 cache identity; offer is 66,351 bytes. Public ngrok retrieval returned 200 audio/mpeg with identical SHA256. No real call or dispatch performed. English preview correctly flags the original Chinese address and literal supplement「沒有」; source data left for the user to edit.
- Artifacts: `/private/tmp/workforce-mixed-tts/{mixed.mp3,offer-current.mp3,english-preview-live.png,samples/}` and verification logs in the same directory.
