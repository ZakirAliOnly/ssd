BEGIN;
CREATE TABLE IF NOT EXISTS invoice_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  return_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  credit_entry_id UUID UNIQUE REFERENCES cashbook(id) ON DELETE RESTRICT,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_returns_invoice_id_return_date_idx ON invoice_returns(invoice_id, return_date);
CREATE TABLE IF NOT EXISTS invoice_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES invoice_returns(id) ON DELETE RESTRICT,
  invoice_item_id UUID NOT NULL REFERENCES invoice_items(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  stock_restored_qty NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock_restored_qty >= 0 AND stock_restored_qty <= qty),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  revenue NUMERIC(12,2) NOT NULL CHECK (revenue >= 0),
  UNIQUE(return_id, invoice_item_id)
);
CREATE INDEX IF NOT EXISTS invoice_return_items_invoice_item_id_idx ON invoice_return_items(invoice_item_id);
CREATE INDEX IF NOT EXISTS invoice_return_items_product_id_idx ON invoice_return_items(product_id);
CREATE TABLE IF NOT EXISTS return_stock_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_item_id UUID NOT NULL REFERENCES invoice_return_items(id) ON DELETE RESTRICT,
  stock_allocation_id UUID NOT NULL REFERENCES stock_allocations(id) ON DELETE RESTRICT,
  qty NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  UNIQUE(return_item_id, stock_allocation_id)
);
COMMIT;
