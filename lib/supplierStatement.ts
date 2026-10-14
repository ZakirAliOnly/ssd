import type { Supplier, PurchaseOrder, CashbookEntry } from "./database.types";

export type SupplierStatementRow = {
  id: string; date: string; reference: string; description: string; method: string;
  debit: number; credit: number; balance: number;
};
export type SupplierStatement = {
  supplier: Supplier; opening: number; debit: number; credit: number; closing: number;
  rows: SupplierStatementRow[]; warning: string | null;
};
const money = (value: number) => Math.round(value * 100) / 100;
const nameKey = (value: string) => value.trim().toLowerCase();

/** Purchases increase payable (debit); cash paid reduces it (credit).
 * Opening balance is a remaining payable in this app. Reconstruct its original
 * amount from cash payments less the payments already allocated to purchases.
 * Never add purchase amount_paid as a second credit alongside cashbook payments.
 */
export function buildSupplierStatements(
  suppliers: Supplier[], purchases: PurchaseOrder[], cashbook: CashbookEntry[],
  from: string, to: string, customerNames: string[] = [],
): SupplierStatement[] {
  const byId = new Map(suppliers.map(s => [s.id, s]));
  const byName = new Map<string, Supplier[]>();
  for (const supplier of suppliers) {
    const key = nameKey(supplier.name);
    byName.set(key, [...(byName.get(key) ?? []), supplier]);
  }
  const customers = new Set(customerNames.map(nameKey));
  const purchaseOwner = new Map<string, string>();
  const paymentOwner = new Map<string, string>();
  for (const purchase of purchases) {
    const matches = byName.get(nameKey(purchase.supplier_name)) ?? [];
    const owner = purchase.supplier_id
      ? byId.get(purchase.supplier_id)
      : matches.length === 1 ? matches[0] : undefined;
    if (!owner) continue;
    purchaseOwner.set(purchase.id, owner.id);
    if (purchase.cashbook_entry_id) paymentOwner.set(purchase.cashbook_entry_id, owner.id);
  }
  const payments = new Map<string, CashbookEntry[]>();
  const uncertain = new Set<string>();
  const seen = new Set<string>();
  for (const entry of cashbook) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const returnCredit = /^supplier return\b/i.test(entry.description) && entry.method?.trim().toLowerCase() === "adjustment";
    if (!returnCredit && (/^(opening balance|balance adjustment)/i.test(entry.description)
      || entry.method?.trim().toLowerCase() === "adjustment")) continue;
    const reference = entry.reference?.trim();
    let owner = paymentOwner.get(entry.id)
      ?? (byId.has(reference) ? reference : purchaseOwner.get(reference));
    if (!owner) {
      const key = nameKey(entry.account_name ?? "");
      const matches = byName.get(key) ?? [];
      if (!reference && matches.length === 1 && !customers.has(key)) owner = matches[0].id;
      else for (const match of matches) uncertain.add(match.id);
    }
    if (owner) payments.set(owner, [...(payments.get(owner) ?? []), entry]);
  }
  return [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(supplier => {
    const orders = purchases.filter(p => purchaseOwner.get(p.id) === supplier.id);
    const entries = payments.get(supplier.id) ?? [];
    const paid = orders.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    const cashPaid = entries.filter(e => e.type === "out" && e.method?.trim().toLowerCase() !== "adjustment").reduce((sum, e) => sum + Number(e.amount), 0);
    const originalOpening = money(Number(supplier.opening_balance ?? 0) + Math.max(0, cashPaid - paid));
    const all: (Omit<SupplierStatementRow, "balance"> & { sortAt: string })[] = [];
    if (originalOpening) {
      const date = supplier.created_at.slice(0, 10);
      all.push({ id: `opening-${supplier.id}`, date, sortAt: `${date}T00:00:00`, reference: "Opening",
        description: "Opening payable", method: "—", debit: originalOpening, credit: 0 });
    }
    for (const p of orders) all.push({ id: p.id, date: p.order_date.slice(0, 10),
      sortAt: `${p.order_date.slice(0, 10)}T${p.created_at.slice(11)}`, reference: p.po_number,
      description: "Purchase invoice", method: "—", debit: Number(p.grand_total), credit: 0 });
    for (const e of entries) all.push({ id: e.id, date: e.date.slice(0, 10),
      sortAt: `${e.date.slice(0, 10)}T${e.created_at.slice(11)}`, reference: orders.find(p => p.id === e.reference || p.cashbook_entry_id === e.id)?.po_number ?? "Payment",
      description: e.description, method: e.method || "—", debit: e.type === "in" ? Number(e.amount) : 0,
      credit: e.type === "out" ? Number(e.amount) : 0 });
    all.sort((a, b) => a.sortAt.localeCompare(b.sortAt) || a.id.localeCompare(b.id));
    const opening = money(all.filter(r => r.date < from).reduce((sum, r) => sum + r.debit - r.credit, 0));
    let balance = opening;
    const rows = all.filter(r => r.date >= from && r.date <= to).map(r => {
      balance = money(balance + r.debit - r.credit);
      return { ...r, balance };
    });
    const debit = money(rows.reduce((sum, r) => sum + r.debit, 0));
    const credit = money(rows.reduce((sum, r) => sum + r.credit, 0));
    const warning = uncertain.has(supplier.id) || money(paid - cashPaid) > 0.01
      ? "Some payment history could not be linked reliably. This statement may be incomplete; review the supplier ledger and cashbook."
      : null;
    return { supplier, opening, debit, credit, closing: money(opening + debit - credit), rows, warning };
  });
}
