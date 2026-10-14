import type { Prisma } from "@prisma/client";
import { InventoryError, syncProductStock } from "./inventory";
import { planInvoiceReturn, type ReturnSelection } from "./invoiceReturns";

export async function saveSupplierReturn(tx: Prisma.TransactionClient, input: {
  invoiceId: string; requestId: string; date: string; reason: string; selections: ReturnSelection[];
}, user: { email: string; name: string }) {
  await tx.$queryRawUnsafe('SELECT id FROM purchase_orders WHERE id = $1::uuid FOR UPDATE', input.invoiceId);
  const existing = await tx.supplierReturn.findUnique({ where: { request_id: input.requestId } });
  if (existing) {
    if (existing.purchase_order_id !== input.invoiceId) throw new InventoryError("This request was already used for another purchase invoice.");
    return existing;
  }
  const purchase = await tx.purchaseOrder.findUnique({ where: { id: input.invoiceId }, include: { items: { include: { stock_batch: true } } } });
  if (!purchase) throw new InventoryError("Supplier invoice not found.");
  if (!purchase.supplier_id) throw new InventoryError("This invoice has no linked supplier. Link the supplier before returning it.");
  const supplier = await tx.supplier.findUnique({ where: { id: purchase.supplier_id } });
  if (!supplier) throw new InventoryError("The linked supplier no longer exists.");
  if (input.date < purchase.order_date.toISOString().slice(0, 10)) throw new InventoryError("Return date cannot be before the purchase invoice date.");
  const previous = await tx.supplierReturnItem.findMany({ where: { purchase_item_id: { in: purchase.items.map(item => item.id) } } });
  const plan = planInvoiceReturn({ id: purchase.id, grand_total: purchase.grand_total,
    discount_amount: purchase.items.reduce((sum, item) => sum + Number(item.amount), 0) - Number(purchase.grand_total),
    items: purchase.items.map(item => ({ ...item, category: item.description, stock_deducted_qty: item.stock_received_qty })) },
    previous.map(item => ({ invoice_item_id: item.purchase_item_id, qty: item.qty, stock_restored_qty: item.stock_removed_qty, amount: item.amount, revenue: item.amount })), input.selections);
  const record = await tx.supplierReturn.create({ data: { request_id: input.requestId, purchase_order_id: purchase.id,
    return_date: new Date(input.date), reason: input.reason, amount: plan.amount, created_by_email: user.email, created_by_name: user.name } });
  const productIds = [...new Set(plan.lines.filter(line => line.stock_restored_qty > 0).map(line => line.product_id!))].sort();
  for (const id of productIds) await tx.$queryRawUnsafe('SELECT id FROM products WHERE id = $1::uuid FOR UPDATE', id);
  for (const line of plan.lines) {
    const item = purchase.items.find(item => item.id === line.invoice_item_id)!;
    const removed = line.stock_restored_qty;
    const batch = item.stock_batch;
    if (removed > 0) {
      if (!batch) throw new InventoryError("This purchase invoice has missing batch history. Review its stock before returning it.");
      const changed = await tx.stockBatch.updateMany({ where: { id: batch.id, remaining_qty: { gte: removed } }, data: { remaining_qty: { decrement: removed } } });
      if (changed.count !== 1) throw new InventoryError(`Not enough unsold stock remains from this purchase for ${line.product_name}. Reduce the return quantity.`);
    }
    await tx.supplierReturnItem.create({ data: { return_id: record.id, purchase_item_id: item.id, batch_id: batch?.id ?? null,
      product_name: item.description, description: item.description, qty: line.qty, stock_removed_qty: removed, amount: line.amount } });
  }
  for (const id of productIds) await syncProductStock(tx, id);
  const credit = await tx.cashbook.create({ data: { type: "out", method: "Adjustment", amount: plan.amount,
    date: new Date(input.date), description: `Supplier return ${purchase.po_number} / ${record.id}${input.reason ? `: ${input.reason}` : ""}`,
    account_name: supplier.name, reference: supplier.id, created_by_email: user.email, created_by_name: user.name } });
  const saved = await tx.supplierReturn.update({ where: { id: record.id }, data: { credit_entry_id: credit.id } });
  const allReturns = await tx.supplierReturn.findMany({ where: { purchase_order_id: purchase.id } });
  const due = Math.round((Number(purchase.grand_total) - Number(purchase.amount_paid) - allReturns.reduce((sum, item) => sum + Number(item.amount), 0)) * 100) / 100;
  await tx.purchaseOrder.update({ where: { id: purchase.id }, data: { balance_due: due,
    payment_status: due <= 0 ? "paid" : Number(purchase.amount_paid) > 0 || allReturns.length ? "partial" : "unpaid" } });
  await tx.activityLog.create({ data: { action: "create", entity_type: "supplier_return", entity_id: record.id,
    title: `Supplier return: ${purchase.po_number}`, subtitle: supplier.name, amount: plan.amount, user_email: user.email, user_name: user.name } });
  return saved;
}
