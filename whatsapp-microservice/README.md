# WhatsApp microservice

A TypeScript and Express.js 5 service for one WhatsApp business number. It uses PostgreSQL through `pg`, handwritten SQL, and versioned SQL migrations. It stores incoming and outgoing messages, delivery history, batch results, templates, and media metadata. Media files live in a persistent Docker volume.

## Start the service

Install Docker with the Compose plugin, then copy the example settings:

```bash
cp .env.example .env
```

Fill in your Meta integration settings in `.env`:

| Setting                         | Value                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `META_APP_ID`                   | Your Facebook/Meta application ID.                                                            |
| `META_APP_SECRET`               | App secret used to verify Meta webhook signatures.                                            |
| `META_GRAPH_API_VERSION`        | An explicit supported version for your Meta app, such as `v25.0`.                             |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`  | Your WhatsApp Business Account ID (WABA).                                                     |
| `WHATSAPP_PHONE_NUMBER_ID`      | Meta's phone-number **ID**, not the displayed telephone number.                               |
| `WHATSAPP_ACCESS_TOKEN`         | Access token with WhatsApp messaging and management permissions.                              |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | A verification string you choose and also enter in Meta's webhook configuration.              |
| `INBOUND_WEBHOOK_URL`           | Optional HTTPS endpoint in your application for new incoming messages.                        |
| `INBOUND_WEBHOOK_SECRET`        | Shared callback signing secret of at least 16 characters. Set together with the callback URL. |

Start the containers:

```bash
docker compose up --build -d
docker compose ps
```

The API is available on host port `8080` (container port `3000`). Check readiness:

```bash
curl http://localhost:8080/health/ready
```

You do not need `DATABASE_URL`, `API_KEY`, `PORT`, or `MEDIA_STORAGE_PATH` in `.env`. Compose creates PostgreSQL, generates its password and your API key, applies migrations, and mounts the storage volumes. The API and worker run as a non-root user.

Retrieve the generated key:

```bash
docker compose exec api npm run api-key
```

For the examples below, load it into a local shell variable. This variable is for your API client; it is not a server environment setting:

```bash
WA_KEY="$(docker compose exec -T api node dist/cli.js api-key)"
```

PostgreSQL has no published host port. Its generated password and the API key persist in the `service_config` volume and remain the same after restarting or rebuilding containers.

## Connect Meta's webhook

Expose the API through an HTTPS reverse proxy or an HTTPS development tunnel. Set the Meta callback URL to:

```text
https://your-service.example/webhooks/whatsapp
```

Enter your `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Meta's verification field. Subscribe the app to your WABA and subscribe to `messages` and `message_template_status_update`. The service verifies `X-Hub-Signature-256` using your app secret.

Send a message to your business number and check `GET /v1/messages?direction=inbound`. Send an approved test template to a permitted recipient to verify outbound delivery. Template approval and WhatsApp's messaging-window/account rules are enforced by Meta; provider rejections are saved with the affected message. The service does not automatically replace rejected text messages with templates.

