-- CreateTable
CREATE TABLE "tally_lights" (
    "id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "runner" TEXT NOT NULL DEFAULT 'auto',
    "bridge_instance_id" TEXT,
    "source_json" TEXT NOT NULL,
    "output_json" TEXT NOT NULL,
    "look_json" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "tally_lights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tally_lights_api_key" ON "tally_lights"("api_key");
