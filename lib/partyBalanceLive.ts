import type { Invoice, CashbookEntry } from "@/lib/database.types";
import { db } from "@/lib/db";
import { computePartySignedBalance } from "@/lib/partyBalance";

export type FreshPartyBalance = {
  signed: number;
  invoices: Invoice[];
  cashbook: CashbookEntry[];
  /** Cached `accounts.balance` (signed). Drift from `signed` indicates a write path bug. */
  cachedSigned: number | null;
  /** Absolute drift between computed and cached. Zero is the goal. */
  drift: number;
};

/**
 * Single source of truth for a party's balance. Re-queries the DB and computes
 * from the ledger every time it is called. Use this right before composing any
 * user-visible balance (the WhatsApp "Remaining balance" line, the receipt PDF,
 * etc.) so the message can never disagree with the Credit column shown in the
 * accounts table.
 *
 * Also returns the cached `accounts.balance` so callers can detect drift —
 * when those disagree the WhatsApp would have lied. Callers should warn and
 * use the ledger-derived value, not the cached one.
 */
export async function fetchPartySignedBalance(accountName: string): Promise<FreshPartyBalance> {
  const response = await fetch(`/api/accounts/overview?party=${encodeURIComponent(accountName)}`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.accounts?.length || !Array.isArray(result.invoices) || !Array.isArray(result.cashbook)) throw new Error(result.error || "Could not refresh the party balance. Please try again.");
  const invoices = result.invoices as Invoice[], cashbook = result.cashbook as CashbookEntry[];
  const acct = result.accounts[0] as { balance: number; bal_type: string };
  const signed = computePartySignedBalance(accountName, invoices, cashbook);

  let cachedSigned: number | null = null;
  if (acct) {
    cachedSigned = acct.bal_type === "credit" ? Number(acct.balance) : -Number(acct.balance);
    cachedSigned = Math.round(cachedSigned * 100) / 100;
  }
  const drift = cachedSigned == null ? 0 : Math.round(Math.abs(signed - cachedSigned) * 100) / 100;

  return { signed, invoices, cashbook, cachedSigned, drift };
}

/**
 * Rewrite the cached `accounts.balance` column to match the ledger-derived
 * signed balance. Call this whenever `fetchPartySignedBalance` reports drift,
 * so legacy paths that still read the cached column stop diverging from the
 * ledger.
 */
export async function syncCachedAccountBalance(
  accountName: string,
  signed: number
): Promise<void> {
  await db
    .from("accounts")
    .update({
      balance: Math.abs(signed),
      bal_type: signed >= 0 ? "credit" : "debit",
    })
    .eq("name", accountName);
}

/**
 * Recompute the cached `accounts.balance` column for a party from the ledger
 * (invoices + cashbook) and write the result back. This is the ONE write path
 * for the cached column — every successful invoice/cashbook mutation should
 * call this for the affected party so the cache can never drift from ground
 * truth. Returns the freshly computed signed balance for callers that need it
 * (e.g. WhatsApp message composition).
 */
export async function recomputeCachedBalance(accountName: string): Promise<number> {
  const fresh = await fetchPartySignedBalance(accountName);
  await syncCachedAccountBalance(accountName, fresh.signed);
  return fresh.signed;
}
