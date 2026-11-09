CREATE TABLE IF NOT EXISTS request_voice_texts (
 request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
 language text NOT NULL CHECK(language IN ('en','yue','zh')),
 purpose text NOT NULL CHECK(purpose IN ('offer','confirmation','cancellation','ack','no_input','unavailable')),
 parts jsonb NOT NULL CHECK(jsonb_typeof(parts)='array'),
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 updated_by uuid REFERENCES users(id),utime timestamptz NOT NULL,
 PRIMARY KEY(request_id,language,purpose)
);
