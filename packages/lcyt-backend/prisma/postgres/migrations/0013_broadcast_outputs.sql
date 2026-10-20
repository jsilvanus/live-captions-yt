-- Broadcast outputs (plan_broadcast_lifecycle.md PR 5): which egress outputs a broadcast puts on air.
CREATE TABLE "broadcast_outputs" (
    "broadcast_id" TEXT NOT NULL,
    "output_id" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "broadcast_outputs_pkey" PRIMARY KEY ("broadcast_id","output_id")
);

-- CreateIndex
CREATE INDEX "idx_broadcast_outputs_output" ON "broadcast_outputs"("output_id");

-- AddForeignKey
ALTER TABLE "broadcast_outputs" ADD CONSTRAINT "broadcast_outputs_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
