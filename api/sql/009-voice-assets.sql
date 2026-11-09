CREATE TABLE IF NOT EXISTS voice_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_token text NOT NULL UNIQUE,
 name text NOT NULL,language text NOT NULL CHECK(language IN ('en','yue','zh')),content_type text NOT NULL,
 data bytea NOT NULL,site_id uuid REFERENCES sites(id),request_id uuid REFERENCES requests(id),active boolean NOT NULL DEFAULT true,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_voice_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES requests(id),language text NOT NULL CHECK(language IN ('en','yue','zh')),
 purpose text NOT NULL CHECK(purpose IN ('offer','confirmation','cancellation')),asset_id uuid NOT NULL REFERENCES voice_assets(id),
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now(),UNIQUE(request_id,language,purpose)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['voice_assets','request_voice_bindings'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_record_times' AND tgrelid=t::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION workforce_record_times()',t||'_record_times',t);
 END IF; END LOOP; END $$;
