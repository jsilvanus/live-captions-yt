-- CreateTable
CREATE TABLE "prod_feeds" (
    "id" TEXT NOT NULL,
    "owner_api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feed_key" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'rtmp',
    "kind" TEXT NOT NULL DEFAULT 'generic',
    "label" TEXT,
    "device_type" TEXT,
    "device_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "prod_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_prod_feeds_feed_key" ON "prod_feeds"("feed_key");

-- CreateIndex
CREATE INDEX "idx_prod_feeds_owner" ON "prod_feeds"("owner_api_key");

-- CreateIndex
CREATE INDEX "idx_prod_feeds_device" ON "prod_feeds"("device_type", "device_id");
