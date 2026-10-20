-- Broadcast lifecycle (plan_broadcast_lifecycle.md): caption sequence and clock sync live on the broadcast.
ALTER TABLE "broadcasts" ADD COLUMN "caption_sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "broadcasts" ADD COLUMN "sync_offset_ms" INTEGER;
ALTER TABLE "broadcasts" ADD COLUMN "last_synced_at" TEXT;
ALTER TABLE "broadcasts" ADD COLUMN "sync_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "broadcasts" ADD COLUMN "stage_report_json" TEXT;
ALTER TABLE "broadcasts" ADD COLUMN "adhoc" INTEGER NOT NULL DEFAULT 0;