Useful provider references: [Meta's Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-f5af1f0d-7bf0-4a27-afee-34fd511f64a0), [webhook payloads](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference), and [template management](https://www.postman.com/meta/whatsapp-business-platform/folder/lczy75a/templates).

## Send messages

Every `/v1` request requires `Authorization: Bearer <your generated key>`. Every send request also requires `Idempotency-Key` (1–200 characters). Reuse that key when retrying the same request. Changing its content returns `409`; use a new key for an intentional new send.

Send one text message:

```bash
curl http://localhost:8080/v1/messages \
  -H "Authorization: Bearer $WA_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-text' \
  -d '{"to":"85291234567","type":"text","text":{"body":"Your order is ready."}}'
```

Successful sends return `202` after durable enqueueing:

```json
{
  "batchId": null,
  "messageIds": ["e07a1581-a4f1-47fc-bd4b-ecba2ac31267"],
  "status": "queued"
}
```

Use the returned local UUID with `GET /v1/messages/:id`. The separate `meta_id` becomes available after Meta accepts the message. A `202` response is not confirmation of delivery.

Send a text/media batch of up to 1,000 items:

```bash
curl http://localhost:8080/v1/messages/batch \
  -H "Authorization: Bearer $WA_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-notifications-2026-09-25' \
  -d '{"messages":[
    {"to":"85291234567","type":"text","text":{"body":"Hello Alice"}},
    {"to":"85292345678","type":"image","media":{"url":"https://your-cdn.example/order.png","caption":"Your order"}}
  ]}'
```

Replace the example media URL with a publicly reachable HTTPS file. Images, documents, audio, and video use `media.url`. Documents can also include `filename`; images, documents, and videos can include `caption`. Add `replyTo` with a WhatsApp message ID to reply in context.

The service downloads and archives media before sending it through Meta. It checks public DNS/IP destinations, redirects, file signatures, and size limits. Files sharing the same URL and type within one batch share an archive/upload. Outbound limits are 5 MiB for images, 16 MiB for audio/video, and 100 MiB for documents. Meta may impose additional codec and account restrictions.

Send personalized templates:

```bash
curl http://localhost:8080/v1/messages/templates/batch \
  -H "Authorization: Bearer $WA_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-template-123' \
  -d '{
    "name":"order_update",
    "language":"en_US",
    "recipients":[
      {"to":"85291234567","components":[{"type":"body","parameters":[{"type":"text","text":"Alice"}]}]},
      {"to":"85292345678","components":[{"type":"body","parameters":[{"type":"text","text":"Bob"}]}]}
    ]
  }'
```

For a single template, use `POST /v1/messages` with `type: "template"` and `template: {name, language, components}`. Template media parameters also use public URLs, for example `{"type":"image","image":{"url":"https://your-cdn.example/header.png"}}`.

Malformed batches are rejected in full before enqueueing. Once accepted, recipients are processed independently, so one rejection does not cancel the rest.

## Read history and manage templates

Get message history:

```bash
curl 'http://localhost:8080/v1/messages?direction=inbound&limit=50' \
  -H "Authorization: Bearer $WA_KEY"
```

Filters: `contact`, `direction`, `type`, `status`, `batchId`, `from`, and `to`. Dates use ISO 8601; date filters apply to storage time (`created_at`). Pagination returns `{data, nextCursor}`; pass `cursor` with the same filters for the next page. Lists default to 50 items and allow up to 100.

Message detail includes content, the Meta response, submission/delivery state, status history, media metadata, job attempts, and notification delivery information. Incoming messages can be marked read with `POST /v1/messages/:id/read`; `read_at` records that action.

Create a template:

```bash
curl http://localhost:8080/v1/templates \
  -H "Authorization: Bearer $WA_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"order_update",
    "language":"en_US",
    "category":"UTILITY",
    "components":[{"type":"BODY","text":"Hello {{1}}, your order is ready.","example":{"body_text":[["Alice"]]}}]
  }'
```

For a media header, provide `sampleUrl` on the `HEADER` component with `format` set to `IMAGE`, `VIDEO`, or `DOCUMENT`. The service archives the sample and obtains Meta's sample upload handle. For example:

```json
{
  "type": "HEADER",
  "format": "IMAGE",
  "sampleUrl": "https://your-cdn.example/header.png"
}
```

Template reads come from Meta and update the local mirror. Writes remain subject to Meta's approval and editing rules. Template IDs in the API are Meta IDs; message, batch, media, and delivery IDs are local UUIDs.

| Endpoint                                | Purpose                                                        |
| --------------------------------------- | -------------------------------------------------------------- |
| `POST /v1/messages`                     | Queue one message.                                             |
| `POST /v1/messages/batch`               | Queue text/media messages.                                     |
| `POST /v1/messages/templates/batch`     | Queue personalized templates.                                  |
| `GET /v1/messages`                      | Filter and paginate history.                                   |
| `GET /v1/messages/:id`                  | Inspect content, status history, and attempts.                 |
| `POST /v1/messages/:id/read`            | Mark an incoming message read.                                 |
| `GET /v1/batches/:id`                   | Inspect submission and delivery counts.                        |
| `GET /v1/batches/:id/messages`          | List batch results.                                            |
| `POST /v1/templates`                    | Create a template.                                             |
| `GET /v1/templates`                     | List with `name`, `language`, `status`, `limit`, and `cursor`. |
| `GET /v1/templates/:id`                 | Retrieve a template.                                           |
| `PATCH /v1/templates/:id`               | Edit category/components.                                      |
| `DELETE /v1/templates/:id`              | Delete the identified template variant.                        |
| `GET /v1/media/:id`                     | Check archive status.                                          |
| `GET /v1/media/:id/content`             | Download archived bytes.                                       |
| `POST /v1/media/:id/retry`              | Retry a failed archive.                                        |
| `POST /v1/webhook-deliveries/:id/retry` | Replay a failed notification.                                  |
| `GET /v1/openapi.json`                  | Download the OpenAPI 3.1 specification.                        |

Errors have the shape `{"error":{"code":"...","message":"...","details":{}}}`. Validation uses `422`, missing authentication uses `401`, conflicting operations use `409`, and synchronous Meta failures use `502`. Asynchronous sending failures are reported in message detail and batch totals.

## Receive notifications in your application

When configured, your callback receives **only incoming messages**, one `message.received` event per message. Delivery/read status updates and template events are saved but never forwarded.

```json
{
  "eventId": "25d8491c-7103-4b39-a4db-59606e8d2e7b",
  "type": "message.received",
  "occurredAt": "2026-09-25T04:00:00.000Z",
  "message": {
    "id": "e07a1581-a4f1-47fc-bd4b-ecba2ac31267",
    "metaId": "wamid.example",
    "from": "85291234567",
    "to": "YOUR_META_PHONE_NUMBER_ID",
    "type": "text",
    "content": { "body": "Hello" },
    "context": null,
    "contact": { "name": "Alice" },
    "media": null,
    "original": {
      "id": "wamid.example",
      "from": "85291234567",
      "type": "text",
      "text": { "body": "Hello" },
      "timestamp": "1790308800"
    }
  }
}
```

Callbacks include `X-Webhook-Id`, `X-Webhook-Timestamp` (Unix seconds), and `X-Webhook-Signature`. Verify the signature over the exact bytes before parsing JSON:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function validSignature(rawBody, timestamp, signature, secret) {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature ?? "")) return false;
  if (!/^\d+$/.test(timestamp ?? "")) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(rawBody)
      .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Return `2xx` after durably accepting the event. Failed deliveries are retried up to five attempts with exponential backoff and jitter. Delivery is at least once: deduplicate by `eventId`. Explicit replay resets the retry budget but retains the same ID and payload. Notification details and errors appear in message detail.

