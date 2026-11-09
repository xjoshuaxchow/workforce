CREATE TABLE IF NOT EXISTS voice_syntheses (
 hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),
 request_id uuid REFERENCES requests(id),site_id uuid REFERENCES sites(id),
 language text NOT NULL CHECK(language IN ('en','yue','zh')),
 purpose text NOT NULL,voice text NOT NULL,script text NOT NULL,
 settings_version_id uuid NOT NULL REFERENCES messaging_settings_versions(id),
 state text NOT NULL CHECK(state IN ('submitting','ready','failed','unknown')),
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 started_at timestamptz NOT NULL,asset_id uuid REFERENCES voice_assets(id),
 last_error text,
 CHECK(state<>'ready' OR asset_id IS NOT NULL)
);
