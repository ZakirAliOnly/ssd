import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { loadPartyCashbook } from "./partyCashbook";
import { computePartySignedBalance } from "./partyBalance";
import { settlePartyInvoices } from "./partyInvoiceSettlement";
import { businessDate } from "./returnPeriod";
import type { Invoice, CashbookEntry } from "./database.types";

import { InventoryError } from "./inventory";
export class SettlementError extends InventoryError {}
const cents = (n: unknown) => Math.round(Number(n) * 100);
const serial = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));
export type SettlementActor = { email: string; name: string };
export type SettlementInput = { request_id: string; customer_id: string; supplier_id: string; amount: number; date: string; reference: string; notes: string };

export async function customerOutstanding(tx: Prisma.TransactionClient, name: string) {
  const invoices = await tx.invoice.findMany({ where: { client_name: name, is_walk_in: false } });
  const cash = await tx.cashbook.findMany({ where: { account_name: { equals: name, mode: "insensitive" } } });
  const owned = await loadPartyCashbook(tx, cash, invoices.map(i => i.id));
  return computePartySignedBalance(name, serial<Invoice[]>(invoices), serial<CashbookEntry[]>(owned));
}

async function supplierOrders(tx: Prisma.TransactionClient, id: string, name: string) {
  const names = await tx.supplier.count({ where: { name: { equals: name, mode: "insensitive" } } });
  return tx.purchaseOrder.findMany({ where: { OR: [{ supplier_id: id }, ...(names === 1 ? [{ supplier_id: null, supplier_name: { equals: name, mode: "insensitive" as const } }] : [])] },
    include: { returns: { where: { reversed_at: null }, select: { amount: true } } },
    orderBy: [{ order_date: "asc" }, { created_at: "asc" }, { id: "asc" }] });
}
const collectible = (p: { grand_total: unknown; returns: { amount: unknown }[] }) => Math.max(0, cents(p.grand_total) - p.returns.reduce((s, r) => s + cents(r.amount), 0));

export async function createDirectSettlement(tx: Prisma.TransactionClient, input: SettlementInput, actor: SettlementActor) {
  const existing = await tx.directSettlement.findUnique({ where: { request_id: input.request_id } });
  if (existing) {
    if (existing.customer_id !== input.customer_id || existing.supplier_id !== input.supplier_id || cents(existing.amount) !== cents(input.amount)
      || existing.date.toISOString().slice(0, 10) !== input.date || existing.reference !== input.reference || existing.notes !== input.notes) throw new SettlementError("This request was already used for different details. Reload history.");
    return existing;
  }
  const customer = await tx.account.findUnique({ where: { id: input.customer_id } });
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplier_id } });
  if (!customer || !supplier) throw new SettlementError("Select an existing customer and supplier.");
  if (customer.status !== "Active") throw new SettlementError("Select an active customer.");
  if (await tx.account.count({ where: { name: { equals: customer.name, mode: "insensitive" } } }) !== 1) throw new SettlementError("More than one party has this name. Resolve duplicate party names before settling.");
  const orders = await supplierOrders(tx, supplier.id, supplier.name);
  const amount = cents(input.amount);
  const opening = cents(supplier.opening_balance);
  if (opening < 0 || orders.some(p => cents(p.amount_paid) < 0 || cents(p.amount_paid) > collectible(p))) throw new SettlementError("Supplier history contains a credit or overpayment. Review its ledger before settling.");
  const due = opening + orders.reduce((s, p) => s + Math.max(0, collectible(p) - cents(p.amount_paid)), 0);
  const customerDue = cents(await customerOutstanding(tx, customer.name));
  if (amount > customerDue || amount > due) throw new SettlementError("Amount exceeds the customer's outstanding balance or the supplier's payable. Refresh balances and reduce the amount.");
  const id = randomUUID();
  const base = { amount: amount / 100, date: new Date(input.date), method: "Adjustment", type: "out", created_by_email: actor.email, created_by_name: actor.name };
  const customerEntry = await tx.cashbook.create({ data: { ...base, account_name: customer.name, reference: `direct:${id}`, description: `Customer direct settlement — paid to ${supplier.name} — ${id}` } });
  const supplierEntry = await tx.cashbook.create({ data: { ...base, account_name: supplier.name, reference: supplier.id, description: `Supplier direct settlement — paid by ${customer.name} — ${id}` } });
  const openingApplied = Math.min(opening, amount);
  let remaining = amount - openingApplied;
  const record = await tx.directSettlement.create({ data: { id, ...input, date: new Date(input.date), customer_name: customer.name, supplier_name: supplier.name,
    opening_applied: openingApplied / 100, customer_entry_id: customerEntry.id, supplier_entry_id: supplierEntry.id, created_by_email: actor.email, created_by_name: actor.name } });
  await tx.supplier.update({ where: { id: supplier.id }, data: { opening_balance: (opening - openingApplied) / 100 } });
  for (const order of orders) {
    const applied = Math.min(remaining, Math.max(0, collectible(order) - cents(order.amount_paid)));
    if (!applied) continue;
    remaining -= applied;
    const paid = cents(order.amount_paid) + applied, balance = collectible(order) - paid;
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { amount_paid: paid / 100, balance_due: balance / 100, payment_status: balance === 0 ? "paid" : "partial" } });
    await tx.directSettlementAllocation.create({ data: { settlement_id: id, purchase_order_id: order.id, amount: applied / 100 } });
  }
  if (remaining) throw new SettlementError("Supplier balances changed. Reload and try again.");
  await settlePartyInvoices(tx, customer.name);
  await tx.account.update({ where: { id: customer.id }, data: { balance: (customerDue - amount) / 100, bal_type: "credit" } });
  await tx.activityLog.create({ data: { action: "create", entity_type: "direct_settlement", entity_id: id, title: "Customer paid supplier directly",
    subtitle: `${customer.name} → ${supplier.name} · No cash movement`, amount: amount / 100, user_email: actor.email, user_name: actor.name } });
  return record;
}

