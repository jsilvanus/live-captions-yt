-- AlterTable
ALTER TABLE "outputs" ADD COLUMN "group_id" TEXT;

-- CreateTable
CREATE TABLE "output_groups" (
    "id" TEXT NOT NULL,
    "owner_api_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "output_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_output_groups_owner" ON "output_groups"("owner_api_key");

-- CreateIndex
CREATE INDEX "idx_outputs_group" ON "outputs"("group_id");
