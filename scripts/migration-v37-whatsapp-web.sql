-- Safe upgrade from the previous draft's API outbox to the browser worker.
BEGIN;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS connection_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'disconnected';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS connection_error TEXT NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS qr_data TEXT NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ(6);
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS session_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS logout_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS worker_owner TEXT NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS worker_lease_until TIMESTAMPTZ(6);
ALTER TABLE whatsapp_messages ALTER COLUMN template_values SET DEFAULT ARRAY[]::TEXT[];
COMMIT;
