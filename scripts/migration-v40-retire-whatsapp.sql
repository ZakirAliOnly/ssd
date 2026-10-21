-- Run against SSD's database only, after stopping its retired messaging worker.
-- Preserve contact numbers and all historical messaging/session records.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'whatsapp') THEN
    UPDATE accounts SET phone = whatsapp
    WHERE COALESCE(BTRIM(phone), '') = '' AND COALESCE(BTRIM(whatsapp), '') <> '';
  END IF;
  IF to_regclass('whatsapp_settings') IS NOT NULL THEN
    UPDATE whatsapp_settings SET enabled = false;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'whatsapp_settings' AND column_name = 'connection_requested') THEN
      UPDATE whatsapp_settings SET connection_requested = false;
    END IF;
  END IF;
END $$;
COMMIT;
