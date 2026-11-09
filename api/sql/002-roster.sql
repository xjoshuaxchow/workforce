CREATE TABLE IF NOT EXISTS shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES sites,staff_id uuid REFERENCES staff,
 start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','confirmed','completed','cancelled')),
 source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','request')),request_id uuid,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now(),
 CHECK(end_at>start_at AND end_at-start_at<=interval '24 hours'),
 EXCLUDE USING gist(staff_id WITH =,tstzrange(start_at,end_at,'[)') WITH &&) WHERE(staff_id IS NOT NULL AND status<>'cancelled')
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='shifts_record_times' AND tgrelid='shifts'::regclass) THEN
 CREATE TRIGGER shifts_record_times BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION workforce_record_times();
END IF; END $$;
