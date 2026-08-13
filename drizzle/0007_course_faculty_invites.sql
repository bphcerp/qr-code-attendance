CREATE TABLE IF NOT EXISTS "course_faculty_invites" (
	"course_id" uuid NOT NULL,
	"email" varchar NOT NULL,
	"invited_by_email" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_faculty_invites_course_id_email_pk" PRIMARY KEY("course_id","email")
);--> statement-breakpoint

ALTER TABLE "course_faculty_invites" ADD CONSTRAINT "course_faculty_invites_course_id_courses_id_fk"
  FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_faculty_invites" ADD CONSTRAINT "course_faculty_invites_invited_by_email_users_email_fk"
  FOREIGN KEY ("invited_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "course_faculty_invites_email_idx" ON "course_faculty_invites" USING btree ("email");--> statement-breakpoint

-- Production runs as attendance_app, which owns nothing and therefore needs
-- explicit privileges for every table introduced after the hardening work.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_app') THEN
    GRANT SELECT, INSERT, DELETE ON TABLE public.course_faculty_invites TO attendance_app;
  END IF;
END
$$;
