import type { Invoice, CashbookEntry } from "./database.types";
import { computePartySignedBalance } from "./partyBalance";

/** Index once instead of scanning every transaction for every party. Uses the
 * exact same ledger rules as the party ledger, including linked receipts. */
export function partyBalanceOverview(accounts: { id: string; name: string }[], invoices: Invoice[], cashbook: CashbookEntry[]) {
  const invoicesByParty = new Map<string, Invoice[]>(), cashByParty = new Map<string, CashbookEntry[]>();
  for (const invoice of invoices) {
    if ((invoice as Invoice & { is_walk_in?: boolean }).is_walk_in) continue;
    const group = invoicesByParty.get(invoice.client_name) || [];
    group.push(invoice); invoicesByParty.set(invoice.client_name, group);
  }
  for (const entry of cashbook) {
    const key = (entry.account_name || "").toLowerCase();
    const group = cashByParty.get(key) || [];
    group.push(entry); cashByParty.set(key, group);
  }
  return Object.fromEntries(accounts.map(account => [account.id, computePartySignedBalance(account.name,
    invoicesByParty.get(account.name) || [], cashByParty.get(account.name.toLowerCase()) || [])]));
}

/** A reprinted party invoice reconciles to the live party closing balance.
 * Other balance includes later payments/credits and invoices; it is not a
 * rewrite of the historical previous_balance stored on the invoice. */
export function partyInvoiceBalances(invoice: { grand_total: number; amount_received: number; previous_balance?: number }, closing?: number) {
  const money = (n: number) => Math.round(n * 100) / 100;
  const total = closing ?? money(Number(invoice.previous_balance || 0) + Number(invoice.grand_total) - Number(invoice.amount_received));
  return { previous: closing == null ? Number(invoice.previous_balance || 0) : money(closing - Number(invoice.grand_total) + Number(invoice.amount_received)), total };
}
