import type { Prisma } from "@prisma/client";

export class InventoryError extends Error {}

export const roundQuantity = (value: number) => Math.round(value * 100) / 100;
export function validQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 2147483647 && Math.abs(value - roundQuantity(value)) < 0.00000001;
}

export interface StockLine {
  product_id: string | null;
  qty: number;
  unit_factor?: number;
  stock_deducted_qty: number;
}

/** Legacy lines have zero deducted stock: editing them must not consume stock retroactively. */
export function planStockChange(previous: StockLine[], next: Omit<StockLine, "stock_deducted_qty">[]) {
  const baseline = new Map<string, number>();
  const deducted = new Map<string, number>();
  for (const line of previous) {
    if (!line.product_id) continue;
    baseline.set(line.product_id, roundQuantity((baseline.get(line.product_id) ?? 0) + roundQuantity(line.qty * (line.unit_factor ?? 1)) - line.stock_deducted_qty));
    deducted.set(line.product_id, roundQuantity((deducted.get(line.product_id) ?? 0) + line.stock_deducted_qty));
  }
  const quantities = new Map<string, number>();
  const lines = next.map(line => {
    if (!validQuantity(line.qty) || line.qty <= 0 || line.qty > 2147483647) {
      throw new InventoryError("Each invoice item must have a positive quantity with up to two decimal places.");
    }
    if (!line.product_id) return { ...line, stock_deducted_qty: 0 };
    const baseQty = roundQuantity(line.qty * (line.unit_factor ?? 1));
    if (!validQuantity(baseQty)) throw new InventoryError("Converted stock quantity is too large.");
    const exempt = Math.min(baseQty, baseline.get(line.product_id) ?? 0);
    baseline.set(line.product_id, (baseline.get(line.product_id) ?? 0) - exempt);
    const amount = roundQuantity(baseQty - exempt);
    quantities.set(line.product_id, roundQuantity((quantities.get(line.product_id) ?? 0) + amount));
    return { ...line, stock_deducted_qty: amount };
  });
  const deltas = [...new Set([...deducted.keys(), ...quantities.keys()])].sort().map(product_id => ({
    product_id, consumed: roundQuantity((quantities.get(product_id) ?? 0) - (deducted.get(product_id) ?? 0)),
  }));
  return { lines, deltas };
}

export async function syncProductStock(tx: Prisma.TransactionClient, productId: string) {
  const batches = await tx.stockBatch.findMany({ where: { product_id: productId, remaining_qty: { gt: 0 } },
    orderBy: [{ received_date: "asc" }, { created_at: "asc" }, { id: "asc" }] });
  const quantity = roundQuantity(batches.reduce((sum, batch) => sum + Number(batch.remaining_qty), 0));
  if (!validQuantity(quantity) || quantity > 2147483647) throw new InventoryError("Total product stock is too large.");
  await tx.product.update({ where: { id: productId }, data: {
    quantity,
    expiry_date: batches[0]?.expiry_date ?? null,
  } });
}

export async function createOpeningBatch(tx: Prisma.TransactionClient, product: {
  id: string; quantity: number | Prisma.Decimal; expiry_date: Date | null; created_at: Date; cost_price?: number | Prisma.Decimal;
}) {
  if (Number(product.quantity) <= 0) return;
  await tx.stockBatch.create({ data: { product_id: product.id, received_qty: product.quantity,
    remaining_qty: product.quantity, unit_cost: product.cost_price ?? null, expiry_date: product.expiry_date, received_date: product.created_at } });
}

/** Caller holds the product row lock; adjustments preserve existing sale allocations. */
export async function adjustProductStock(tx: Prisma.TransactionClient, product: {
  id: string; quantity: number | Prisma.Decimal; expiry_date: Date | null; cost_price?: number | Prisma.Decimal;
}, quantity: number) {
  const batches = await tx.stockBatch.findMany({ where: { product_id: product.id, remaining_qty: { gt: 0 } },
    orderBy: [{ received_date: "asc" }, { created_at: "asc" }, { id: "asc" }] });
  if (roundQuantity(batches.reduce((sum, batch) => sum + Number(batch.remaining_qty), 0)) !== Number(product.quantity)) {
    throw new InventoryError("Product stock and batches do not match. Reload before saving.");
  }
  const delta = roundQuantity(quantity - Number(product.quantity));
  if (delta > 0) {
    await tx.stockBatch.create({ data: { product_id: product.id, received_qty: delta, remaining_qty: delta,
      unit_cost: product.cost_price ?? null, expiry_date: product.expiry_date, received_date: new Date() } });
  } else {
    let needed = -delta;
    for (const batch of batches) {
      if (!needed) break;
      const removed = Math.min(needed, Number(batch.remaining_qty));
      await tx.stockBatch.update({ where: { id: batch.id }, data: { remaining_qty: { decrement: removed } } });
      needed = roundQuantity(needed - removed);
    }
  }
  await syncProductStock(tx, product.id);
}

