CREATE TABLE IF NOT EXISTS "course_faculty" (
	"course_id" uuid NOT NULL,
	"faculty_email" varchar NOT NULL,
	"added_by_email" varchar,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_faculty_course_id_faculty_email_pk" PRIMARY KEY("course_id","faculty_email")
);--> statement-breakpoint

ALTER TABLE "course_faculty" ADD CONSTRAINT "course_faculty_course_id_courses_id_fk"
  FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_faculty" ADD CONSTRAINT "course_faculty_faculty_email_users_email_fk"
  FOREIGN KEY ("faculty_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_faculty" ADD CONSTRAINT "course_faculty_added_by_email_users_email_fk"
  FOREIGN KEY ("added_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "course_faculty_email_idx" ON "course_faculty" USING btree ("faculty_email");--> statement-breakpoint

-- Every existing owner becomes a member of their own course, so permission
-- checks can read this one table rather than checking ownership separately and
-- silently diverging the first time someone forgets.
INSERT INTO "course_faculty" ("course_id", "faculty_email", "added_by_email")
SELECT "id", "faculty_email", "faculty_email" FROM "courses"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Same reason as 0005: production runs as attendance_app, which owns nothing
-- and therefore has no rights on a new table unless they are granted here.
-- Guarded so this is a no-op where that role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_app') THEN
    GRANT SELECT, INSERT, DELETE ON TABLE public.course_faculty TO attendance_app;
  END IF;
END
$$;
