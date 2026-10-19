/** Shared ledger math used by both the customer (accounts) and supplier ledgers.
 *  Each consumer builds its own LedgerRow[] from the relevant data sources, then
 *  feeds them through these helpers for date filtering and running-balance calc. */

export type LedgerRow = {
  date: string;
  sortAt: string;
  doc: string;
  desc: string;
  debit: number;
  credit: number;
  /** Payment method used for this transaction (e.g. "Cash", "Bank Transfer"). */
  method?: string;
  /** Set on invoice rows so consumers can attach the invoice's line items. */
  invoiceId?: string;
  /** Set only on purchase postings, never supplier payment rows. */
  purchaseOrderId?: string;
};

export function ledgerWithRunningBalance(rows: LedgerRow[]): (LedgerRow & { balance: number })[] {
  let bal = 0;
  return rows.map((r) => {
    bal += r.debit - r.credit;
    // Clean sub-cent FP residuals so the closing balance can settle to a clean 0
    // instead of something like -4.5e-13 that renders as a spurious "Rs -0".
    const balance = Math.round(bal * 100) / 100;
    return { ...r, balance };
  });
}

/** Filter by transaction date (YYYY-MM-DD); running balance includes opening from prior rows when `from` is set. */
export function ledgerRowsForDateRange(
  allRows: LedgerRow[],
  fromISO: string,
  toISO: string
): (LedgerRow & { balance: number })[] {
  const sorted = [...allRows].sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  const from = fromISO.trim();
  const to = toISO.trim();
  if (!from && !to) return ledgerWithRunningBalance(sorted);

  let opening = 0;
  if (from) {
    opening = Math.round(
      sorted.filter((r) => r.date < from).reduce((s, r) => s + r.debit - r.credit, 0) * 100
    ) / 100;
  }
  const inRange = sorted.filter(
    (r) => (!from || r.date >= from) && (!to || r.date <= to)
  );
  let bal = opening;
  return inRange.map((r) => {
    bal += r.debit - r.credit;
    const balance = Math.round(bal * 100) / 100;
    return { ...r, balance };
  });
}

export function openingBalanceBeforeDate(allRows: LedgerRow[], fromISO: string): number {
  if (!fromISO.trim()) return 0;
  const sorted = [...allRows].sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  const sum = sorted.filter((r) => r.date < fromISO.trim()).reduce((s, r) => s + r.debit - r.credit, 0);
  return Math.round(sum * 100) / 100;
}
