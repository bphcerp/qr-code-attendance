ALTER TABLE "device_rebind_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "device_rebind_requests" CASCADE;--> statement-breakpoint
DROP TABLE "devices" CASCADE;--> statement-breakpoint
ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "attendance_records_device_id_devices_id_fk";
--> statement-breakpoint
DROP INDEX "attendance_fingerprint_idx";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "device_id";--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "fingerprint";