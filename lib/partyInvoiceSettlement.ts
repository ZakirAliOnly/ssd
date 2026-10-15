import type { Prisma, PrismaClient } from "@prisma/client";

export async function partySettlementTransaction<T>(client: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await client.$transaction(work, { isolationLevel: "Serializable", timeout: 20000 }); }
    catch (error) { if (attempt >= 4 || (error as { code?: string }).code !== "P2034") throw error; }
  }
}

type SettlementInvoice = { id: string; grand_total: unknown; amount_received: unknown; invoice_date: Date | string; created_at: Date | string;
  returns: { amount: unknown; credit_entry_id: string | null }[] };
type SettlementCash = { id: string; type: string; amount: unknown; method: string; description: string; reference: string };
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const ledgerOnly = (c: SettlementCash) => c.method.trim().toLowerCase() === "adjustment" || /^(opening balance|balance adjustment)/i.test(c.description);

/** Original invoice receipts remain unchanged: reallocating them would duplicate ledger credits. */
export function planPartyInvoiceSettlement(invoices: SettlementInvoice[], entries: SettlementCash[]) {
  const invoiceIds = new Set(invoices.map(i => i.id));
  const returnCredits = new Set(invoices.flatMap(i => i.returns.map(r => r.credit_entry_id).filter(Boolean)));
  const cash = entries.filter(c => !returnCredits.has(c.id));
  let pool = cash.reduce((sum, c) => {
    if (!ledgerOnly(c) && c.type === "in" && invoiceIds.has(c.reference)) return sum;
    return sum + (ledgerOnly(c) ? c.type === "out" ? 1 : -1 : c.type === "in" ? 1 : -1) * cents(c.amount);
  }, 0);
  const ordered = [...invoices].sort((a, b) => new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()
    || new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id));
  const bases = ordered.map(invoice => {
    const total = cents(invoice.grand_total);
    const credit = invoice.returns.reduce((sum, r) => sum + cents(r.amount), 0);
    const linked = cash.filter(c => c.type === "in" && !ledgerOnly(c) && c.reference === invoice.id);
    const received = linked.length ? linked.reduce((sum, c) => sum + cents(c.amount), 0) : cents(invoice.amount_received);
    const collectible = Math.max(0, total - credit);
    pool += Math.max(0, received - collectible);
    return { invoice, total, credit, paid: Math.min(received, collectible), due: Math.max(0, collectible - received) };
  });
  pool = Math.max(0, pool);
  return bases.map(({ invoice, credit, paid, due }) => {
    const applied = Math.min(pool, due);
    pool -= applied;
    const balance = due - applied;
    return { id: invoice.id, balance_due: balance / 100,
      payment_status: balance === 0 ? "paid" as const : paid + applied + credit > 0 ? "partial" as const : "unpaid" as const };
  });
}

export async function settlePartyInvoices(tx: Prisma.TransactionClient, accountName: string) {
  if (!accountName.trim()) return;
  const invoices = await tx.invoice.findMany({ where: { client_name: { equals: accountName, mode: "insensitive" }, is_walk_in: false },
    include: { returns: { select: { amount: true, credit_entry_id: true } } },
    orderBy: [{ invoice_date: "asc" }, { created_at: "asc" }, { id: "asc" }] });
  if (!invoices.length) return;
  const cash = await tx.cashbook.findMany({ where: { account_name: { equals: accountName, mode: "insensitive" } } });
  const references = cash.map(c => c.reference).filter(ref => /^[0-9a-f-]{36}$/i.test(ref));
  const [suppliers, purchases] = await Promise.all([
    tx.supplier.findMany({ where: { id: { in: references } }, select: { id: true } }),
    tx.purchaseOrder.findMany({ where: { OR: [{ id: { in: references } }, { cashbook_entry_id: { in: cash.map(c => c.id) } }] }, select: { id: true, cashbook_entry_id: true } }),
  ]);
  const supplierRefs = new Set([...suppliers.map(s => s.id), ...purchases.map(p => p.id)]);
  const supplierPayments = new Set(purchases.map(p => p.cashbook_entry_id).filter(Boolean));
  const plan = planPartyInvoiceSettlement(invoices, cash.filter(c => !supplierRefs.has(c.reference) && !supplierPayments.has(c.id)));
  for (const update of plan) {
    const original = invoices.find(i => i.id === update.id)!;
    if (Number(original.balance_due) !== update.balance_due || original.payment_status !== update.payment_status) {
      const { id, ...data } = update;
      await tx.invoice.update({ where: { id }, data });
    }
  }
}
