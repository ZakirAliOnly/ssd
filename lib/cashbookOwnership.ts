/** Shared ownership rules. Names locate a ledger; references determine its role. */
type Entry = { id: string; reference?: string | null; description?: string | null };
type SupplierRef = { id: string };
type PurchaseRef = { id: string; cashbook_entry_id?: string | null };
const key = (value?: string | null) => (value ?? "").trim().toLowerCase();

export function supplierCashbookMatcher(suppliers: SupplierRef[] = [], purchases: PurchaseRef[] = [], partyInvoiceIds: string[] = []) {
  const references = new Set([...suppliers.map(s => key(s.id)), ...purchases.map(p => key(p.id))]);
  const payments = new Set(purchases.map(p => key(p.cashbook_entry_id)).filter(Boolean));
  const partyReferences = new Set(partyInvoiceIds.map(key));
  return (entry: Entry) => {
    if (references.has(key(entry.reference)) || payments.has(key(entry.id))) return true;
    if (partyReferences.has(key(entry.reference))) return false;
    // Reserved application-generated labels cover clearly identified old rows
    // whose original supplier/purchase reference is missing. Never infer from
    // the shared party/supplier name alone.
    return /^(supplier (payment|return|refund)|purchase (invoice|order|payment))\b/i.test((entry.description ?? "").trim());
  };
}

export function filterPartyCashbook<T extends Entry>(entries: T[], suppliers: SupplierRef[] = [], purchases: PurchaseRef[] = [], partyInvoiceIds: string[] = []): T[] {
  const isSupplier = supplierCashbookMatcher(suppliers, purchases, partyInvoiceIds);
  return entries.filter(entry => !isSupplier(entry));
}
