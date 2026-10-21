"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import { Plus, Download, CreditCard, TrendingUp, X, Trash2, Pencil, Wallet } from "lucide-react";
import type { CashbookEntry } from "@/lib/database.types";
import { normalizePaymentMethod, isLedgerOnlyEntry, computeMethodBalances, usePaymentMethods, type PaymentMethod } from "@/lib/paymentMethods";
import { recomputeCachedBalance } from "@/lib/partyBalanceLive";
import { DT } from "@/lib/dataTableStyles";
import { useUser } from "@/lib/UserContext";
import { SearchableSelect } from "@/components/SearchableSelect";
import { confirmDialog } from "@/components/ConfirmModal";
import { logActivity } from "@/lib/activityLog";
import { useSaving } from "@/lib/useSaving";

export default function CashbookPage() {
  const userProfile = useUser();
  const { methods: paymentMethods, loading: methodsLoading } = usePaymentMethods();
  const { saving, run } = useSaving();
  const [dataLoading, setDataLoading] = useState(true);
  const [entries, setEntries] = useState<CashbookEntry[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: number; bal_type: string }[]>([]);
  const [supplierBalances, setSupplierBalances] = useState<Map<string, number>>(new Map());
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);


  // Form state: Date, Account, Description, Type (Credit/Debit), Amount
  const [fDate, setFDate] = useState(todayISO());
  const [fAccount, setFAccount] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fType, setFType] = useState<"in" | "out">("in");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState<PaymentMethod>("Cash");

  const [todayWalkInTotal, setTodayWalkInTotal] = useState(0);
  const [todayPartiesTotal, setTodayPartiesTotal] = useState(0);

  const fetchData = useCallback(async () => {
    const today = todayISO();
    const [
      { data: entryData },
      { data: acctData },
      { data: walkInData },
      { data: partiesData },
      { data: supData },
      { data: poData },
    ] = await Promise.all([
      db.from("cashbook").select("*").order("date", { ascending: true }).order("created_at", { ascending: true }),
      db.from("accounts").select("id, name, balance, bal_type").order("name"),
      db.from("invoices").select("grand_total").eq("invoice_date", today).eq("is_walk_in", true),
      db.from("invoices").select("grand_total").eq("invoice_date", today).eq("is_walk_in", false),
      db.from("suppliers").select("id, name, opening_balance"),
      db.from("purchase_orders").select("supplier_id, balance_due"),
    ]);
    if (entryData) setEntries(entryData as CashbookEntry[]);
    if (acctData) setAccounts(acctData as { id: string; name: string; balance: number; bal_type: string }[]);
    if (walkInData) setTodayWalkInTotal((walkInData as { grand_total: number | string }[]).reduce((s, i) => s + Number(i.grand_total), 0));
    if (partiesData) setTodayPartiesTotal((partiesData as { grand_total: number | string }[]).reduce((s, i) => s + Number(i.grand_total), 0));

    // Build supplier outstanding map: opening_balance + sum(unpaid PO balance_due).
    // Same formula as supplier/page.tsx so the cashbook column agrees with that page.
    if (supData) {
      const poBySupplier = new Map<string, number>();
      for (const p of (poData ?? []) as { supplier_id: string; balance_due: number | string }[]) {
        const due = Math.max(0, Number(p.balance_due) || 0);
        if (due > 0.005) {
          poBySupplier.set(p.supplier_id, (poBySupplier.get(p.supplier_id) ?? 0) + due);
        }
      }
      const m = new Map<string, number>();
      for (const s of supData as { id: string; name: string; opening_balance: number | string }[]) {
        const opening = Math.max(0, Number(s.opening_balance) || 0);
        const owed = Math.round((opening + (poBySupplier.get(s.id) ?? 0)) * 100) / 100;
        m.set((s.name || "").trim().toLowerCase(), owed);
      }
      setSupplierBalances(m);
    }
    setDataLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  const cashEntries = entries.filter((e) => !isLedgerOnlyEntry(e));

function isWalkInAccount(accountName: string): boolean {
    const n = (accountName || "").toLowerCase().trim();
    return n === "walk-in customer" || n.includes("walk-in");
  }

  // Resync the linked account's cached `balance` column from the ledger
  // (invoices + cashbook). Call this AFTER inserting/updating/deleting a
  // cashbook row — the ledger already reflects the change, so reseeding the
  // cached column from ground truth keeps it in lock-step with the Credit
  // column on the accounts page (which is also ledger-derived).
  async function syncAccountBalanceFromLedger(accountName: string, description?: string) {
    if (!accountName) return;

    // Supplier-flavored cashbook entries store the supplier name in account_name
    // so the row shows in the ledger view, but they must NOT touch any customer
    // account balance even if a same-named customer exists.
    if (description && /^(supplier payment|purchase order)\b/i.test(description)) return;

    // Only resync if a customer account with this name exists; otherwise this
    // is a free-text account_name (e.g. an expense head) with no cached column.
    const { data: acct } = await db
      .from("accounts")
      .select("id")
      .eq("name", accountName)
      .single();
    if (!acct) return;

    await recomputeCachedBalance(accountName);
  }

  function resetForm() {
    const defaultMethod = paymentMethods[0]?.name ?? "Cash";
    setFDate(todayISO()); setFAccount(""); setFDesc(""); setFType("in"); setFAmount(""); setFMethod(defaultMethod);
    setEditingId(null);
  }

  async function handleSave() {
    const amt = parseFloat(fAmount);
    if (!amt || !fDesc) { showToast("Enter description and amount", "err"); return; }
    if (!fMethod || !fMethod.trim()) { showToast("Please select a payment method", "err"); return; }
    if (!paymentMethods.some((m) => m.name === fMethod)) { showToast("Select a valid payment method", "err"); return; }

    // CR-02: Account must be chosen from the dropdown for new entries.
    // Legacy rows missing an account can still be edited without forcing a pick.
    if (!editingId) {
      const picked = fAccount.trim();
      if (!picked) { showToast("Please select an account", "err"); return; }
      if (!accounts.some((a) => a.name === picked)) {
        showToast("Select a valid account from the list", "err"); return;
      }
    }

    // Sufficient-funds check for OUT entries. For an edit, ignore the row's
    // own existing impact so users can adjust the same row without false
    // "not enough funds" warnings.
    if (fType === "out") {
      const methodBalances = computeMethodBalances(
        cashEntries.filter((e) => e.id !== editingId),
        paymentMethods,
      );
      const available = methodBalances[fMethod] ?? 0;
      if (amt > available) {
        showToast(`Not enough funds in "${fMethod}" (available ${formatCurrency(available)}). Choose a different payment method.`, "err");
        return;
      }
    }

    const payload = {
      type: fType,
      description: fDesc,
      amount: amt,
      date: fDate,
      account_name: fAccount,
      method: fMethod,
      reference: "",
    };

    if (editingId) {
      // The cashbook row is the source of truth for the ledger; once we update
      // it, resyncing both the old and new linked account from the ledger is
      // enough — no need to manually reverse and re-apply increments.
      const oldEntry = entries.find((e) => e.id === editingId);
      const { error } = await db
        .from("cashbook")
        .update({ ...payload, reference: (oldEntry as CashbookEntry)?.reference ?? "" })
        .eq("id", editingId);
      if (error) { showToast(error.message, "err"); return; }
      const oldName = oldEntry ? (oldEntry as CashbookEntry & { account_name?: string }).account_name || "" : "";
      if (oldName && oldName !== fAccount) {
        await syncAccountBalanceFromLedger(oldName, oldEntry?.description);
      }
      await syncAccountBalanceFromLedger(fAccount, fDesc);
      showToast("Entry updated", "ok");
    } else {
      const { error } = await db.from("cashbook").insert(payload);
      if (error) { showToast(error.message, "err"); return; }
      await syncAccountBalanceFromLedger(fAccount, fDesc);
      showToast("Entry saved", "ok");
    }

    setShowModal(false);
    resetForm();
    fetchData();
  }

  async function handleDelete(entry: CashbookEntry) {
    const accountName = (entry as CashbookEntry & { account_name?: string }).account_name || "";
    const ok = await confirmDialog({
      title: "Delete cashbook entry?",
      message: `Delete this ${entry.type === "in" ? "Payment In" : "Payment Out"} of ${formatCurrency(Number(entry.amount))}? This cannot be undone.`,
      details: [accountName ? `Account: ${accountName}` : "", entry.description ? `Description: ${entry.description}` : ""].filter(Boolean).join("\n") || undefined,
      tone: "danger",
    });
    if (!ok) return;
    await db.from("cashbook").delete().eq("id", entry.id);
    // Resync the linked account from the ledger now that the row is gone.
    await syncAccountBalanceFromLedger(accountName, entry.description);
    await logActivity({
      action: "delete",
      entityType: "cashbook",
      entityId: entry.id,
      title: entry.type === "in" ? "Payment In Deleted" : "Payment Out Deleted",
      subtitle: entry.description || accountName || "—",
      amount: Number(entry.amount),
      metadata: { method: entry.method, type: entry.type, account_name: accountName },
    });
    showToast("Entry deleted", "ok");
    fetchData();
  }

  function openEdit(e: CashbookEntry) {
    setEditingId(e.id);
    setFDate(e.date);
    setFAccount((e as CashbookEntry & { account_name?: string }).account_name || "");
    setFDesc(e.description);
    setFType(e.type);
    setFAmount(String(e.amount));
    setFMethod(normalizePaymentMethod(e.method));
    setShowModal(true);
  }

  function formatTime(dateStr: string): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
  }


  const inputStyle = { borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" };

  // Reverse for display (newest first) but running balance uses chronological order
  const displayEntries = [...entries].reverse();

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Cash Book</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Daily income &amp; expense entries</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer"
            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
            <Download size={13} /> Export
          </button>
          <button onClick={() => { resetForm(); setShowModal(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white"
            style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}>
            <Plus size={14} /> Add Entry
          </button>
        </div>
      </div>

      {/* Per-method current balances + today's activity cards — admin only */}
      {userProfile?.isAdmin && (() => {
        const cardsLoading = dataLoading || methodsLoading;

        // While either source is still loading, render skeleton cards so the
        // user doesn't see opening balances flash to net balances when the
        // cashbook entries finally arrive.
        if (cardsLoading) {
          const placeholderCount = (paymentMethods.length || 4) + 4;
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5 mb-5">
              {Array.from({ length: placeholderCount }).map((_, i) => (
                <StatCard key={i} loading />
              ))}
            </div>
          );
        }

        const today = todayISO();
        const todayEntries = cashEntries.filter((e) => e.date === today);
        // Lifetime current balance per active method (opening + all in − all out).
        const lifetimeBalances = computeMethodBalances(cashEntries, paymentMethods);
        // Today's activity (always real money, ledger-only entries already excluded from cashEntries).
        const todayExpense = todayEntries.filter((e) => e.type === "out").reduce((s, e) => s + Number(e.amount), 0);
        const todayPartiesReceive = todayEntries.filter((e) => e.type === "in").reduce((s, e) => s + Number(e.amount), 0);
        // Stable accent palette so the same method keeps the same color across renders.
        const palette: { bg: string; color: string }[] = [
          { bg: "var(--green-light)", color: "var(--green)" },
          { bg: "var(--orange-light)", color: "#B45309" },
          { bg: "var(--blue-light)", color: "var(--blue-deeper)" },
          { bg: "var(--red-light)", color: "var(--red)" },
        ];
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5 mb-5">
            {paymentMethods.map((m, i) => {
              const accent = palette[i % palette.length];
              return (
                <StatCard
                  key={m.id}
                  icon={<Wallet size={18} />}
                  iconBg={accent.bg}
                  iconColor={accent.color}
                  label={m.name}
                  value={formatCurrency(lifetimeBalances[m.name] ?? 0)}
                />
              );
            })}
            <StatCard icon={<Download size={18} />} iconBg="var(--red-light)" iconColor="var(--red)" label="Expense (today)" value={formatCurrency(todayExpense)} />
            <StatCard icon={<TrendingUp size={18} />} iconBg="var(--green-light)" iconColor="var(--green)" label="Received (today)" value={formatCurrency(todayPartiesReceive)} />
            <StatCard icon={<CreditCard size={18} />} iconBg="var(--blue-light)" iconColor="var(--blue-deeper)" label="Walk-in Invoice (today)" value={formatCurrency(todayWalkInTotal)} />
            <StatCard icon={<CreditCard size={18} />} iconBg="var(--orange-light)" iconColor="#B45309" label="Parties Invoice (today)" value={formatCurrency(todayPartiesTotal)} />
          </div>
        );
      })()}

      {/* Entries Table */}
      <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="px-5 py-4 border-b border-[var(--gray-100)]">
          <span className="text-lg sm:text-xl font-extrabold tracking-tight" style={{ color: "var(--gray-900)" }}>Entries</span>
        </div>

        {entries.length === 0 ? (
          <div className="text-center py-8 text-[13px]" style={{ color: "var(--gray-800)" }}>
            No entries found. Add your first cashbook entry.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={`${DT.table} min-w-[920px]`}>
              <thead>
                <tr>
                  {["Date", "Time", "Account", "Description", "Method", "Amount", "Type", "Balance Due", "Actions"].map((h) => (
                    <th key={h} className={`${DT.th} text-left`} style={DT.thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayEntries.map((e) => {
                  const isIn = e.type === "in";
                  const entryWithAccount = e as CashbookEntry & { account_name?: string };

                  return (
                    <tr key={e.id} className={DT.row}>
                      <td className={`${DT.td} ${DT.cellBody} whitespace-nowrap`} style={{ color: "var(--gray-900)" }}>
                        {formatDate(e.date)}
                      </td>
                      <td className={`${DT.td} ${DT.cellMono}`} style={{ color: "var(--gray-800)" }}>
                        {formatTime(e.created_at)}
                      </td>
                      <td className={`${DT.td} ${DT.cellPrimary} font-semibold`} style={{ color: "var(--gray-900)" }}>
                        {entryWithAccount.account_name || "—"}
                      </td>
                      <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>
                        {e.description}
                      </td>
                      <td className={`${DT.td} ${DT.cellBody} text-[12px] font-semibold whitespace-nowrap`} style={{ color: "var(--gray-800)" }}>
                        {normalizePaymentMethod((e as CashbookEntry).method)}
                      </td>
                      <td className={`${DT.td} font-mono font-bold text-[15px]`}
                        style={{ color: isIn ? "var(--green)" : "var(--red)" }}>
                        {isIn ? "+" : "−"} {formatCurrency(Number(e.amount))}
                      </td>
                      <td className={DT.td}>
                        <span className={DT.badge}
                          style={{
                            background: isIn ? "var(--green-light)" : "var(--red-light)",
                            color: isIn ? "var(--green)" : "var(--red)",
                          }}>
                          {isIn ? "Credit" : "Debit"}
                        </span>
                      </td>
                      {(() => {
                        const entryAccountName = (entryWithAccount.account_name || "").trim();
                        if (!entryAccountName || isWalkInAccount(entryAccountName)) {
                          return (
                            <td className={`${DT.td} font-mono font-bold text-[15px]`} style={{ color: "var(--gray-800)" }}>
                              —
                            </td>
                          );
                        }

                        const acct = accounts.find((a) => a.name.toLowerCase() === entryAccountName.toLowerCase());
                        if (acct) {
                          const isCredit = acct.bal_type === "credit";
                          return (
                            <td className={`${DT.td} font-mono font-bold text-[15px]`}
                              style={{ color: isCredit ? "var(--green)" : "var(--red)" }}>
                              {formatCurrency(Number(acct.balance))}
                            </td>
                          );
                        }

                        // Fallback: supplier outstanding (we owe them) — payable, render in red
                        const supOwed = supplierBalances.get(entryAccountName.toLowerCase());
                        if (supOwed !== undefined) {
                          return (
                            <td className={`${DT.td} font-mono font-bold text-[15px]`} style={{ color: "var(--red)" }}>
                              {formatCurrency(supOwed)}
                            </td>
                          );
                        }

                        return (
                          <td className={`${DT.td} font-mono font-bold text-[15px]`} style={{ color: "var(--gray-400)" }}>—</td>
                        );
                      })()}
                      <td className={DT.td}>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(e)}
                            className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white transition-all hover:bg-[var(--blue-pale)]"
                            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                            title="Edit">
                            <Pencil size={13} />
                          </button>
                          {userProfile?.isAdmin && (
                            <button onClick={() => handleDelete(e)}
                              className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white transition-all hover:bg-[var(--red-light)]"
                              style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}
                              title="Delete">
                              <Trash2 size={13} />
                            </button>
                          )}

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* Add/Edit Entry Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.3)" }}
          >
          <div className="bg-white rounded-[20px] w-[480px] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
              <h2 className="text-[15px] font-bold">{editingId ? "Edit Entry" : "Add Cash Entry"}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
                <X size={12} />
              </button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-3.5">
                {/* Date */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Date</label>
                  <input value={fDate} onChange={(e) => setFDate(e.target.value)} type="date"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
                </div>

                {/* Account */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                    Account <span style={{ color: "var(--red)" }}>*</span>
                  </label>
                  <SearchableSelect
                    value={fAccount}
                    onChange={setFAccount}
                    options={accounts.map((a) => ({ value: a.name, label: a.name }))}
                    placeholder="— Select Account —"
                    inputClassName="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none w-full"
                    inputStyle={inputStyle}
                  />
                </div>

                {/* Description */}
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Payment Description</label>
                  <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="e.g. Payment from client"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
                </div>

                {/* Type — Credit / Debit toggle */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Type</label>
                  <div className="flex border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                    <button
                      onClick={() => setFType("in")}
                      className="flex-1 py-2 text-[12.5px] font-semibold border-none cursor-pointer transition-all"
                      style={{
                        background: fType === "in" ? "var(--blue)" : "var(--gray-50)",
                        color: fType === "in" ? "#fff" : "var(--gray-500)",
                      }}>
                      Credit (In)
                    </button>
                    <button
                      onClick={() => setFType("out")}
                      className="flex-1 py-2 text-[12.5px] font-semibold border-none cursor-pointer transition-all"
                      style={{
                        background: fType === "out" ? "var(--red)" : "var(--gray-50)",
                        color: fType === "out" ? "#fff" : "var(--gray-500)",
                      }}>
                      Debit (Out)
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Amount (Rs)</label>
                  <input value={fAmount} onChange={(e) => setFAmount(e.target.value)} type="number" placeholder="0"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
                </div>

                {/* Payment method */}
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Payment method</label>
                  <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                    {paymentMethods.length === 0 && (
                      <span className="px-3 py-2 text-[11px]" style={{ color: "var(--gray-700)" }}>
                        No payment methods configured. Add some in Payment Methods.
                      </span>
                    )}
                    {paymentMethods.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setFMethod(m.name)}
                        className="flex-1 min-w-[80px] py-2 text-[11px] font-semibold border-none cursor-pointer transition-all"
                        style={{
                          background: fMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                          color: fMethod === m.name ? "#fff" : "var(--gray-500)",
                        }}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
              <button onClick={() => { setShowModal(false); resetForm(); }}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                Cancel
              </button>
              <button onClick={() => run(handleSave)} disabled={saving}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}>
                {saving ? "Saving…" : (editingId ? "Update Entry" : "Save Entry")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, iconBg, iconColor, label, value, loading }: {
  icon?: React.ReactNode; iconBg?: string; iconColor?: string;
  label?: string; value?: string; loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 transition-all hover:shadow-[var(--shadow)] hover:border-[var(--blue-light)] hover:-translate-y-0.5 cursor-default"
      style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start justify-between mb-3.5">
        {loading ? (
          <div className="w-10 h-10 rounded-[11px] animate-pulse" style={{ background: "var(--gray-100)" }} />
        ) : (
          <div className="w-10 h-10 rounded-[11px] flex items-center justify-center"
            style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
        )}
      </div>
      {loading ? (
        <>
          <div className="h-7 w-28 rounded animate-pulse" style={{ background: "var(--gray-100)" }} />
          <div className="h-3 w-20 mt-2 rounded animate-pulse" style={{ background: "var(--gray-100)" }} />
        </>
      ) : (
        <>
          <div className="text-2xl font-extrabold font-mono leading-none" style={{ color: "var(--gray-900)" }}>{value}</div>
          <div className="text-[11.5px] mt-1" style={{ color: "var(--gray-800)" }}>{label}</div>
        </>
      )}
    </div>
  );
}
