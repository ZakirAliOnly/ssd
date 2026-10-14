import type { Invoice, CashbookEntry } from "@/lib/database.types";
import type { LedgerRow } from "@/lib/ledger";
import { isLedgerOnlyEntry, isOpeningBalanceEntry } from "@/lib/paymentMethods";

/** Keep credits and invoices at their stored precision so partial returns
 * neither lose cents nor leave a balance after a full return. */
const ledgerMoney = (n: number): number => Math.round(n * 100) / 100;

/** Invoices belonging to a named party (excludes walk-ins). */
function partyInvoicesFor(accountName: string, invoices: Invoice[]): Invoice[] {
  return invoices.filter(
    (i) =>
      i.client_name === accountName &&
      !(i as Invoice & { is_walk_in?: boolean }).is_walk_in
  );
}

export function buildLedgerRows(
  accountName: string,
  invoices: Invoice[],
  cashbook: CashbookEntry[]
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const nameLower = accountName.toLowerCase();

  /** Invoice IDs that already have a cashbook line (reference = invoice id) — avoids double-counting payment. */
  const invoiceIdsWithCashbookPayment = new Set(
    cashbook
      .filter((c) => (c.account_name || "").toLowerCase() === nameLower && c.type === "in" && !isLedgerOnlyEntry(c))
      .map((c) => (c.reference || "").trim())
      .filter(Boolean)
  );

  partyInvoicesFor(accountName, invoices).forEach((inv) => {
    rows.push({
      date: inv.invoice_date,
      sortAt: `${inv.invoice_date}T${inv.created_at || "1970-01-01"}`,
      doc: inv.invoice_number,
      desc: (() => {
        const detail = [inv.job_notes, inv.job_name].map((s) => String(s || "").trim()).find(Boolean);
        return detail ? `Invoice — ${detail}` : "Invoice";
      })(),
      debit: ledgerMoney(Number(inv.grand_total)),
      credit: 0,
      method: inv.payment_method || "—",
      invoiceId: inv.id,
    });
    if (Number(inv.amount_received) > 0 && !invoiceIdsWithCashbookPayment.has(inv.id)) {
      rows.push({
        date: inv.invoice_date,
        sortAt: `${inv.invoice_date}T${inv.created_at || "1970-01-01"}_recv`,
        doc: inv.invoice_number,
        desc: "Payment received (on invoice)",
        debit: 0,
        credit: ledgerMoney(Number(inv.amount_received)),
        method: inv.payment_method || "—",
      });
    }
  });

  cashbook
    .filter((c) => (c.account_name || "").toLowerCase() === nameLower)
    .forEach((c) => {
      const amt = ledgerMoney(Number(c.amount));
      const isOpening = isOpeningBalanceEntry(c);
      // Balance-adjustment rows (created when an account's opening balance is
      // edited) are also bookkeeping-only — their `type` carries the direction
      // and must be honored, same as opening balance. Treating them as a plain
      // "payment received" silently flips the sign of the cached balance.
      const isLedgerOnly = isLedgerOnlyEntry(c);

      let debit = 0;
      let credit = 0;
      if (isLedgerOnly) {
        // "in"  = party owes us more  → debit side
        // "out" = we owe the party more → credit side
        debit  = c.type === "in"  ? amt : 0;
        credit = c.type === "out" ? amt : 0;
      } else {
        // Receipts credit the party. A separately paid refund debits it,
        // settling the credit created by a sales return.
        debit = c.type === "out" ? amt : 0;
        credit = c.type === "in" ? amt : 0;
      }

      rows.push({
        date: c.date,
        sortAt: `${c.date}T${c.created_at || "1970-01-01"}_${c.id}`,
        doc: isOpening ? "Opening" : isLedgerOnly ? "Adjustment" : "Cashbook",
        desc: c.description || (c.type === "in" ? "Cashbook entry (in)" : "Cashbook entry (out)"),
        debit,
        credit,
        method: c.method || "—",
      });
    });

  rows.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  return rows;
}

/**
 * Signed party balance derived from invoices + cashbook (the ledger view).
 * Positive = party owes us (credit); negative = we owe them (debit).
 * Authoritative source — do not read the cached `accounts.balance` column for display.
 */
export function computePartySignedBalance(
  accountName: string,
  invoices: Invoice[],
  cashbook: CashbookEntry[]
): number {
  const rows = buildLedgerRows(accountName, invoices, cashbook);
  const sum = rows.reduce((s, r) => s + r.debit - r.credit, 0);
  // Amounts are stored at 2-decimal precision; summing many can leave tiny
  // FP residuals (e.g. ...e-13) that render as spurious "Rs -0" values.
  return Math.round(sum * 100) / 100;
}
