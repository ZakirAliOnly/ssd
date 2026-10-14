BEGIN;
CREATE TABLE IF NOT EXISTS supplier_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  return_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  credit_entry_id UUID UNIQUE REFERENCES cashbook(id) ON DELETE RESTRICT,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_returns_purchase_order_id_return_date_idx ON supplier_returns(purchase_order_id, return_date);
CREATE TABLE IF NOT EXISTS supplier_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES supplier_returns(id) ON DELETE RESTRICT,
  purchase_item_id UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES stock_batches(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(14,2) NOT NULL CHECK(qty > 0),
  stock_removed_qty NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(stock_removed_qty >= 0 AND stock_removed_qty <= qty),
  amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  UNIQUE(return_id, purchase_item_id)
);
CREATE INDEX IF NOT EXISTS supplier_return_items_purchase_item_id_idx ON supplier_return_items(purchase_item_id);
CREATE INDEX IF NOT EXISTS supplier_return_items_batch_id_idx ON supplier_return_items(batch_id);
COMMIT;
