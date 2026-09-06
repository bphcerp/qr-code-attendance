CREATE TYPE "public"."attendance_source" AS ENUM('qr', 'code', 'manual');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('student', 'faculty', 'admin');--> statement-breakpoint
CREATE TABLE "attendance_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"kind" varchar NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_email" varchar NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "attendance_source" NOT NULL,
	"device_id" uuid,
	"fingerprint" varchar,
	"ip" varchar,
	"user_agent" text,
	"lat" double precision,
	"lng" double precision,
	"accuracy" double precision,
	"marked_by_email" varchar,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_email" varchar,
	"action" varchar NOT NULL,
	"subject" varchar,
	"detail" jsonb,
	"ip" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"rotation_seconds" integer DEFAULT 5 NOT NULL,
	"declared_display_count" integer DEFAULT 1 NOT NULL,
	"room_lat" double precision,
	"room_lng" double precision
);
--> statement-breakpoint
CREATE TABLE "course_faculty" (
	"course_id" uuid NOT NULL,
	"faculty_email" varchar NOT NULL,
	"added_by_email" varchar,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_faculty_course_id_faculty_email_pk" PRIMARY KEY("course_id","faculty_email")
);
--> statement-breakpoint
CREATE TABLE "course_roster" (
	"course_id" uuid NOT NULL,
	"student_id" varchar NOT NULL,
	"student_name" varchar NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_roster_course_id_student_id_pk" PRIMARY KEY("course_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar NOT NULL,
	"title" varchar NOT NULL,
	"faculty_email" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_rebind_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" varchar NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_email" varchar,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" varchar NOT NULL,
	"fingerprint" varchar NOT NULL,
	"user_agent" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "display_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" varchar NOT NULL,
	"pinned_ip" varchar,
	"issued_by_email" varchar NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_ping_at" timestamp with time zone,
	CONSTRAINT "display_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"course_id" uuid NOT NULL,
	"student_email" varchar NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_course_id_student_email_pk" PRIMARY KEY("course_id","student_email")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_email" varchar NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_email" varchar,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_directory" (
	"email" varchar PRIMARY KEY NOT NULL,
	"full_name" varchar NOT NULL,
	"batch" integer,
	"source" varchar DEFAULT 'mess-2026-03' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"email" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"role" "role" DEFAULT 'student' NOT NULL,
	"campus" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_flags" ADD CONSTRAINT "attendance_flags_record_id_attendance_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."attendance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_email_users_email_fk" FOREIGN KEY ("student_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_email_users_email_fk" FOREIGN KEY ("marked_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_faculty" ADD CONSTRAINT "course_faculty_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_faculty" ADD CONSTRAINT "course_faculty_faculty_email_users_email_fk" FOREIGN KEY ("faculty_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_faculty" ADD CONSTRAINT "course_faculty_added_by_email_users_email_fk" FOREIGN KEY ("added_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_roster" ADD CONSTRAINT "course_roster_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_faculty_email_users_email_fk" FOREIGN KEY ("faculty_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_rebind_requests" ADD CONSTRAINT "device_rebind_requests_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_rebind_requests" ADD CONSTRAINT "device_rebind_requests_reviewed_by_email_users_email_fk" FOREIGN KEY ("reviewed_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_issued_by_email_users_email_fk" FOREIGN KEY ("issued_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_email_users_email_fk" FOREIGN KEY ("student_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_student_email_users_email_fk" FOREIGN KEY ("student_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_reviewed_by_email_users_email_fk" FOREIGN KEY ("reviewed_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_flags_record_idx" ON "attendance_flags" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_one_per_student_per_session" ON "attendance_records" USING btree ("session_id","student_email");--> statement-breakpoint
CREATE INDEX "attendance_fingerprint_idx" ON "attendance_records" USING btree ("session_id","fingerprint");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "class_sessions_course_idx" ON "class_sessions" USING btree ("course_id","started_at");--> statement-breakpoint
CREATE INDEX "course_faculty_email_idx" ON "course_faculty" USING btree ("faculty_email");--> statement-breakpoint
CREATE INDEX "course_roster_course_idx" ON "course_roster" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "courses_faculty_email_idx" ON "courses" USING btree ("faculty_email");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_one_active_per_user" ON "devices" USING btree ("user_email") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "display_tokens_session_idx" ON "display_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "enrollments_student_email_idx" ON "enrollments" USING btree ("student_email");--> statement-breakpoint
CREATE UNIQUE INDEX "review_one_per_student_per_session" ON "review_requests" USING btree ("session_id","student_email");--> statement-breakpoint
CREATE INDEX "student_directory_name_idx" ON "student_directory" USING btree ("full_name");--> statement-breakpoint
-- Privileges for the runtime role, consolidated from the old 0005/0006
-- migrations. Production connects as attendance_app -- a role with table-level
-- grants and no ownership, created by the parked security-hardening work -- so
-- every table it writes needs an explicit grant. users.UPDATE and devices.UPDATE
-- cover role changes and revoking a device binding; course_faculty is written by
-- the faculty-access screen. Guarded so this is a no-op on any database that
-- never got the runtime role: the local embedded Postgres and any fresh checkout.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_app') THEN
    GRANT UPDATE ON TABLE public.users TO attendance_app;
    GRANT UPDATE ON TABLE public.devices TO attendance_app;
    GRANT SELECT, INSERT, DELETE ON TABLE public.course_faculty TO attendance_app;
  END IF;
END
$$;--> statement-breakpoint
-- Every existing course owner becomes a member of their own course, so
-- permission checks read one table (course_faculty) rather than also checking
-- ownership and silently diverging the first time someone forgets. Idempotent,
-- and a no-op on a fresh database with no courses yet.
INSERT INTO "course_faculty" ("course_id", "faculty_email", "added_by_email")
SELECT "id", "faculty_email", "faculty_email" FROM "courses"
ON CONFLICT DO NOTHING;