BEGIN;
-- Historical totals cannot be recovered reliably from current product stock.
-- Leave old rows NULL; all new snapshots are written with the return transaction.
ALTER TABLE invoice_return_items
  ADD COLUMN IF NOT EXISTS invoice_before_qty NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS invoice_after_qty NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS stock_before_qty NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS stock_after_qty NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS stock_unit TEXT;
COMMIT;
