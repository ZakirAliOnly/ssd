BEGIN;

-- Invoice qty is in the sold unit; stock deductions are in loose base units.
-- E.g. 1 kit with factor 4 must permit a deduction of 4 vials, not just 1.
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_stock_deducted_valid;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_stock_deducted_valid
  CHECK (unit_factor > 0 AND stock_deducted_qty >= 0
    AND stock_deducted_qty <= round(qty * unit_factor, 2));

-- v33/v34 generated these names for their inline, multi-column checks.
-- Return rows do not store unit_factor; their original line owns the snapshot.
ALTER TABLE invoice_return_items DROP CONSTRAINT IF EXISTS invoice_return_items_check;
ALTER TABLE invoice_return_items DROP CONSTRAINT IF EXISTS invoice_return_items_stock_restored_valid;
ALTER TABLE invoice_return_items ADD CONSTRAINT invoice_return_items_stock_restored_valid
  CHECK (stock_restored_qty >= 0);
ALTER TABLE supplier_return_items DROP CONSTRAINT IF EXISTS supplier_return_items_check;
ALTER TABLE supplier_return_items DROP CONSTRAINT IF EXISTS supplier_return_items_stock_removed_valid;
ALTER TABLE supplier_return_items ADD CONSTRAINT supplier_return_items_stock_removed_valid
  CHECK (stock_removed_qty >= 0);

-- Keep the database upper bounds as well as the API's cumulative return checks.
-- A CHECK cannot reference another row, so validate against the saved source
-- factor in a trigger. Inventory conversions update source factors before these
-- return quantities, and all application inventory writes share the same lock.
CREATE OR REPLACE FUNCTION validate_packaging_return_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  factor numeric;
  physical_qty numeric;
  constraint_name text;
BEGIN
  IF TG_TABLE_NAME = 'invoice_return_items' THEN
    SELECT unit_factor INTO factor FROM invoice_items WHERE id = NEW.invoice_item_id;
    physical_qty := NEW.stock_restored_qty;
    constraint_name := 'invoice_return_items_stock_restored_valid';
  ELSE
    SELECT unit_factor INTO factor FROM purchase_order_items WHERE id = NEW.purchase_item_id;
    physical_qty := NEW.stock_removed_qty;
    constraint_name := 'supplier_return_items_stock_removed_valid';
  END IF;
  -- Missing source rows are rejected by the existing foreign keys.
  IF factor IS NOT NULL AND (factor <= 0 OR physical_qty < 0
      OR physical_qty > round(NEW.qty * factor, 2)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = constraint_name,
      TABLE = TG_TABLE_NAME, MESSAGE = 'Return stock exceeds the selected quantity in base units';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_return_items_packaging_stock ON invoice_return_items;
CREATE TRIGGER invoice_return_items_packaging_stock
  BEFORE INSERT OR UPDATE OF qty, stock_restored_qty, invoice_item_id ON invoice_return_items
  FOR EACH ROW EXECUTE FUNCTION validate_packaging_return_stock();
DROP TRIGGER IF EXISTS supplier_return_items_packaging_stock ON supplier_return_items;
CREATE TRIGGER supplier_return_items_packaging_stock
  BEFORE INSERT OR UPDATE OF qty, stock_removed_qty, purchase_item_id ON supplier_return_items
  FOR EACH ROW EXECUTE FUNCTION validate_packaging_return_stock();

COMMIT;
