-- Additive WhatsApp automation tables. Run before deploying the new app.
BEGIN;
-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "waba_id" TEXT NOT NULL DEFAULT '',
    "phone_number_id" TEXT NOT NULL DEFAULT '',
    "display_phone" TEXT NOT NULL DEFAULT '',
    "token_encrypted" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "invoice_enabled" BOOLEAN NOT NULL DEFAULT true,
    "received_enabled" BOOLEAN NOT NULL DEFAULT true,
    "supplier_enabled" BOOLEAN NOT NULL DEFAULT true,
    "delay_seconds" INTEGER NOT NULL DEFAULT 15,
    "next_send_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "worker_seen_at" TIMESTAMPTZ(6),
    "connected_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "opted_in_at" TIMESTAMPTZ(6),
    "opted_out_at" TIMESTAMPTZ(6),
    "consent_source" TEXT NOT NULL DEFAULT '',
    "last_inbound_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
    "id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "template_values" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(6),
    "provider_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_event_key_key" ON "whatsapp_messages"("event_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_provider_id_key" ON "whatsapp_messages"("provider_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_available_at_idx" ON "whatsapp_messages"("status", "available_at");


COMMIT;
