CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email=lower(email)),
 name text NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','site_manager')),
 active boolean NOT NULL DEFAULT true, ctime timestamptz NOT NULL DEFAULT now(), utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users,
 expires_at timestamptz NOT NULL, ctime timestamptz NOT NULL DEFAULT now(), utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,address text NOT NULL DEFAULT '',
 timezone text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_active_name ON sites(lower(name)) WHERE status='active';
CREATE TABLE IF NOT EXISTS site_managers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES sites,user_id uuid NOT NULL REFERENCES users,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,user_id)
);
CREATE TABLE IF NOT EXISTS staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,mobile text NOT NULL UNIQUE,landline text,
 language text NOT NULL DEFAULT 'en',preferred_channel text NOT NULL DEFAULT 'whatsapp' CHECK(preferred_channel IN ('whatsapp','voice')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_leave','blocked','inactive')),
 whatsapp_opt_in boolean NOT NULL DEFAULT false,whatsapp_opt_in_at timestamptz,whatsapp_opt_in_source text,
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS site_staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES sites,staff_id uuid NOT NULL REFERENCES staff,
 active boolean NOT NULL DEFAULT true, linked_at timestamptz NOT NULL DEFAULT now(),
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now(),UNIQUE(site_id,staff_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_type text NOT NULL,actor_id uuid,action text NOT NULL,
 entity_type text NOT NULL,entity_id uuid NOT NULL,site_id uuid REFERENCES sites,before_data jsonb,after_data jsonb,
 metadata jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT now(),
 ctime timestamptz NOT NULL DEFAULT now(),utime timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION workforce_record_times() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE moment timestamptz := coalesce(nullif(current_setting('workforce.now',true),'' )::timestamptz,now());
BEGIN
 IF TG_OP='INSERT' THEN NEW.ctime:=moment; ELSE NEW.ctime:=OLD.ctime; END IF;
 NEW.utime:=moment; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','sessions','sites','site_managers','staff','site_staff','audit_log'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_record_times' AND tgrelid=t::regclass) THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION workforce_record_times()',t||'_record_times',t);
  END IF;
 END LOOP;
END $$;
