CREATE TABLE IF NOT EXISTS requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES sites,created_by uuid NOT NULL REFERENCES users,
 start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,deadline_at timestamptz NOT NULL,headcount integer NOT NULL CHECK(headcount BETWEEN 1 AND 50),
 channels text[] NOT NULL,mode text NOT NULL CHECK(mode IN ('broadcast','direct')),message text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','filled','expired','cancelled')),
 open_shift_ids uuid[] NOT NULL DEFAULT '{}',excluded jsonb NOT NULL DEFAULT '[]',
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now(),
 CHECK(end_at>start_at AND end_at-start_at<=interval '24 hours')
);
CREATE TABLE IF NOT EXISTS candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES requests,staff_id uuid NOT NULL REFERENCES staff,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacting','accepted','declined','too_late','no_response','failed','skipped')),
 reason text,final_response text CHECK(final_response IN ('accept','decline')),response_at timestamptz,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now(),UNIQUE(request_id,staff_id)
);
CREATE TABLE IF NOT EXISTS assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES requests,candidate_id uuid NOT NULL UNIQUE REFERENCES candidates,
 staff_id uuid NOT NULL REFERENCES staff,shift_id uuid NOT NULL REFERENCES shifts,status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
 original_status text,ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),candidate_id uuid REFERENCES candidates,request_id uuid REFERENCES requests,
 site_id uuid NOT NULL REFERENCES sites,staff_id uuid NOT NULL REFERENCES staff,channel text NOT NULL CHECK(channel IN ('whatsapp','voice')),
 purpose text NOT NULL,status text NOT NULL DEFAULT 'queued',external_id text,response text,payload jsonb NOT NULL DEFAULT '{}',reason text,
 dedupe_key text NOT NULL UNIQUE,ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,payload jsonb NOT NULL,run_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued',tries integer NOT NULL DEFAULT 0,locked_at timestamptz,dedupe_key text NOT NULL UNIQUE,last_error text,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(run_at) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS message_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id text,raw_body text NOT NULL,received_at timestamptz NOT NULL,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS message_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id text NOT NULL UNIQUE,correlation_id text NOT NULL,payload jsonb NOT NULL,
 processed boolean NOT NULL DEFAULT false,received_at timestamptz NOT NULL,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['requests','candidates','assignments','attempts','jobs','message_deliveries','message_events'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_record_times' AND tgrelid=t::regclass) THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION workforce_record_times()',t||'_record_times',t);
  END IF;
 END LOOP;
END $$;
