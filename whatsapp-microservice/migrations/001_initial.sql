CREATE TABLE contacts (
  wa_id text PRIMARY KEY,
  profile jsonb NOT NULL DEFAULT '{}',
  last_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total integer NOT NULL CHECK(total BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text,
  meta_id text,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
  filename text,
  mime_type text,
  size bigint,
  sha256 text,
  expected_sha256 text,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX media_meta_id ON media(meta_id) WHERE meta_id IS NOT NULL;
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_id text UNIQUE,
  batch_id uuid REFERENCES batches(id),
  contact_id text NOT NULL REFERENCES contacts(wa_id),
  direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
  type text NOT NULL,
  content jsonb NOT NULL,
  raw_payload jsonb,
  media_id uuid REFERENCES media(id),
  submission_status text NOT NULL CHECK(submission_status IN ('received','queued','sending','accepted','failed','unknown')),
  delivery_status text,
  last_error jsonb,
  dispatch_started_at timestamptz,
  read_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_history ON messages(created_at DESC,id DESC);
CREATE INDEX messages_contact_history ON messages(contact_id,created_at DESC,id DESC);
CREATE INDEX messages_batch ON messages(batch_id,created_at DESC,id DESC);
CREATE INDEX messages_delivery ON messages(delivery_status);
CREATE INDEX messages_submission ON messages(submission_status);
CREATE TABLE message_media (
  message_id uuid NOT NULL REFERENCES messages(id),
  media_id uuid NOT NULL REFERENCES media(id),
  content_path text NOT NULL,
  PRIMARY KEY(message_id,content_path)
);
CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope,key)
);
CREATE TABLE webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  meta_id text NOT NULL,
  message_id uuid REFERENCES messages(id),
  status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_events_lookup ON status_events(meta_id,occurred_at,id);
CREATE INDEX status_events_message ON status_events(message_id,occurred_at,id);
CREATE TABLE templates (
  meta_id text PRIMARY KEY,
  name text,
  language text,
  status text,
  category text,
  payload jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX templates_name ON templates(name,language);
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES messages(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
  last_error jsonb,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('send','archive','notify')),
  message_id uuid REFERENCES messages(id),
  media_id uuid REFERENCES media(id),
  delivery_id uuid REFERENCES webhook_deliveries(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='send' AND message_id IS NOT NULL) OR (kind='archive' AND media_id IS NOT NULL) OR (kind='notify' AND delivery_id IS NOT NULL))
);
CREATE UNIQUE INDEX jobs_message ON jobs(message_id) WHERE kind='send';
CREATE UNIQUE INDEX jobs_media ON jobs(media_id) WHERE kind='archive';
CREATE UNIQUE INDEX jobs_delivery ON jobs(delivery_id) WHERE kind='notify';
CREATE INDEX jobs_pending ON jobs(available_at,created_at) WHERE state='pending';
CREATE INDEX jobs_expired ON jobs(lease_until) WHERE state='running';
CREATE TABLE job_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  lease_token uuid NOT NULL UNIQUE,
  attempt integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text,
  error jsonb
);
CREATE INDEX job_attempts_job ON job_attempts(job_id,id);
CREATE TABLE rate_limits (key text PRIMARY KEY,next_at timestamptz NOT NULL);
CREATE TABLE worker_heartbeats (id text PRIMARY KEY,seen_at timestamptz NOT NULL DEFAULT now());
