-- Notify (lcyt-notify): contacts, providers, notification log. See docs/plans/plan_notify_channels.md

-- CreateTable
CREATE TABLE "notify_contacts" (
    "id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "sms_number" TEXT,
    "consent_email" INTEGER NOT NULL DEFAULT 0,
    "consent_sms" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "notify_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_providers" (
    "api_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "secrets_enc" TEXT,
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'),

    CONSTRAINT "notify_providers_pkey" PRIMARY KEY ("api_key")
);

-- CreateTable
CREATE TABLE "notify_log" (
    "id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contact_slug" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_id" TEXT,
    "error" TEXT,

    CONSTRAINT "notify_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notify_contacts_key" ON "notify_contacts"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "idx_notify_contacts_slug" ON "notify_contacts"("api_key", "slug");

-- CreateIndex
CREATE INDEX "idx_notify_log_key_at" ON "notify_log"("api_key", "at");
