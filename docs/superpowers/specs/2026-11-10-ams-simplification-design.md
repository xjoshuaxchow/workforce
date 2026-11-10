# AMS simplification

Requested by Joshua on 2026-11-10. Audio approach explicitly approved in chat.

- Offer two user-facing languages: English and Cantonese. Preserve historical Mandarin records without offering new Mandarin configurations.
- Use Asia/Hong_Kong for new site defaults and all AMS date inputs/displays; remove editable timezone fields. Store instants in UTC. Do not rewrite historical instants.
- Remove Azure settings and new Azure synthesis. Preserve already pinned historical audio URLs. Old Azure configurations transition to local MP3 for new work without exposing or retaining the Azure key in new versions.
- Generate invitation MP3 automatically before sending. Users can optionally preview/edit; actual sending still requires the existing explicit send action. Failed generation leaves the request draft and sends no invitations.
- Confirmation, cancellation and generic endings use fixed texts and shared MP3. Cancellation says the arrangement was cancelled and asks staff to check WhatsApp or contact their supervisor. Invitation contains the work details.
- Cache local audio by model/version, language, speed and complete rendered content, independent of request ID. Reuse identical edited content too. Reserve generation atomically and serialize the local engine so concurrent work does not duplicate audio or fail merely because another generation is running.
- Keep an explicit consent checkbox, relabelled to explain work notifications. Remove mandatory source entry. Record administrator confirmation, timestamp and audit actor automatically, preserve historical source on unchanged records, and never opt staff in automatically.

## Approach
Use fixed shared follow-up prompts plus content-addressed invitation files. This matches the approved request and reduces generation and storage. Segment-by-segment assembly adds preparation and playback complexity; full dynamic follow-ups keep the unnecessary per-work generation the user wants removed.

## Compatibility and retention
Historical settings, plans and public audio must remain playable. Do not delete referenced audio or customer data automatically. Identical future scripts share audio. Old per-work customization is rendered safely with its matching layout; conversion of defaults must not corrupt old token positions. Shared generation is authorized through an accessible draft; public audio uses existing unguessable tokens. No actual calls/messages are part of verification.