Incoming media downloads run separately. A notification can contain `media: {id, status: "pending", metadataPath, contentPath}`. Poll `metadataPath` with the API key and fetch `contentPath` when ready. Archive completion does not generate another notification. File content returns `409` while no archive is available.

## Understand processing and recovery

Submission states are `queued`, `sending`, `accepted`, `failed`, and `unknown`; incoming messages use `received`. Delivery states come from Meta, including `sent`, `delivered`, `read`, and `failed`. Every distinct status event is retained. Delayed events do not downgrade a confirmed delivery/read state.

The PostgreSQL queue uses leases and `FOR UPDATE SKIP LOCKED`. Workers recover unfinished jobs after lease expiry. Safe retries have five attempts; permanent errors stop immediately. A timeout after sending to Meta or a crash during dispatch leaves the message `unknown`, preventing an automatic duplicate send. A later correlated Meta status can resolve that state. Check the recipient/history before intentionally submitting a new message with a new idempotency key; the system cannot promise exactly-once delivery across Meta and PostgreSQL.

Default worker settings in `compose.yaml` are concurrency `2`, a `200 ms` global send interval, and a `6,000 ms` interval per recipient. These are local throttles, not a promise of Meta throughput. Provider limits and failures remain visible in saved results. Change these operational settings in Compose to suit your account.

The service retains messages, status events, raw webhooks, job attempts, and archived media indefinitely. History starts when the service receives/submits messages; it does not import old WhatsApp chats.

## Operate and back up the service

```bash
docker compose logs --tail=100 api worker migrate
docker compose exec -T api node dist/cli.js health
docker compose exec -T worker node dist/cli.js worker-health
```

`/health/live` checks the API process. `/health/ready` checks database access and writable media storage. The worker has a separate database heartbeat checked by Compose. Startup requires valid Meta settings but does not send live requests to validate your token.

For a consistent backup, pause application writes, dump PostgreSQL, and archive both persistent application volumes:

```bash
mkdir -p backups
chmod 700 backups
docker compose stop api worker
docker compose exec -T db pg_dump -U whatsapp -d whatsapp -Fc > backups/whatsapp.dump
docker compose run --rm --no-deps --user 0 -T --entrypoint tar api -czf - -C /data/media . > backups/media.tar.gz
docker compose run --rm --no-deps --user 0 -T --entrypoint tar api -czf - -C /run/service-config . > backups/service-config.tar.gz
chmod 600 backups/*
docker compose start api worker
```

Store backups securely: `service-config.tar.gz` contains credentials. Restore that volume before initializing a replacement database, restore media with ownership `10001:10001`, and use `pg_restore` for the database dump. Restore all three from the same backup set. Normal `docker compose down` preserves volumes; `docker compose down --volumes` deletes them.

Add new numbered SQL files to `migrations/` for schema changes. Do not edit an applied migration: checksums deliberately reject that. Compose runs migrations before starting the API/worker. The runner applies each file in a transaction and records only successful migrations.

## Run the checks

Use Node.js 24 or newer:

```bash
npm ci
npm run typecheck
npm run build
npm run test:unit
```

Integration tests require their isolated local PostgreSQL container:

```bash
docker compose -p whatsapp-microservice-test -f compose.test.yaml up -d --wait
npm test
docker compose -p whatsapp-microservice-test -f compose.test.yaml down
```

The test database uses `127.0.0.1:54329` and disposable tmpfs storage. Tests never use production credentials or real Meta requests. Run the production-image smoke test with:

```bash
npm run test:smoke
```

This uses a separate Compose project and fixture credentials, verifies API/worker readiness and volume persistence across container recreation, and removes its own test volumes afterward. It stops the worker before queueing test sends, so no messages reach Meta. The smoke override requires Compose support for `!override` (Compose 2.24.4 or newer).

Source layout: `src/app.ts` defines HTTP routes; `src/repositories/` contains SQL; `src/services/` handles webhooks/templates; `src/media/` archives files; `src/worker.ts` processes durable jobs; and `migrations/` defines the schema.
