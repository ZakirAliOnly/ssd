import type { Prisma } from "@prisma/client";
import { lockInventoryUnits } from "./inventoryUnits";
import { InventoryError, roundQuantity, validQuantity, syncProductStock } from "./inventory";

type Value = number | string | { toString(): string };
export type ReturnLineSource = { id: string; product_id: string | null; category: string; description: string;
  unit?: string; qty: Value; unit_factor?: Value; stock_deducted_qty: Value; amount: Value };
export type ReturnedLine = { invoice_item_id: string; qty: Value; stock_restored_qty: Value; amount: Value; revenue: Value };
export type ReturnInvoiceSource = { id: string; grand_total: Value; discount_amount: Value; items: ReturnLineSource[] };
export type ReturnSelection = { invoice_item_id: string; qty: number };
const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => Math.round(value * 100) / 100;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allocate every cent once. In particular, a full return credits exactly the
// original invoice total, including its line discounts, invoice discount and tax.
function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) {
    if (total) throw new InventoryError("This invoice has no priced items to calculate a return.");
    return weights.map(() => 0);
  }
  const raw = weights.map(weight => total * weight / sum);
  const amounts = raw.map(Math.floor);
  let remainder = total - amounts.reduce((a, b) => a + b, 0);
  const order = raw.map((value, i) => ({ i, remainder: value - amounts[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) { if (remainder-- <= 0) break; amounts[i]++; }
  return amounts;
}

/** Use identical rounded line revenue for sales and returns in stock reports. */
export function invoiceLineRevenues(items: { id: string; amount: Value }[], discount: Value): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const weights = sorted.map(item => Number(item.amount));
  const amounts = distribute(cents(Math.max(0, weights.reduce((sum, value) => sum + value, 0) - Number(discount))), weights);
  return new Map(sorted.map((item, index) => [item.id, amounts[index] / 100]));
}

export function planInvoiceReturn(invoice: ReturnInvoiceSource, previous: ReturnedLine[], selections: ReturnSelection[]) {
  if (!selections.length || selections.length > 500) throw new InventoryError("Select at least one item to return.");
  const items = [...invoice.items].sort((a, b) => a.id.localeCompare(b.id));
  const weights = items.map(item => Number(item.amount));
  if (weights.some(value => !Number.isFinite(value) || value < 0) || !Number.isFinite(Number(invoice.grand_total)) || Number(invoice.grand_total) < 0) {
    throw new InventoryError("This invoice has invalid amounts. Review it before returning items.");
  }
  const lineCredits = distribute(cents(Number(invoice.grand_total)), weights);
  const revenues = invoiceLineRevenues(items, invoice.discount_amount);
  const lineRevenues = items.map(item => cents(revenues.get(item.id) ?? 0));
  const seen = new Set<string>();
  const lines = selections.map(selection => {
    if (seen.has(selection.invoice_item_id)) throw new InventoryError("Select each invoice item only once.");
    seen.add(selection.invoice_item_id);
    const index = items.findIndex(item => item.id === selection.invoice_item_id);
    const item = items[index];
    if (!item) throw new InventoryError("A selected item does not belong to this invoice.");
    const quantity = Number(item.qty);
    const qty = selection.qty;
    if (typeof qty !== "number" || !validQuantity(qty) || qty <= 0 || !validQuantity(quantity) || quantity <= 0) {
      throw new InventoryError("Return quantity must be positive with up to two decimal places.");
    }
    const earlier = previous.filter(line => line.invoice_item_id === item.id);
    const alreadyReturned = roundQuantity(earlier.reduce((sum, line) => sum + Number(line.qty), 0));
    const cumulative = roundQuantity(alreadyReturned + qty);
    if (cumulative > quantity) throw new InventoryError(`Only ${roundQuantity(quantity - alreadyReturned)} units remain returnable for ${item.category || "this product"}. Reload the invoice.`);
    const fraction = cumulative / quantity;
    const amount = money((Math.round(lineCredits[index] * fraction) - earlier.reduce((sum, line) => sum + cents(Number(line.amount)), 0)) / 100);
    const revenue = money((Math.round(lineRevenues[index] * fraction) - earlier.reduce((sum, line) => sum + cents(Number(line.revenue)), 0)) / 100);
    const baseQuantity = quantity * Number(item.unit_factor ?? 1);
    const stock_restored_qty = item.product_id ? roundQuantity(roundQuantity(baseQuantity * fraction)
      - earlier.reduce((sum, line) => sum + Number(line.stock_restored_qty), 0)) : 0;
    if (amount < 0 || revenue < 0 || stock_restored_qty < 0 || stock_restored_qty > roundQuantity(qty * Number(item.unit_factor ?? 1))) throw new InventoryError("Return history does not match this invoice. Review it before continuing.");
    return { invoice_item_id: item.id, product_id: item.product_id, product_name: item.category || "Invoice item",
      description: item.description, ...(item.unit ? { unit: item.unit } : {}), qty, stock_restored_qty, amount, revenue };
  });
  return { lines, amount: money(lines.reduce((sum, line) => sum + line.amount, 0)) };
}

export async function saveInvoiceReturn(tx: Prisma.TransactionClient, input: {
  invoiceId: string; requestId: string; date: string; reason: string; selections: ReturnSelection[];
}, user: { email: string; name: string }) {
  await lockInventoryUnits(tx);
  // All invoice saves, deletes and returns use this same lock.
  await tx.$queryRawUnsafe('SELECT id FROM invoices WHERE id = $1::uuid FOR UPDATE', input.invoiceId);
  const existing = await tx.invoiceReturn.findUnique({ where: { request_id: input.requestId } });
  if (existing) {
    if (existing.invoice_id !== input.invoiceId) throw new InventoryError("This request was already used for another invoice.");
    return existing;
  }
  const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { items: true } });
  if (!invoice) throw new InventoryError("Invoice not found. Search again and select an invoice.");
  if (input.date < invoice.invoice_date.toISOString().slice(0, 10)) throw new InventoryError("Return date cannot be before the invoice date.");
  const previous = await tx.invoiceReturnItem.findMany({ where: { invoice_item_id: { in: invoice.items.map(item => item.id) } } });
  const plan = planInvoiceReturn(invoice, previous, input.selections);
  const record = await tx.invoiceReturn.create({ data: {
    request_id: input.requestId, invoice_id: invoice.id, return_date: new Date(input.date),
    reason: input.reason, amount: plan.amount, created_by_email: user.email, created_by_name: user.name,
  } });
  // Lock products in the same order as sales to prevent lost stock updates.
  const products = [...new Set(plan.lines.filter(line => line.stock_restored_qty > 0).map(line => line.product_id!))].sort();
  for (const productId of products) await tx.$queryRawUnsafe('SELECT id FROM products WHERE id = $1::uuid FOR UPDATE', productId);
  for (const line of plan.lines) {
    const product = line.product_id ? await tx.product.findUnique({ where: { id: line.product_id }, select: { name: true } }) : null;
    const savedLine = await tx.invoiceReturnItem.create({ data: { ...line, product_name: product?.name ?? line.product_name, return_id: record.id } });
    if (!line.stock_restored_qty || !line.product_id) continue;
    let needed = line.stock_restored_qty;
    const allocations = await tx.stockAllocation.findMany({
      where: { invoice_id: invoice.id, batch: { product_id: line.product_id } },
      include: { returns: true }, orderBy: [{ created_at: "desc" }, { id: "desc" }],
    });
    for (const allocation of allocations) {
      const available = roundQuantity(Number(allocation.qty) - allocation.returns.reduce((sum, entry) => sum + Number(entry.qty), 0));
      const qty = Math.min(needed, available);
      if (qty <= 0) continue;
      await tx.stockBatch.update({ where: { id: allocation.batch_id }, data: { remaining_qty: { increment: qty } } });
      await tx.returnStockAllocation.create({ data: { return_item_id: savedLine.id, stock_allocation_id: allocation.id, qty } });
      needed = roundQuantity(needed - qty);
      if (!needed) break;
    }
    if (needed) {
      // Legacy sales have no batch allocation. Receive the physical return as a new batch.
      const source = await tx.product.findUniqueOrThrow({ where: { id: line.product_id } });
      await tx.stockBatch.create({ data: { product_id: line.product_id,
        received_qty: needed, remaining_qty: needed, unit_cost: source.cost_price, expiry_date: source.expiry_date,
        received_date: new Date(input.date) } });
    }
  }
  for (const productId of products) {
    await syncProductStock(tx, productId);
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    if (!validQuantity(Number(product.quantity))) throw new InventoryError("Restored stock exceeds the supported quantity.");
  }
  // A ledger-only credit reduces the party balance without inventing a cash refund.
  const credit = await tx.cashbook.create({ data: {
    type: "out", description: `Sales return ${invoice.invoice_number} / ${record.id}${input.reason ? `: ${input.reason}` : ""}`,
    amount: plan.amount, date: new Date(input.date), method: "Adjustment", reference: record.id,
    account_name: invoice.is_walk_in ? "" : invoice.client_name, created_by_email: user.email, created_by_name: user.name,
  } });
  const result = await tx.invoiceReturn.update({ where: { id: record.id }, data: { credit_entry_id: credit.id } });
  await tx.activityLog.create({ data: { action: "create", entity_type: "invoice_return", entity_id: record.id,
    title: `Return: ${invoice.invoice_number}`, subtitle: invoice.client_name, amount: plan.amount,
    user_email: user.email, user_name: user.name } });
  return result;
}
