ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_discount_pct_range' AND conrelid = 'invoice_items'::regclass) THEN
    ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_discount_pct_range CHECK (discount_pct BETWEEN 0 AND 100);
  END IF;
END $$;
