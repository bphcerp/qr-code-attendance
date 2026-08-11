CREATE TABLE "course_roster" (
  "course_id" uuid NOT NULL,
  "student_id" varchar NOT NULL,
  "student_name" varchar NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_roster_course_id_student_id_pk" PRIMARY KEY("course_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "course_roster" ADD CONSTRAINT "course_roster_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "course_roster_course_idx" ON "course_roster" USING btree ("course_id");
