-- CreateTable
CREATE TABLE "video_feeds" (
    "video_id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "meta_json" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "video_feeds_pkey" PRIMARY KEY ("video_id")
);

-- CreateTable
CREATE TABLE "handoffs" (
    "id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "broadcast_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "manifest_json" TEXT,
    "error" TEXT,
    "sent_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_video_feeds_group" ON "video_feeds"("group_id");

-- CreateIndex
CREATE INDEX "idx_video_feeds_api_key" ON "video_feeds"("api_key");

-- CreateIndex
CREATE INDEX "idx_handoffs_api_key" ON "handoffs"("api_key");

-- CreateIndex
CREATE INDEX "idx_handoffs_broadcast_id" ON "handoffs"("broadcast_id");