async function adjustBatches(tx: Prisma.TransactionClient, productId: string, consumed: number, invoiceId: string) {
  if (consumed > 0) {
    const batches = await tx.stockBatch.findMany({ where: { product_id: productId, remaining_qty: { gt: 0 } },
      orderBy: [{ received_date: "asc" }, { created_at: "asc" }, { id: "asc" }] });
    let needed = consumed;
    for (const batch of batches) {
      const qty = Math.min(needed, Number(batch.remaining_qty));
      if (!qty) break;
      const changed = await tx.stockBatch.updateMany({ where: { id: batch.id, remaining_qty: { gte: qty } }, data: { remaining_qty: { decrement: qty } } });
      if (changed.count !== 1) throw new InventoryError("Stock changed during this sale. Try saving again.");
      await tx.stockAllocation.upsert({ where: { invoice_id_batch_id: { invoice_id: invoiceId, batch_id: batch.id } },
        create: { invoice_id: invoiceId, batch_id: batch.id, qty }, update: { qty: { increment: qty } } });
      needed = roundQuantity(needed - qty);
    }
    if (needed) throw new InventoryError("Product stock and batches do not match. Reload before saving.");
  } else {
    let returned = -consumed;
    const allocations = await tx.stockAllocation.findMany({ where: { invoice_id: invoiceId, batch: { product_id: productId } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }] });
    for (const allocation of allocations) {
      const qty = Math.min(returned, Number(allocation.qty));
      if (!qty) break;
      await tx.stockBatch.update({ where: { id: allocation.batch_id }, data: { remaining_qty: { increment: qty } } });
      if (qty === Number(allocation.qty)) await tx.stockAllocation.delete({ where: { id: allocation.id } });
      else await tx.stockAllocation.update({ where: { id: allocation.id }, data: { qty: { decrement: qty } } });
      returned = roundQuantity(returned - qty);
    }
    if (returned) {
      // Deductions recorded before batch tracking have no allocation records.
      const opening = await tx.stockBatch.findMany({ where: { product_id: productId, purchase_item_id: null },
        orderBy: [{ received_date: "asc" }, { created_at: "asc" }, { id: "asc" }], take: 1 });
      if (opening[0]) {
        await tx.stockBatch.update({ where: { id: opening[0].id }, data: {
          received_qty: { increment: returned }, remaining_qty: { increment: returned },
        } });
      } else {
        const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
        await tx.stockBatch.create({ data: { product_id: productId, received_qty: returned, remaining_qty: returned,
          expiry_date: product.expiry_date, received_date: product.created_at } });
      }
    }
  }
  await syncProductStock(tx, productId);
}

export async function applyStockChange(tx: Prisma.TransactionClient, previous: StockLine[], next: Omit<StockLine, "stock_deducted_qty">[], invoiceId: string) {
  const plan = planStockChange(previous, next);
  // Stable product ordering reduces deadlocks. The guarded UPDATE is atomic,
  // so two users cannot both sell the same remaining units.
  for (const { product_id, consumed } of plan.deltas) {
    if (consumed === 0) continue;
    const result = await tx.product.updateMany({
      where: { id: product_id, ...(consumed > 0 ? { quantity: { gte: consumed } } : {}) },
      data: { quantity: { decrement: consumed } },
    });
    if (result.count !== 1) {
      const product = await tx.product.findUnique({ where: { id: product_id }, select: { name: true, quantity: true } });
      throw new InventoryError(product
        ? Number(product.quantity) <= 0
          ? `${product.name} is out of stock. Add stock before selling this product.`
          : `Insufficient stock for ${product.name}: ${product.quantity} available, ${consumed} additional units needed.`
        : "A selected product no longer exists. Reload the products and try again.");
    }
    await adjustBatches(tx, product_id, consumed, invoiceId);
  }
  return plan.lines;
}

export function invoiceStockLines(items: unknown) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) throw new InventoryError("Add between 1 and 500 invoice items.");
  return items.map((item: Record<string, unknown>) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InventoryError("Invalid invoice item.");
    const product_id = item.product_id == null ? null : String(item.product_id).toLowerCase();
    if (product_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product_id)) throw new InventoryError("Select a valid product.");
    const qty = Number(item.qty);
    const discount_pct = Number(item.discount_pct ?? 0);
    if (!Number.isFinite(discount_pct) || discount_pct < 0 || discount_pct > 100) throw new InventoryError("Product discount percentage must be between 0 and 100.");
    if (!validQuantity(qty) || qty <= 0 || qty > 2147483647) throw new InventoryError("Each invoice item must have a positive quantity with up to two decimal places.");
    const numbers = Object.fromEntries(["width", "height", "sqft", "rate", "amount"].map(key => {
      const value = Number(item[key] ?? 0);
      if (!Number.isFinite(value) || value < 0) throw new InventoryError(`Invalid invoice item ${key}.`);
      return [key, value];
    }));
    return { product_id, qty, unit: typeof item.unit === "string" ? item.unit : undefined,
      unit_factor: item.unit_factor == null ? undefined : Number(item.unit_factor),
      source_item_id: typeof item.source_item_id === "string" ? item.source_item_id : undefined, discount_pct, category: String(item.category ?? ""), description: String(item.description ?? ""), ...numbers };
  });
}
