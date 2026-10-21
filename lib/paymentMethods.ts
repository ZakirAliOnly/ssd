"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { isLedgerOnlyEntry } from "@/lib/cashbookEntries";
export { isOpeningBalanceEntry, isBalanceAdjustmentEntry, isLedgerOnlyEntry } from "@/lib/cashbookEntries";

/** A payment method as configured by the admin in /payment-methods.
 *  Methods are user-defined now (CR-14); the type is just `string` so consumers
 *  pass along whatever the admin named (e.g. "Cash", "EasyPaisa", "HBL Bank — XX1234"). */
export type PaymentMethod = string;

export interface PaymentMethodRow {
  id: string;
  name: string;
  opening_balance: number;
  archived: boolean;
  sort_order: number;
}

const DEFAULT_FALLBACK = "Cash";

/** Lenient — accepts any non-empty string. Maps a known legacy alias and trims. */
export function normalizePaymentMethod(raw: string | null | undefined): PaymentMethod {
  const s = (raw ?? "").trim();
  if (!s) return DEFAULT_FALLBACK;
  if (s === "Mobile Wallet") return "EasyPaisa";
  return s;
}

/** Net balance per method:
 *    balance = opening_balance + sum(in for that method) - sum(out for that method)
 *  Ledger-only entries (opening balance, balance adjustments) are excluded.
 *  Returned keys are the canonical method names from the `payment_methods` table. */
export function computeMethodBalances(
  entries: { type: string; amount: number; method?: string | null; description?: string | null }[],
  methods: PaymentMethodRow[]
): Record<string, number> {
  const result: Record<string, number> = {};
  // Seed every active method with its opening balance so the dashboard shows
  // it even before any entries are recorded against it.
  for (const m of methods) {
    if (m.archived) continue;
    result[m.name] = Number(m.opening_balance) || 0;
  }
  for (const e of entries) {
    if (isLedgerOnlyEntry(e)) continue;
    const method = normalizePaymentMethod(e.method);
    const amt = Number(e.amount) || 0;
    if (!(method in result)) result[method] = 0; // archived/legacy method — still tally
    if (e.type === "in") result[method] += amt;
    else if (e.type === "out") result[method] -= amt;
  }
  return result;
}

/** Fetch the active (non-archived) methods, sorted by sort_order then name. */
export async function fetchPaymentMethods(): Promise<PaymentMethodRow[]> {
  const { data, error } = await db
    .from("payment_methods")
    .select("id, name, opening_balance, archived, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return (data as PaymentMethodRow[]).map((m) => ({
    ...m,
    opening_balance: Number(m.opening_balance) || 0,
    archived: !!m.archived,
    sort_order: Number(m.sort_order) || 0,
  }));
}

/** Hook — returns the active methods only (archived excluded), with a `loading` flag.
 *  All consumer pages call this so changes in /payment-methods propagate everywhere. */
export function usePaymentMethods(enabled = true): { methods: PaymentMethodRow[]; loading: boolean; reload: () => Promise<void> } {
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const all = await fetchPaymentMethods();
    setMethods(all.filter((m) => !m.archived));
    setLoading(false);
  }

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return { methods, loading, reload };
}

/** Live current balance for a single method, computed from the cashbook.
 *  Use this right before recording an OUT entry to enforce sufficient funds.
 *  Returns 0 for an unknown method (caller still gets a reasonable answer
 *  without throwing). */
export async function getMethodBalance(methodName: string): Promise<number> {
  const [{ data: entries }, methods] = await Promise.all([
    db.from("cashbook").select("type, amount, method, description"),
    fetchPaymentMethods(),
  ]);
  const safeEntries = (entries ?? []) as { type: string; amount: number; method?: string | null; description?: string | null }[];
  const balances = computeMethodBalances(safeEntries, methods);
  return balances[normalizePaymentMethod(methodName)] ?? 0;
}
