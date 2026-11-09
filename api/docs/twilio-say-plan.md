# Twilio Say change, 2026-11-04

The user explicitly replaced the recording-only requirement with Twilio Say after configuring live Twilio in AMS. Implement directly in the existing repositories; no worktree, staging, commits, credential changes, live sends, or development-data resets.

Use Say for all new voice attempts, including offer, confirmation, cancellation and unavailable notices. Build immutable text and voice snapshots per attempt using the employee's pinned language and the Site timezone. Keep DTMF 1/2/9 and signature/Call SID checks. Previously submitted calls with an audio snapshot continue playing that snapshot. Existing media/API records remain available for those calls. New dispatches do not require audio uploads.

Approach: generate Say TwiML directly. External synthesis and mandatory recordings add work the user has explicitly removed. Use Google.yue-HK-Standard-A / yue-HK, Google.cmn-CN-Standard-A / cmn-CN, and Google.en-GB-Standard-A / en-GB. Reference: https://www.twilio.com/docs/voice/twiml/say/text-speech . Explicit voice attributes avoid dependency on account defaults.

## Tasks

- [x] Write failing tests for trilingual Say, XML escaping, Site-local overnight dates, no-audio dispatch, signed DTMF and followups, and the replacement UI.
- [x] Add pure voice-content builder; connect buildPayload and TwiML rendering. Remove audio resolution/preflight from new sends; preserve submitted audio snapshots.
- [x] Replace upload UI with voice/language explanation. Clarify public callback field as an origin; preserve existing credentials/settings.
- [x] Run API unit/integration suites then AMS unit/build/E2E sequentially on workforce_test. Review changes, update operating docs and restart the existing development API. Verify local/public health; no real calls.

## Review focus

Wrong language or missing prompts; ambiguous midnight/DST dates; markup injection from names/messages; obsolete offers allocating after cancellation/full capacity; old call snapshots changing; credentials lost when saving existing settings. Tests must exercise actual rendered TwiML and persisted business outcomes through signed callbacks with fake provider HTTP only.

## Evidence

Saved before snapshots and test output: /private/tmp/workforce-say . Fill final results below after verification.


Final verification: API 42 unit / 132 integration passed; AMS 7 unit / 18 E2E and build passed. Read-only fresh review found one historical optional-audio-prompt regression, reproduced RED then fixed GREEN with a regression test. No other findings. Before restarting development API, pending send attempts were empty; restarted with saved twilio-pstn + WhatsApp mock. User then explicitly requested a live call to their supplied Hong Kong number; a separate one-shot Say diagnostic was placed, without creating staff, requests or shifts. Provider completion/quality verification is separate from automated results.

Live check: authorized single diagnostic completed in14seconds; user confirmed receipt. Workforce runtime verified twilio-pstn, saved token present, original ngrok origin, Cantonese Say plus DTMF, no audio dependency. No further real calls were placed.
