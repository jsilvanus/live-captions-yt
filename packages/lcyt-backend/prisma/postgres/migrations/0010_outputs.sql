-- AlterTable
ALTER TABLE "prod_feeds" ADD COLUMN "media" TEXT NOT NULL DEFAULT 'av';
-- AlterTable
ALTER TABLE "rtmp_relays" ADD COLUMN "source_output_id" TEXT;
-- AlterTable
ALTER TABLE "crop_preset_sets" ADD COLUMN "output_id" TEXT;
-- AlterTable
ALTER TABLE "crop_presets" ADD COLUMN "output_id" TEXT;
-- AlterTable
ALTER TABLE "crop_source_map" ADD COLUMN "output_id" TEXT;

-- CreateTable
CREATE TABLE "outputs" (
    "id" TEXT NOT NULL,
    "owner_api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'feed',
    "source_id" TEXT,
    "dsk_json" TEXT NOT NULL DEFAULT '[]',
    "crop_enabled" INTEGER NOT NULL DEFAULT 0,
    "audio_source" TEXT NOT NULL DEFAULT '"source"',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "output_crop_config" (
    "output_id" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "aspect_w" INTEGER NOT NULL DEFAULT 9,
    "aspect_h" INTEGER NOT NULL DEFAULT 16,
    "out_w" INTEGER,
    "out_h" INTEGER,
    "video_bitrate" TEXT,
    "follow_program" INTEGER NOT NULL DEFAULT 1,
    "transition_ms" INTEGER NOT NULL DEFAULT 0,
    "active_set_id" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),
    "auto_follow" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "output_crop_config_pkey" PRIMARY KEY ("output_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_outputs_owner_name" ON "outputs"("owner_api_key", "name");

-- CreateIndex
CREATE INDEX "idx_outputs_owner" ON "outputs"("owner_api_key");
