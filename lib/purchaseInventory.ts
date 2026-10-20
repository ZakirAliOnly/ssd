import type { Prisma } from "@prisma/client";
import { resolveLineUnit } from "./inventoryUnits";
import { InventoryError, syncProductStock, roundQuantity, validQuantity } from "./inventory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function purchaseDate(value: unknown, nullable = false): Date | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new InventoryError("Enter a valid date or choose Non-expiry.");
  return new Date(value);
}

export function purchaseLines(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new InventoryError("Add between 1 and 500 purchase items.");
  const ids = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new InventoryError("Invalid purchase item.");
    const id = row.id == null ? null : String(row.id).toLowerCase();
    const product_id = row.product_id == null ? null : String(row.product_id).toLowerCase();
    if ((id && (!UUID.test(id) || ids.has(id))) || (product_id && !UUID.test(product_id))) throw new InventoryError("Invalid or repeated purchase item.");
    if (id) ids.add(id);
    const qty = Number(row.qty), rate = Number(row.rate);
    if (!validQuantity(qty) || qty <= 0) throw new InventoryError("Purchase quantity must be positive with up to two decimal places.");
    if (!Number.isFinite(rate) || rate < 0 || rate > 9999999999.99) throw new InventoryError("Enter a valid purchase price.");
    const amount = Math.round(qty * rate * 100) / 100;
    if (amount > 9999999999.99) throw new InventoryError("Purchase line amount is too large.");
    return { id, product_id, unit: typeof row.unit === "string" ? row.unit : undefined,
      unit_factor: row.unit_factor == null ? undefined : Number(row.unit_factor), description: String(row.description ?? ""), expiry_date: purchaseDate(row.expiry_date ?? null, true), qty, rate, amount };
  });
}

export async function receivePurchaseItems(tx: Prisma.TransactionClient, purchaseId: string,
  lines: ReturnType<typeof purchaseLines>, receivedDate: Date) {
  const previous = await tx.purchaseOrderItem.findMany({ where: { purchase_order_id: purchaseId }, include: { stock_batch: true } });
  const oldById = new Map(previous.map(line => [line.id, line]));
  const products = [...new Set([...previous.map(line => line.product_id), ...lines.map(line => line.product_id)].filter((id): id is string => !!id))].sort();
  for (const id of products) await tx.$queryRawUnsafe('SELECT id FROM products WHERE id = $1::uuid FOR UPDATE', id);
  const kept = new Set(lines.map(line => line.id).filter(Boolean));
  const savedItems = [];
  for (const old of previous) {
    if (kept.has(old.id)) continue;
    if (old.stock_batch) {
      if (Number(old.stock_batch.received_qty) !== Number(old.stock_batch.remaining_qty)) throw new InventoryError("This purchase batch has already been sold and cannot be removed.");
      await tx.stockBatch.delete({ where: { id: old.stock_batch.id } });
    }
    await tx.purchaseOrderItem.delete({ where: { id: old.id } });
  }
  for (const line of lines) {
    const old = line.id ? oldById.get(line.id) : undefined;
    if (line.id && !old) throw new InventoryError("A purchase item changed. Reload the invoice before saving.");
    if (!line.product_id && !(old && !old.product_id)) throw new InventoryError("Select a product for every new purchase item.");
    const product = line.product_id ? await tx.product.findUnique({ where: { id: line.product_id } }) : null;
    if (line.product_id && !product) throw new InventoryError("A selected product no longer exists.");
    const units = await resolveLineUnit(tx, line.product_id, line.unit, line.unit_factor, old);
    const baseQty = roundQuantity(line.qty * units.unit_factor);
    if (!validQuantity(baseQty)) throw new InventoryError("Converted purchase quantity is too large.");
    const batch = old?.stock_batch;
    // Linking an unidentified historical line keeps its untracked baseline.
    const productChanged = old?.product_id != null && old.product_id !== line.product_id;
    // When first identifying an untracked historical line, the explicitly
    // selected unit also describes its old quantity. Never receive its old stock twice.
    const baselineFactor = old?.product_id == null ? units.unit_factor : Number(old.unit_factor ?? 1);
    const baseline = old ? roundQuantity(Number(old.qty) * baselineFactor - Number(old.stock_received_qty)) : 0;
    if (productChanged && baseline > 0) throw new InventoryError("An older purchase with untracked stock cannot change product. Create a new purchase instead.");
    const receivedQty = line.product_id ? roundQuantity(Math.max(0, baseQty - (productChanged ? 0 : baseline))) : 0;
    const sold = batch ? roundQuantity(Number(batch.received_qty) - Number(batch.remaining_qty)) : 0;
    if (receivedQty < sold || (productChanged && sold > 0)) throw new InventoryError("Purchase quantity cannot be reduced below the units already sold, or moved to another product after sale.");
    if (batch && productChanged) await tx.stockBatch.delete({ where: { id: batch.id } });
    const data = { product_id: line.product_id, description: product?.name ?? line.description,
      expiry_date: line.expiry_date, ...units, qty: line.qty, rate: line.rate, amount: line.amount,
      stock_received_qty: receivedQty };
    const saved = old ? await tx.purchaseOrderItem.update({ where: { id: old.id }, data })
      : await tx.purchaseOrderItem.create({ data: { ...data, purchase_order_id: purchaseId } });
    savedItems.push(saved);
    if (batch && !productChanged) {
      await tx.stockBatch.update({ where: { id: batch.id }, data: { received_qty: receivedQty,
        remaining_qty: roundQuantity(receivedQty - sold), unit_cost: line.rate / units.unit_factor, expiry_date: line.expiry_date, received_date: receivedDate } });
    } else if (receivedQty > 0 && line.product_id) {
      await tx.stockBatch.create({ data: { product_id: line.product_id, purchase_item_id: saved.id,
        received_qty: receivedQty, remaining_qty: receivedQty, unit_cost: line.rate / units.unit_factor, expiry_date: line.expiry_date, received_date: receivedDate } });
    }
  }
  for (const id of products) await syncProductStock(tx, id);
  return savedItems;
}
