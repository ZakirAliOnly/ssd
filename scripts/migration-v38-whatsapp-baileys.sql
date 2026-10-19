-- Encrypted Baileys credentials / Signal keys. Never modifies financial tables.
BEGIN;
CREATE TABLE IF NOT EXISTS whatsapp_auth (
  id TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Switching transports requires a fresh scan. Preserve financial messages, but
-- pause submissions and invalidate browser sessions on the first upgrade only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM whatsapp_auth WHERE id = 'transport:baileys') THEN
    UPDATE whatsapp_settings SET enabled=false, connection_requested=false,
      connection_state='disconnected', connection_error='', qr_data='', qr_expires_at=NULL,
      session_generation=session_generation+1, logout_requested=false,
      worker_owner='', worker_lease_until=NULL, phone_number_id='', display_phone='',
      token_encrypted='', waba_id='', connected_at=NULL;
    UPDATE whatsapp_messages SET status='cancelled', reason='Transport changed; reconnect Baileys before creating new notifications'
      WHERE status IN ('queued','blocked');
    UPDATE whatsapp_messages SET status='unknown', reason='Transport changed during delivery; check WhatsApp before sending manually'
      WHERE status='processing';
    UPDATE whatsapp_contacts SET opted_in_at=NULL, opted_out_at=now(), consent_source='Transport changed; consent must be recorded again', last_inbound_at=NULL;
    INSERT INTO whatsapp_auth(id,value_encrypted,updated_at) VALUES ('transport:baileys','v1',now());
  END IF;
END $$;
COMMIT;
