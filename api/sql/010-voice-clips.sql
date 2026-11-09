ALTER TABLE request_voice_bindings DROP CONSTRAINT IF EXISTS request_voice_bindings_purpose_check;
ALTER TABLE request_voice_bindings ADD CONSTRAINT request_voice_bindings_purpose_check CHECK(purpose IN ('offer','confirmation','cancellation','message'));
CREATE TABLE IF NOT EXISTS request_voice_plans (
 request_id uuid NOT NULL REFERENCES requests(id),
 language text NOT NULL CHECK(language IN ('en','yue','zh')),
 settings_version_id uuid NOT NULL REFERENCES messaging_settings_versions(id),
 plan jsonb NOT NULL,
 PRIMARY KEY(request_id,language)
);
