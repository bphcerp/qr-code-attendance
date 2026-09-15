ALTER TABLE "course_roster" ADD COLUMN "match_key" varchar;--> statement-breakpoint
CREATE INDEX "course_roster_match_key_idx" ON "course_roster" USING btree ("match_key");