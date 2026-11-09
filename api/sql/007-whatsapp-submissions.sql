CREATE TABLE IF NOT EXISTS whatsapp_submissions (
 attempt_id uuid PRIMARY KEY REFERENCES attempts(id),
 request_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL,
 to_number text NOT NULL,
 message_id uuid UNIQUE,
 meta_id text UNIQUE,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','unknown','submitted','rejected')),
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='whatsapp_submissions_record_times' AND tgrelid='whatsapp_submissions'::regclass) THEN
 CREATE TRIGGER whatsapp_submissions_record_times BEFORE INSERT OR UPDATE ON whatsapp_submissions FOR EACH ROW EXECUTE FUNCTION workforce_record_times();
END IF; END $$;

ALTER TABLE whatsapp_submissions ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE whatsapp_submissions ADD COLUMN IF NOT EXISTS status_revision bigint NOT NULL DEFAULT 0;
