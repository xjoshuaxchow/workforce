CREATE TABLE IF NOT EXISTS voice_calls (
 attempt_id uuid PRIMARY KEY REFERENCES attempts(id),
 call_sid text UNIQUE CHECK(call_sid IS NULL OR call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 state text NOT NULL CHECK(state IN ('reserved','submitting','submitted','unknown','rejected','cancelled','finished')),
 from_number text NOT NULL,to_number text NOT NULL,payload jsonb NOT NULL,
 submission_started_at timestamptz,cancel_requested boolean NOT NULL DEFAULT false,
 last_status text,last_sequence bigint NOT NULL DEFAULT -1,last_error text,next_cancel_at timestamptz,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='voice_calls_record_times' AND tgrelid='voice_calls'::regclass) THEN
 CREATE TRIGGER voice_calls_record_times BEFORE INSERT OR UPDATE ON voice_calls FOR EACH ROW EXECUTE FUNCTION workforce_record_times();
END IF; END $$;
