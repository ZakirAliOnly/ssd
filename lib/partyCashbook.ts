import type { Prisma } from "@prisma/client";
import { filterPartyCashbook } from "./cashbookOwnership";

/** Resolve reference ownership inside the caller's existing DB transaction.
 * Do not rely on supplier names or user-editable payment descriptions. */
export async function loadPartyCashbook<T extends { id: string; reference?: string | null; description?: string | null }>(
  tx: Prisma.TransactionClient, entries: T[], partyInvoiceIds: string[] = [],
): Promise<T[]> {
  if (!entries.length) return [];
  const references = [...new Set(entries.map(e => (e.reference ?? "").trim()).filter(ref => /^[0-9a-f-]{36}$/i.test(ref)))];
  const [suppliers, purchases] = await Promise.all([
    tx.supplier.findMany({ where: { id: { in: references } }, select: { id: true } }),
    tx.purchaseOrder.findMany({ where: { OR: [{ id: { in: references } }, { cashbook_entry_id: { in: entries.map(e => e.id) } }] }, select: { id: true, cashbook_entry_id: true } }),
  ]);
  return filterPartyCashbook(entries, suppliers, purchases, partyInvoiceIds);
}
