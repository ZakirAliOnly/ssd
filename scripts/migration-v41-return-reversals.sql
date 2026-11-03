BEGIN;
ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS reversal_reason text NOT NULL DEFAULT '';
ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS reversed_by_email text NOT NULL DEFAULT '';
ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS reversed_by_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS reversal_credit_entry_id uuid UNIQUE REFERENCES cashbook(id) ON DELETE RESTRICT;
ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS reversal_reason text NOT NULL DEFAULT '';
ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS reversed_by_email text NOT NULL DEFAULT '';
ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS reversed_by_name text NOT NULL DEFAULT '';
ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS reversal_credit_entry_id uuid UNIQUE REFERENCES cashbook(id) ON DELETE RESTRICT;
ALTER TABLE invoice_return_items ADD COLUMN IF NOT EXISTS restored_batch_id uuid REFERENCES stock_batches(id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS return_reversal_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_id uuid REFERENCES invoice_returns(id) ON DELETE RESTRICT,
  supplier_return_id uuid REFERENCES supplier_returns(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES stock_batches(id) ON DELETE RESTRICT,
  qty numeric(14,2) NOT NULL CONSTRAINT return_reversal_stock_qty_positive CHECK(qty > 0),
  movement_date date NOT NULL,
  CONSTRAINT return_reversal_stock_one_return CHECK ((sales_return_id IS NOT NULL)::int + (supplier_return_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS return_reversal_stock_batch_id_movement_date_idx ON return_reversal_stock(batch_id,movement_date);
CREATE TABLE IF NOT EXISTS return_period_lock (
  id integer PRIMARY KEY DEFAULT 1 CONSTRAINT return_period_lock_singleton CHECK(id = 1),
  closed_through date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Install SQL-only invariants even if the tables came from Prisma db push.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_reversal_stock_qty_positive' AND conrelid = 'return_reversal_stock'::regclass) THEN
    ALTER TABLE return_reversal_stock ADD CONSTRAINT return_reversal_stock_qty_positive CHECK(qty > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_reversal_stock_one_return' AND conrelid = 'return_reversal_stock'::regclass) THEN
    ALTER TABLE return_reversal_stock ADD CONSTRAINT return_reversal_stock_one_return CHECK ((sales_return_id IS NOT NULL)::int + (supplier_return_id IS NOT NULL)::int = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_period_lock_singleton' AND conrelid = 'return_period_lock'::regclass) THEN
    ALTER TABLE return_period_lock ADD CONSTRAINT return_period_lock_singleton CHECK(id = 1);
  END IF;
END $$;
INSERT INTO return_period_lock(id,updated_at) VALUES(1,now()) ON CONFLICT DO NOTHING;
COMMIT;
