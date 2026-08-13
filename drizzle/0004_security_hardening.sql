CREATE SCHEMA "private";
--> statement-breakpoint
CREATE TABLE "private"."rate_limit_buckets" (
	"scope" varchar NOT NULL,
	"key_hash" varchar NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_buckets_scope_key_hash_window_start_pk" PRIMARY KEY("scope","key_hash","window_start")
);
--> statement-breakpoint
DROP INDEX "attendance_fingerprint_idx";--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "fingerprint_hash" varchar;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "network_hash" varchar;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "fingerprint_hash" varchar;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD COLUMN "pinned_network_hash" varchar;--> statement-breakpoint
CREATE INDEX "rate_limit_window_idx" ON "private"."rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "attendance_fingerprint_hash_idx" ON "attendance_records" USING btree ("session_id","fingerprint_hash");