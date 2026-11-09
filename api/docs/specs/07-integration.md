# 07 — Integration with Company Messaging Microservice

> This contract is **our proposal**. Confirm it with the Messaging Service team (open questions Q1–Q4) before writing contract tests. If their real API differs, write an adapter on our side so the rest of the system keeps this shape.

## I-01 Send API

**Test level:** Contract (against mock) + Unit (adapter)

**Request** — `POST {MESSAGING_URL}/send`

```json
{
  "correlation_id": "att_01J...",
  "channel": "whatsapp",
  "to": "+6591234567",
  "language": "en",
  "template": "shift_offer_v1",
  "variables": { "staff_name": "Anna", "site_name": "North Depot", "date": "Mon 3 Nov 2026", "start_time": "07:00", "end_time": "15:00", "message": "" },
  "options": [ { "id": "ACCEPT", "label": "Yes", "dtmf": "1" }, { "id": "DECLINE", "label": "No", "dtmf": "2" } ],
  "voice": { "script": "Hello Anna ...", "repeat_dtmf": "9" }
}
```

- `options` omitted for info-only messages (follow-ups).
- `voice` present only when `channel = voice`.

**Response:** `202 { "external_id": "msg_123" }`

**Failure handling (P0)**

| Messaging Service result | Our action |
|--------------------------|------------|
| `202` | Attempt `sent`, store `external_id` |
| `4xx` | Attempt `failed` with the error; no retry |
| `5xx` or timeout (10 s) | Job retried up to 3 times with backoff (5 s, 30 s, 2 min); then attempt `failed` |

| ID | Given | When | Then |
|----|-------|------|------|
| AC-I-01-01 | Queued WhatsApp offer | Send job runs | Mock receives a request matching the shape above |
| AC-I-01-02 | Mock returns `202` | — | Attempt `sent`, `external_id` stored |
| AC-I-01-03 | Mock returns `400` | — | Attempt `failed`, not retried |
| AC-I-01-04 | Mock returns `503` twice then `202` | — | Attempt `sent` after 3rd try |
| AC-I-01-05 | Mock returns `503` four times | — | Attempt `failed` |
| AC-I-01-06 | Same `correlation_id` sent twice (job retried after a timeout that actually succeeded) | — | We send the same `correlation_id` so the service can de-duplicate |
| AC-I-01-07 | Attempt is `cancelled` before the job runs | Job runs | Nothing is sent |

## I-02 Receive Events

**Test level:** Integration

**Endpoint** — `POST /integrations/messaging/events`

```json
{
  "event_id": "evt_789",
  "correlation_id": "att_01J...",
  "external_id": "msg_123",
  "type": "sent | delivered | read | failed | answered | no_answer | busy | completed | reply",
  "option_id": "ACCEPT",
  "text": null,
  "reason": null,
  "occurred_at": "2026-11-02T01:23:45Z"
}
```

**Response:** `200` once stored (processing may be async). `400` for malformed body. `401` for bad signature.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-I-02-01 | Valid signed event | Posted | `200`; event stored; attempt updated |
| AC-I-02-02 | Body missing `event_id` or `type` | Posted | `400` |
| AC-I-02-03 | Unknown `type` | Posted | `200`; stored; no state change |
| AC-I-02-04 | Events arrive out of order (`reply` before `delivered`) | Both posted | Final attempt status `replied` |

## I-03 Event Authenticity

**Test level:** Integration

**Rule:** Header `X-Signature = HMAC-SHA256(secret, X-Timestamp + "." + raw_body)` (hex). Header `X-Timestamp` (unix seconds) must be within 5 minutes of now.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-I-03-01 | Correct signature, fresh timestamp | Posted | `200` |
| AC-I-03-02 | Wrong signature | Posted | `401` |
| AC-I-03-03 | Missing signature header | Posted | `401` |
| AC-I-03-04 | Correct signature, timestamp 6 minutes old | Posted | `401` (replay protection) |
| AC-I-03-05 | Body changed after signing | Posted | `401` |

## I-04 Mock Messaging Service

**Test level:** — (test tooling; it is itself unit-tested)

**Must provide**
- Implements `POST /send` with the shape in I-01.
- Records every received request; tests can read them (`GET /_mock/sent`, or an in-process API).
- Can be programmed to return a status per call (`202`, `400`, `503`, timeout).
- Can emit signed events to our endpoint on command: `emit(correlation_id, type, { option_id })`.
- Optional "auto" mode for local dev: auto-emits `sent → delivered → read` after a delay.
- Dashboard dev page (local only) to click "Reply Yes / No" or "Press 1 / 2" for any sent attempt.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-I-04-01 | Mock running | Our system sends 2 messages | `sent` list has 2 entries |
| AC-I-04-02 | Mock programmed: next call returns `503` | Our system sends | Receives `503` |
| AC-I-04-03 | — | `emit(att_1, "reply", { option_id: "ACCEPT" })` | Our endpoint receives a correctly signed event |
| AC-I-04-04 | Mock reset between tests | — | `sent` list is empty |
