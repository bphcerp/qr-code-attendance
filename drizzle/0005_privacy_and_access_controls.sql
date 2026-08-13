ALTER TABLE "attendance_records" DROP COLUMN "fingerprint";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "ip";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "user_agent";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "lat";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "lng";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "accuracy";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "ip";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "fingerprint";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "user_agent";--> statement-breakpoint
ALTER TABLE "display_tokens" DROP COLUMN "pinned_ip";--> statement-breakpoint
UPDATE "display_tokens"
SET "revoked_at" = COALESCE("revoked_at", now())
WHERE "revoked_at" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_app') THEN
    CREATE ROLE attendance_app
      WITH NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO attendance_app', current_database());
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public, private TO attendance_app;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public, private FROM PUBLIC;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public, private FROM attendance_app;--> statement-breakpoint
GRANT USAGE ON TYPE public.role, public.attendance_source, public.request_status TO attendance_app;--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE public.users TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.devices TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.courses TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.enrollments TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.course_roster TO attendance_app;--> statement-breakpoint
GRANT SELECT ON TABLE public.student_directory TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.class_sessions TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.display_tokens TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.attendance_records TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.attendance_flags TO attendance_app;--> statement-breakpoint
GRANT INSERT ON TABLE public.audit_log TO attendance_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.rate_limit_buckets TO attendance_app;--> statement-breakpoint

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.course_roster ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.student_directory ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.display_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.attendance_flags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.device_rebind_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE private.rate_limit_buckets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY attendance_app_server_access ON public.users
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.devices
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.courses
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.enrollments
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.course_roster
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.student_directory
  FOR SELECT TO attendance_app USING (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.class_sessions
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.display_tokens
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.attendance_records
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON public.attendance_flags
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_insert_only ON public.audit_log
  FOR INSERT TO attendance_app WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_server_access ON private.rate_limit_buckets
  FOR ALL TO attendance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY attendance_app_explicit_deny ON public.review_requests
  AS RESTRICTIVE FOR ALL TO attendance_app USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY attendance_app_explicit_deny ON public.device_rebind_requests
  AS RESTRICTIVE FOR ALL TO attendance_app USING (false) WITH CHECK (false);--> statement-breakpoint

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA private FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA private FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA private FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  owner_role text;
  api_role text;
BEGIN
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role)
       AND (owner_role = current_user OR pg_has_role(current_user, owner_role, 'MEMBER')) THEN
      FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
      LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
            owner_role,
            api_role
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
            owner_role,
            api_role
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
            owner_role,
            api_role
          );
        END IF;
      END LOOP;

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
        owner_role
      );
    END IF;
  END LOOP;
END
$$;
