CREATE TABLE "faculty_invites" (
	"email" varchar PRIMARY KEY NOT NULL,
	"invited_by_email" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "faculty_invites" ADD CONSTRAINT "faculty_invites_invited_by_email_users_email_fk" FOREIGN KEY ("invited_by_email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;