export async function reverseDirectSettlement(tx: Prisma.TransactionClient, id: string, reason: string, actor: SettlementActor) {
  const record = await tx.directSettlement.findUnique({ where: { id }, include: { allocations: { include: { purchase_order: { include: { returns: { where: { reversed_at: null }, select: { amount: true } } } } } }, customer_entry: true, supplier_entry: true, customer: true } });
  if (!record) throw new SettlementError("Settlement not found.");
  if (record.reversed_at) return record;
  // Ledger names are legacy keys; refuse an inconsistent rename rather than credit another party.
  if (record.customer_entry.account_name.toLowerCase() !== record.customer.name.toLowerCase()
      || await tx.account.count({ where: { name: { equals: record.customer.name, mode: "insensitive" } } }) !== 1) throw new SettlementError("Party name history is inconsistent. Review its ledger before reversing.");
  for (const entry of [record.customer_entry, record.supplier_entry]) {
    if (entry.type !== "out" || entry.method !== "Adjustment" || cents(entry.amount) !== cents(record.amount)) throw new SettlementError("A linked entry changed. Review the settlement before reversing.");
  }
  for (const allocation of record.allocations) {
    const order = allocation.purchase_order;
    const paid = cents(order.amount_paid) - cents(allocation.amount);
    if (paid < 0) throw new SettlementError("Purchase payments changed. Review the supplier ledger before reversing.");
    const balance = Math.max(0, collectible(order) - paid);
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { amount_paid: paid / 100, balance_due: balance / 100,
      payment_status: balance === 0 ? "paid" : paid || order.returns.length ? "partial" : "unpaid" } });
  }
  await tx.supplier.update({ where: { id: record.supplier_id }, data: { opening_balance: { increment: record.opening_applied } } });
  const date = new Date(businessDate());
  const base = { type: "in", method: "Adjustment", amount: record.amount, date, created_by_email: actor.email, created_by_name: actor.name };
  const customer = await tx.cashbook.create({ data: { ...base, account_name: record.customer.name, reference: `direct:${id}`, description: `Customer direct settlement reversal — ${id}` } });
  const supplier = await tx.cashbook.create({ data: { ...base, account_name: record.supplier_entry.account_name, reference: record.supplier_id, description: `Supplier direct settlement reversal — ${id}` } });
  const result = await tx.directSettlement.update({ where: { id }, data: { reversed_at: new Date(), reversal_reason: reason, reversed_by_email: actor.email,
    reversed_by_name: actor.name, customer_reversal_id: customer.id, supplier_reversal_id: supplier.id } });
  await settlePartyInvoices(tx, record.customer.name);
  const balance = await customerOutstanding(tx, record.customer.name);
  await tx.account.update({ where: { id: record.customer_id }, data: { balance: Math.abs(balance), bal_type: balance >= 0 ? "credit" : "debit" } });
  await tx.activityLog.create({ data: { action: "update", entity_type: "direct_settlement", entity_id: id, title: "Direct settlement reversed", subtitle: reason,
    amount: record.amount, user_email: actor.email, user_name: actor.name } });
  return result;
}

export async function assertNoDirectSettlementEntries(tx: Prisma.TransactionClient, ids: string[]) {
  const found = await tx.directSettlement.findFirst({ where: { OR: ["customer_entry_id", "supplier_entry_id", "customer_reversal_id", "supplier_reversal_id"].map(key => ({ [key]: { in: ids } })) }, select: { id: true } });
  if (found) throw new SettlementError("Direct settlement entries are protected. Reverse the linked settlement from Payment Methods instead.");
}
