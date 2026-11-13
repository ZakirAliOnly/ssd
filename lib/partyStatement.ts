import { filterPartyCashbook } from "./cashbookOwnership";
import type { Account, Invoice, CashbookEntry, Supplier, PurchaseOrder } from "./database.types";
import type { SupplierStatement } from "./supplierStatement";
import { buildLedgerRows } from "./partyBalance";
import { ledgerRowsForDateRange, openingBalanceBeforeDate } from "./ledger";

/** Uses the same authoritative ledger as the Accounts module, including
 * opening adjustments and invoice-payment deduplication, rather than its cache. */
export function buildPartyStatements(accounts: Account[], invoices: Invoice[], cashbook: CashbookEntry[],
  suppliers: Supplier[], purchases: PurchaseOrder[], from: string, to: string): SupplierStatement[] {
  const partyCashbook = filterPartyCashbook(cashbook, suppliers, purchases, invoices.map(i => i.id));
  return [...accounts].sort((a, b) => a.name.localeCompare(b.name)).map(account => {
    const all = buildLedgerRows(account.name, invoices, partyCashbook);
    const opening = openingBalanceBeforeDate(all, from);
    const period = ledgerRowsForDateRange(all, from, to);
    const debit = Math.round(period.reduce((sum, r) => sum + r.debit, 0) * 100) / 100;
    const credit = Math.round(period.reduce((sum, r) => sum + r.credit, 0) * 100) / 100;
    return {
      supplier: { ...account, notes: "" }, opening, debit, credit,
      closing: Math.round((opening + debit - credit) * 100) / 100,
      rows: period.map((r, i) => ({ id: `${account.id}-${i}`, date: r.date, reference: r.doc,
        description: r.desc, method: r.method ?? "—", debit: r.debit, credit: r.credit, balance: r.balance })),
      warning: accounts.filter(a => a.name.toLowerCase() === account.name.toLowerCase()).length > 1
        ? "Multiple parties share this name. Historical transactions are linked by name; review their account records." : null,
    };
  });
}
