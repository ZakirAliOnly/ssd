import type { Prisma } from "@prisma/client";
import { InventoryError, roundQuantity, syncProductStock } from "./inventory";
import { lockInventoryUnits } from "./inventoryUnits";
import { assertReturnPeriodOpen, businessDate, requiresLateConfirmation } from "./returnPeriod";
import { settlePartyInvoices } from "./partyInvoiceSettlement";

export type ReturnKind = "sales" | "supplier";
export async function reverseReturn(tx: Prisma.TransactionClient, input: {
  id: string; type: ReturnKind; reason: string; lateConfirmation?: string; refundReviewed: boolean;
}, actor: { email: string; name: string }, now = new Date()) {
  await lockInventoryUnits(tx);
  const sales = input.type === "sales";
  const record = sales
    ? await tx.invoiceReturn.findUnique({ where: { id: input.id } })
    : await tx.supplierReturn.findUnique({ where: { id: input.id } });
  if (!record) throw new InventoryError("Return not found. Reload the history.");
  // Retrying after a lost response must not move stock or credit twice.
  if (record.reversed_at) return { id: record.id, reversed_at: record.reversed_at };
  const date = businessDate(now);
  await assertReturnPeriodOpen(tx, [record.return_date.toISOString().slice(0, 10), date]);
  if (requiresLateConfirmation(record.created_at, now) && input.lateConfirmation !== "REVERSE") {
    throw new InventoryError("This return is over 24 hours old. Review its stock and balance effects and type REVERSE to confirm.");
  }
  if (!input.refundReviewed) throw new InventoryError("Confirm that any separately recorded cash refund has been reviewed and resolved. Reversal does not move cash.");
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new InventoryError("Enter a reversal reason of 1–1,000 characters.");
  const originalCredit = record.credit_entry_id ? await tx.cashbook.findUnique({ where: { id: record.credit_entry_id } }) : null;
  if (!originalCredit || originalCredit.method !== "Adjustment" || originalCredit.type !== "out"
      || Number(originalCredit.amount) !== Number(record.amount)) throw new InventoryError("The original return credit is missing or changed. Review its ledger before reversing.");
  await tx.$queryRawUnsafe('SELECT id FROM cashbook WHERE id = $1::uuid FOR UPDATE', originalCredit.id);
  const movements = new Map<string, { productId: string; qty: number }>();
  const add = (batchId: string, productId: string, qty: number) => {
    const previous = movements.get(batchId);
    movements.set(batchId, { productId, qty: roundQuantity((previous?.qty ?? 0) + qty) });
  };
  if (sales) {
    const lines = await tx.invoiceReturnItem.findMany({ where: { return_id: record.id }, include: { allocations: { include: { stock_allocation: true } } } });
    for (const line of lines) {
      const physical = Number(line.stock_restored_qty);
      if (!physical) continue;
      if (!line.product_id) throw new InventoryError("Return product history is incomplete. Use a reviewed adjustment.");
      let tracked = 0;
      for (const allocation of line.allocations) {
        add(allocation.stock_allocation.batch_id, line.product_id, Number(allocation.qty));
        tracked = roundQuantity(tracked + Number(allocation.qty));
      }
      const remaining = roundQuantity(physical - tracked);
      if (remaining < 0 || remaining > 0 && !line.restored_batch_id) throw new InventoryError("This older return has incomplete batch history. Use a reviewed stock and ledger adjustment.");
      if (remaining > 0) add(line.restored_batch_id!, line.product_id, remaining);
    }
  } else {
    const lines = await tx.supplierReturnItem.findMany({ where: { return_id: record.id }, include: { purchase_item: true } });
    for (const line of lines) {
      if (!Number(line.stock_removed_qty)) continue;
      if (!line.batch_id || !line.purchase_item.product_id) throw new InventoryError("Supplier return batch history is incomplete. Use a reviewed adjustment.");
      add(line.batch_id, line.purchase_item.product_id, Number(line.stock_removed_qty));
    }
  }
  const products = [...new Set([...movements.values()].map(m => m.productId))].sort();
  for (const id of products) await tx.$queryRawUnsafe('SELECT id FROM products WHERE id = $1::uuid FOR UPDATE', id);
  for (const [batchId, movement] of [...movements].sort(([a], [b]) => a.localeCompare(b))) {
    const batch = await tx.stockBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.product_id !== movement.productId) throw new InventoryError("Return batch ownership changed. Review its history.");
    if (sales && Number(batch.remaining_qty) < movement.qty) throw new InventoryError("Not enough stock remains in the original returned batch. It may already have been sold; reversal is blocked.");
    if (!sales && roundQuantity(Number(batch.remaining_qty) + movement.qty) > Number(batch.received_qty)) throw new InventoryError("Restoring this supplier return would exceed its original batch receipt. Review stock history.");
    await tx.stockBatch.update({ where: { id: batchId }, data: { remaining_qty: sales ? { decrement: movement.qty } : { increment: movement.qty } } });
    await tx.returnReversalStock.create({ data: { batch_id: batchId, qty: movement.qty, movement_date: new Date(date),
      ...(sales ? { sales_return_id: record.id } : { supplier_return_id: record.id }) } });
  }
  for (const id of products) await syncProductStock(tx, id);
  // Append the exact opposite noncash entry; leave original financial history intact.
  const credit = await tx.cashbook.create({ data: { type: "in", method: "Adjustment", amount: record.amount,
    date: new Date(date), account_name: originalCredit.account_name, reference: originalCredit.reference,
    description: `${sales ? "Sales" : "Supplier"} return reversal ${record.id}: ${reason}`,
    created_by_email: actor.email, created_by_name: actor.name } });
  const data = { reversed_at: now, reversal_reason: reason, reversed_by_email: actor.email, reversed_by_name: actor.name, reversal_credit_entry_id: credit.id };
  if (sales) {
    const saved = await tx.invoiceReturn.update({ where: { id: record.id }, data });
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: saved.invoice_id } });
    if (!invoice.is_walk_in) await settlePartyInvoices(tx, invoice.client_name);
    else {
      const active = await tx.invoiceReturn.findMany({ where: { invoice_id: invoice.id, reversed_at: null } });
      const net = Number(invoice.grand_total) - active.reduce((s, r) => s + Number(r.amount), 0);
      const due = Math.round((net - Number(invoice.amount_received)) * 100) / 100;
      await tx.invoice.update({ where: { id: invoice.id }, data: { balance_due: due,
        payment_status: due <= 0 ? "paid" : Number(invoice.amount_received) > 0 || active.length ? "partial" : "unpaid" } });
    }
  } else {
    const saved = await tx.supplierReturn.update({ where: { id: record.id }, data });
    const purchase = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: saved.purchase_order_id } });
    const active = await tx.supplierReturn.findMany({ where: { purchase_order_id: purchase.id, reversed_at: null } });
    const due = Math.round((Number(purchase.grand_total) - Number(purchase.amount_paid) - active.reduce((s, r) => s + Number(r.amount), 0)) * 100) / 100;
    await tx.purchaseOrder.update({ where: { id: purchase.id }, data: { balance_due: due,
      payment_status: due <= 0 ? "paid" : Number(purchase.amount_paid) > 0 || active.length ? "partial" : "unpaid" } });
  }
  await tx.activityLog.create({ data: { action: "update", entity_type: sales ? "invoice_return" : "supplier_return", entity_id: record.id,
    title: "Return reversed", subtitle: reason, amount: record.amount, user_email: actor.email, user_name: actor.name,
    metadata: JSON.stringify({ late: requiresLateConfirmation(record.created_at, now), refundReviewed: true, reversal_credit_entry_id: credit.id }) } });
  return { id: record.id, reversed_at: now };
}
