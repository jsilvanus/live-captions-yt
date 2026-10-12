-- CreateTable
CREATE TABLE "bus_payloads" (
    "id" SERIAL NOT NULL,
    "created_at" BIGINT NOT NULL,
    "payload" TEXT NOT NULL,

    CONSTRAINT "bus_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "url" TEXT,
    "started_at" BIGINT NOT NULL,
    "heartbeat_at" BIGINT NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "idx_bus_payloads_created" ON "bus_payloads"("created_at");

