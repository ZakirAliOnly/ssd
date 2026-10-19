/** Pure bookkeeping predicates shared by server routes, workers and client screens. */
/** Returns true for cashbook entries that represent an opening balance.
 *  These entries exist only for the ledger — they must NOT be counted in Cash in Hand. */
export function isOpeningBalanceEntry(entry: { description?: string | null }): boolean {
  return /^opening balance/i.test(entry.description ?? "");
}

/** Returns true for cashbook entries that represent an account opening-balance adjustment.
 *  These exist only for the ledger audit trail — they must NOT be counted in Cash in Hand. */
export function isBalanceAdjustmentEntry(entry: { method?: string | null; description?: string | null }): boolean {
  return (entry.method ?? "").trim().toLowerCase() === "adjustment"
      || /^balance adjustment/i.test(entry.description ?? "");
}

/** Cashbook entries that represent ledger-only bookkeeping (not real cash movements). */
export function isLedgerOnlyEntry(entry: { method?: string | null; description?: string | null }): boolean {
  return isOpeningBalanceEntry(entry) || isBalanceAdjustmentEntry(entry);
}
