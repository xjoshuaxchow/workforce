# AMS fixed speech editor

2026-11-04. User wants to edit unnatural or mispronounced fixed words in AMS while dynamic staff/site/date/time values remain automatic. Use the existing admin-only channel settings, encrypted immutable versions and stale-write protection. Work directly in the current repos, no commits/worktrees, no credential changes or real calls.

The editor presents editable fixed text fragments interleaved with locked data/DTMF tokens. This preserves every required dynamic value and key without a rich-text deletion guard or editable placeholder syntax. Use six purposes per language: offer, confirmation, cancellation, acknowledgement, no input, unavailable. Unavailable also supplies the filled call. Provide a text preview; sound audition remains a real-call action outside this change.

## Tasks

- [x] Add failing unit and API tests for custom fixed copy, preserved dynamic data, schema validation and pinned settings; add a browser case for save/reload and locked tokens.
- [x] Refactor voice-content.js to authoritative layouts/defaults and render fixed fragments. Persist optional voiceTexts in channel settings with defaults for old versions. Pass the pinned version into real and mock payload generation.
- [x] Extend AMS telephone voice tab with language/purpose selectors, fixed-text inputs, locked tokens and a live text preview. Preserve hidden config and credential omission on save.
- [x] Run API units/integration, then AMS units/build/E2E sequentially on workforce_test. Fresh read-only review. Update operating docs, restart development API after inspecting pending jobs, verify saved settings and live UI without sending calls.

## Contract and checks

`voiceTexts[language][purpose]` is a fixed-length array of plain strings, exactly one more than the authoritative layout's token count. Segment and total length limits, nonempty content and exact keys are parsed at the settings boundary. `defaultVoiceTexts()` returns independent objects; `buildVoiceContent(purpose, staff, site, request, voiceTexts)` renders only its own layout. Arbitrary text is escaped by the existing Say builder.

Old settings versions retain default text, new saves create a new version. queueAttempt already pins offer settings and followups inherit them. The adapter passes that version's text to prepareAttempt; callbacks use persisted voice_calls.payload. No mutation of existing call snapshots or dynamic values.

Review focus: blank prompt, invalid segment count, wrong-language bleed, hidden secrets lost, old-client omission resetting text, settings changed between enqueue and worker, followup inheriting wrong version, XML injection, stale administrator saves, mock accidentally becoming live. Test logs and before snapshots: /private/tmp/workforce-voice-text .


Final evidence: API 44 unit and137 integration passed; AMS7 unit,19E2E and production build passed. Fresh review found XML-invalid characters could enter saved copy; reproduced200 instead of400, then added XML1.0 validation at the settings boundary and proved controls/lone surrogates reject while newline/tab/emoji remain valid. Historical encrypted settings were tested without voiceTexts and remain unchanged on read. No other material findings.

Development API restarted after verifying no pending send attempts. Persisted settings version and encrypted-config SHA256 matched before/after. Live AMS opened to Cantonese offer editor, no words/configurations saved on the user's behalf and no real calls made. Screenshot: /private/tmp/workforce-voice-text/live-editor.png .
