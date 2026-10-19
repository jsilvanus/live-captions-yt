-- Feeds and devices PR 7: prod_feeds replaces prod_cameras.camera_key and rtmp_relays.source_camera_id.
-- Same rules as the startup backfill (lcyt-rtmp db/feeds.js backfillFeeds), done in SQL because the migration runs first.

-- 1. A keyed camera without a feed gets a camera feed with its old key (kind camera, linked to the camera).
--    webcam and mobile cameras publish over WHIP, everything else (rtmp) over RTMP.
INSERT INTO "prod_feeds" ("id", "owner_api_key", "name", "feed_key", "transport", "kind", "label", "device_type", "device_id", "sort_order", "created_at")
SELECT 'feed-cam-' || c."id", c."owner_api_key", COALESCE(NULLIF(c."label", ''), c."name"), c."camera_key",
  CASE WHEN c."control_type" IN ('webcam', 'mobile') THEN 'whip' ELSE 'rtmp' END, 'camera', NULL, 'camera', c."id", c."sort_order",
  to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS')
FROM "prod_cameras" c
WHERE c."camera_key" IS NOT NULL AND c."camera_key" <> '' AND c."owner_api_key" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "prod_feeds" f WHERE f."feed_key" = c."camera_key");

-- 2. Refuse to drop a key that no feed carries (ownerless camera, or a key used by another feed): a loud stop instead of lost keys.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "prod_cameras" c WHERE c."camera_key" IS NOT NULL AND c."camera_key" <> '' AND NOT EXISTS (SELECT 1 FROM "prod_feeds" f WHERE f."feed_key" = c."camera_key")) THEN RAISE EXCEPTION 'migration 0008: a prod_cameras.camera_key has no feed (ownerless camera or a clashing feed key); give the camera an owner or rename the clashing feed, then run again'; END IF; END $$;

-- 3. Relay source: the feed of the source camera (the camera's first feed, same order as linkedFeedKeys).
UPDATE "rtmp_relays" r SET "source_feed_id" = (
  SELECT f."id" FROM "prod_feeds" f
  WHERE f."device_type" = 'camera' AND f."device_id" = r."source_camera_id"
  ORDER BY f."sort_order", f."created_at", f."id" LIMIT 1)
WHERE r."source_feed_id" IS NULL AND r."source_camera_id" IS NOT NULL;

-- 4. The rtmp camera type is gone: such cameras are control 'none' with a linked feed.
UPDATE "prod_cameras" SET "control_type" = 'none' WHERE "control_type" = 'rtmp';

-- 5. Drop the legacy columns.
ALTER TABLE "prod_cameras" DROP COLUMN "camera_key";

ALTER TABLE "rtmp_relays" DROP COLUMN "source_camera_id";
