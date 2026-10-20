BEGIN;
-- Additive and repeatable. Existing products and quantities keep their original basis.
ALTER TABLE products ALTER COLUMN cost_price TYPE numeric(20,8);
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_unit text NOT NULL DEFAULT 'Piece';
ALTER TABLE products ADD COLUMN IF NOT EXISTS pieces_per_packet integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packets_per_box integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packet_sale_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS box_sale_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_converted_at timestamptz;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'unit';
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_factor numeric(14,2) NOT NULL DEFAULT 1;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_factor numeric(14,2) NOT NULL DEFAULT 1;
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS unit_cost numeric(20,8);
ALTER TABLE invoice_return_items ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'unit';
ALTER TABLE supplier_return_items ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'unit';
-- Snapshot existing receipt costs once. Repeat runs leave snapshots unchanged.
UPDATE stock_batches b SET unit_cost = CASE WHEN p.qty > 0 THEN p.amount / (p.qty * p.unit_factor) ELSE 0 END
FROM purchase_order_items p WHERE b.purchase_item_id = p.id AND b.unit_cost IS NULL;
UPDATE stock_batches b SET unit_cost = p.cost_price FROM products p WHERE b.product_id = p.id AND b.unit_cost IS NULL;

COMMIT;
