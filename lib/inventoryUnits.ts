import type { Prisma } from "@prisma/client";
import { InventoryError, roundQuantity, validQuantity } from "./inventory";
import { productUnits } from "./productUnits";

// Shared by inventory saves, returns and conversions. Prevents a one-time base
// conversion racing with a transaction that read the old physical quantities.
export async function lockInventoryUnits(tx: Prisma.TransactionClient) {
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(9009001)::text");
}

export async function resolveLineUnit(tx: Prisma.TransactionClient, productId: string | null,
  unit: string | undefined, expected: number | undefined,
  previous?: { product_id: string | null; unit: string; unit_factor: Prisma.Decimal | number }) {
  if (previous && previous.product_id === productId && (unit ?? previous.unit) === previous.unit) {
    if (expected != null && expected !== Number(previous.unit_factor ?? 1)) throw new InventoryError("This item's packaging changed. Reload the document.");
    return { unit: previous.unit || "unit", unit_factor: Number(previous.unit_factor ?? 1) };
  }
  if (!productId) return { unit: "unit", unit_factor: 1 };
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new InventoryError("A selected product no longer exists.");
  if (product.packaging_enabled && unit == null) throw new InventoryError("Reload the app and choose Vial, Kit or Box before saving this product line.");
  const selected = productUnits(product).find(row => row.value === (unit ?? (product.packaging_enabled ? "piece" : "unit")));
  if (!selected || expected != null && selected.factor !== expected) throw new InventoryError("Product packaging changed. Reload products and select the unit again.");
  return { unit: selected.value, unit_factor: selected.factor };
}

/** Financial quantities and amounts stay untouched; physical history changes basis. */
export async function convertProductUnits(tx: Prisma.TransactionClient, productId: string, factor: number, expectedQty: number) {
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  if (product.packaging_enabled || product.packaging_converted_at) throw new InventoryError("This product was already configured. Reload before saving.");
  if (!validQuantity(expectedQty) || Number(product.quantity) !== expectedQty) throw new InventoryError("Stock changed. Reopen the product before converting.");
  if (!Number.isInteger(factor) || factor < 1 || factor > 1000000 || !validQuantity(expectedQty * factor)) throw new InventoryError("Invalid stock conversion or resulting quantity is too large.");
  const batches = await tx.stockBatch.findMany({ where: { product_id: productId } });
  if (roundQuantity(batches.reduce((n, b) => n + Number(b.remaining_qty), 0)) !== expectedQty) throw new InventoryError("Stock and batches do not match. Resolve the stock history before converting.");
  // Only identifiers and numeric parameters enter SQL; product row is locked by caller.
  for (const batch of batches) {
    if (!validQuantity(Number(batch.received_qty) * factor)) throw new InventoryError("Converted batch quantity is too large.");
  }
  await tx.$executeRaw`UPDATE stock_batches SET received_qty = received_qty * ${factor}, remaining_qty = remaining_qty * ${factor}, unit_cost = COALESCE(unit_cost, ${Number(product.cost_price)}) / ${factor} WHERE product_id = ${productId}::uuid`;
  await tx.$executeRaw`UPDATE stock_allocations SET qty = qty * ${factor} WHERE batch_id IN (SELECT id FROM stock_batches WHERE product_id = ${productId}::uuid)`;
  await tx.$executeRaw`UPDATE return_stock_allocations SET qty = qty * ${factor} WHERE stock_allocation_id IN (SELECT a.id FROM stock_allocations a JOIN stock_batches b ON b.id = a.batch_id WHERE b.product_id = ${productId}::uuid)`;
  await tx.$executeRaw`UPDATE invoice_items SET unit_factor = unit_factor * ${factor}, stock_deducted_qty = stock_deducted_qty * ${factor} WHERE product_id = ${productId}::uuid`;
  await tx.$executeRaw`UPDATE purchase_order_items SET unit_factor = unit_factor * ${factor}, stock_received_qty = stock_received_qty * ${factor} WHERE product_id = ${productId}::uuid`;
  await tx.$executeRaw`UPDATE invoice_return_items SET stock_restored_qty = stock_restored_qty * ${factor} WHERE product_id = ${productId}::uuid`;
  await tx.$executeRaw`UPDATE supplier_return_items SET stock_removed_qty = stock_removed_qty * ${factor} WHERE purchase_item_id IN (SELECT id FROM purchase_order_items WHERE product_id = ${productId}::uuid)`;
  await tx.product.update({ where: { id: productId }, data: { quantity: expectedQty * factor,
    cost_price: Number(product.cost_price) / factor, packaging_converted_at: new Date() } });
}
