"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DirectSettlements } from "@/components/DirectSettlements";
import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { useUser } from "@/lib/UserContext";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import { computeMethodBalances, type PaymentMethodRow } from "@/lib/paymentMethods";
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Wallet, X, Loader2, ArrowLeftRight, History, ArrowRight } from "lucide-react";
import { TransferModal } from "@/components/TransferModal";
import { confirmDialog } from "@/components/ConfirmModal";

type TransferRow = {
  ref: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  note: string;
  created_at: string;
  outId?: string;
  inId?: string;
};

type TransferRange = "all" | "today" | "week" | "month" | "custom";

function parseTransferNote(desc: string | null | undefined): string {
  const s = (desc ?? "").trim();
  const idx = s.indexOf(" — ");
  return idx === -1 ? "" : s.slice(idx + 3).trim();
}

function startOfWeekISO(d: Date): string {
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? 6 : day - 1;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
  return m.toISOString().split("T")[0];
}

function startOfMonthISO(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), 1);
  return m.toISOString().split("T")[0];
}

interface DraftMethod {
  id?: string;
  name: string;
  opening_balance: string;
  sort_order: number;
}

function blankDraft(nextSort: number): DraftMethod {
  return { name: "", opening_balance: "0", sort_order: nextSort };
}

export default function PaymentMethodsPage() {
  const userProfile = useUser();
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBalances, setCurrentBalances] = useState<Record<string, number>>({});
  const [modal, setModal] = useState<DraftMethod | null>(null);
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [range, setRange] = useState<TransferRange>("all");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [deletingRef, setDeletingRef] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: mData }, { data: cbData }, { data: trData }] = await Promise.all([
      db.from("payment_methods").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true }),
      db.from("cashbook").select("type, amount, method, description"),
      db.from("cashbook")
        .select("id, type, method, description, amount, date, reference, created_at")
        .ilike("reference", "transfer:%")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    const list = ((mData ?? []) as PaymentMethodRow[]).map((m) => ({
      ...m,
      opening_balance: Number(m.opening_balance) || 0,
      archived: !!m.archived,
      sort_order: Number(m.sort_order) || 0,
    }));
    setMethods(list);
    setCurrentBalances(
      computeMethodBalances(
        (cbData ?? []) as { type: string; amount: number; method?: string | null; description?: string | null }[],
        list
      )
    );

    // Group paired transfer rows by their shared reference.
    type RawRow = { id: string; type: string; method: string; description: string; amount: number | string; date: string; reference: string; created_at: string };
    const grouped = new Map<string, TransferRow>();
    for (const r of (trData ?? []) as RawRow[]) {
      const existing = grouped.get(r.reference) ?? {
        ref: r.reference, date: r.date, from: "", to: "", amount: Number(r.amount) || 0,
        note: parseTransferNote(r.description), created_at: r.created_at,
      };
      if (r.type === "out") {
        existing.from = r.method;
        existing.outId = r.id;
        existing.date = r.date;
        existing.amount = Number(r.amount) || 0;
        existing.note = parseTransferNote(r.description);
        existing.created_at = r.created_at;
      } else if (r.type === "in") {
        existing.to = r.method;
        existing.inId = r.id;
        if (!existing.note) existing.note = parseTransferNote(r.description);
      }
      grouped.set(r.reference, existing);
    }
    const list2 = Array.from(grouped.values())
      .filter((t) => t.from && t.to)
      .sort((a, b) => (b.date.localeCompare(a.date)) || b.created_at.localeCompare(a.created_at));
    setTransfers(list2);

    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function openAdd() {
    const nextSort = methods.length === 0 ? 1 : Math.max(...methods.map((m) => m.sort_order)) + 1;
    setModal(blankDraft(nextSort));
  }

  function openEdit(m: PaymentMethodRow) {
    setModal({ id: m.id, name: m.name, opening_balance: String(m.opening_balance), sort_order: m.sort_order });
  }

  async function handleSave() {
    if (!modal) return;
    const name = modal.name.trim();
    if (!name) { showToast("Method name is required", "err"); return; }
    const opening = parseFloat(String(modal.opening_balance).replace(/,/g, ""));
    if (!Number.isFinite(opening) || opening < 0) { showToast("Opening balance must be ≥ 0", "err"); return; }

    // Check name collision (case-insensitive) — except when editing the same row.
    const collision = methods.find(
      (m) => m.name.toLowerCase() === name.toLowerCase() && m.id !== modal.id
    );
    if (collision) { showToast(`A method named "${collision.name}" already exists`, "err"); return; }

    setSaving(true);
    try {
      if (modal.id) {
        const { error } = await db.from("payment_methods")
          .update({ name, opening_balance: opening, sort_order: modal.sort_order })
          .eq("id", modal.id);
        if (error) { showToast(error.message, "err"); return; }
        showToast("Payment method updated", "ok");
      } else {
        const { error } = await db.from("payment_methods")
          .insert({ name, opening_balance: opening, sort_order: modal.sort_order, archived: false });
        if (error) { showToast(error.message, "err"); return; }
        showToast("Payment method added", "ok");
      }
      setModal(null);
      await fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(m: PaymentMethodRow) {
    if (!confirm(`Archive "${m.name}"? It will stop appearing in pickers but historical entries are preserved.`)) return;
    setBusyId(m.id);
    try {
      const { error } = await db.from("payment_methods").update({ archived: true }).eq("id", m.id);
      if (error) { showToast(error.message, "err"); return; }
      showToast(`Archived "${m.name}"`, "ok");
      await fetchData();
    } finally { setBusyId(null); }
  }

  async function handleRestore(m: PaymentMethodRow) {
    setBusyId(m.id);
    try {
      const { error } = await db.from("payment_methods").update({ archived: false }).eq("id", m.id);
      if (error) { showToast(error.message, "err"); return; }
      showToast(`Restored "${m.name}"`, "ok");
      await fetchData();
    } finally { setBusyId(null); }
  }

  async function handleDelete(m: PaymentMethodRow) {
    // Hard cascade: every cashbook row that referenced this method must go too.
    // Otherwise recreating a method with the same name silently inherits the
    // old ledger and the new "opening" balance is no longer a clean slate.
    const { data: refRows } = await db
      .from("cashbook")
      .select("id")
      .eq("method", m.name);
    const refCount = Array.isArray(refRows) ? refRows.length : 0;

    const ok = await confirmDialog({
      title: "Delete payment method?",
      message: `Permanently delete "${m.name}"? This cannot be undone.`,
      details: refCount > 0
        ? `${refCount} cashbook entr${refCount === 1 ? "y" : "ies"} that used this method will also be deleted to keep balances consistent.`
        : "No cashbook entries reference this method.",
      confirmText: "Delete everything",
      tone: "danger",
    });
    if (!ok) return;

    setBusyId(m.id);
    try {
      if (refCount > 0) {
        const { error: cbErr } = await db.from("cashbook").delete().eq("method", m.name);
        if (cbErr) { showToast(cbErr.message, "err"); return; }
      }
      const { error } = await db.from("payment_methods").delete().eq("id", m.id);
      if (error) { showToast(error.message, "err"); return; }
      showToast(`Deleted "${m.name}" and ${refCount} linked entr${refCount === 1 ? "y" : "ies"}`, "ok");
      await fetchData();
    } finally { setBusyId(null); }
  }

  async function handleDeleteTransfer(t: TransferRow) {
    const ok = await confirmDialog({
      title: "Delete this transfer?",
      message: `Reverse the ${formatCurrency(t.amount)} transfer from ${t.from} to ${t.to}? Both paired entries will be removed and balances will adjust.`,
      details: t.note || undefined,
      tone: "danger",
    });
    if (!ok) return;
    setDeletingRef(t.ref);
    try {
      const { error } = await db.from("cashbook").delete().eq("reference", t.ref);
      if (error) { showToast(error.message, "err"); return; }
      showToast("Transfer deleted", "ok");
      await fetchData();
    } finally {
      setDeletingRef(null);
    }
  }

  const filteredTransfers = useMemo(() => {
    if (range === "all") return transfers;
    if (range === "today") {
      const t = todayISO();
      return transfers.filter((x) => x.date === t);
    }
    if (range === "custom") {
      return transfers.filter((x) =>
        (!rangeFrom || x.date >= rangeFrom) && (!rangeTo || x.date <= rangeTo)
      );
    }
    const now = new Date();
    const start = range === "week" ? startOfWeekISO(now) : startOfMonthISO(now);
    return transfers.filter((x) => x.date >= start);
  }, [transfers, range, rangeFrom, rangeTo]);

  const filteredTotal = useMemo(
    () => filteredTransfers.reduce((s, t) => s + t.amount, 0),
    [filteredTransfers]
  );

  if (userProfile === null) return null;
  if (!userProfile.isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-[14px]" style={{ color: "var(--gray-700)" }}>This page is admin-only.</p>
      </div>
    );
  }

  const active = methods.filter((m) => !m.archived);
  const archived = methods.filter((m) => m.archived);

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Payment Methods</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>
            Configure the cash, wallet and bank channels available across invoices, cashbook and supplier payments.
            Each method tracks its own running balance starting from the opening you enter.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setTransferFrom(null); setTransferOpen(true); }} disabled={active.length < 2}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-[1.5px] text-[12.5px] font-semibold cursor-pointer bg-white disabled:opacity-50"
            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
            title={active.length < 2 ? "Add at least two methods to transfer between them" : "Transfer money between methods"}>
            <ArrowLeftRight size={14} /> Transfer
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white"
            style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}>
            <Plus size={14} /> Add method
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-8 text-center" style={{ boxShadow: "var(--shadow-sm)" }}>
          <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: "var(--gray-400)" }} />
          <p className="text-[13px] m-0" style={{ color: "var(--gray-700)" }}>Loading…</p>
        </div>
      ) : (
        <>
          <DirectSettlements onChanged={() => void fetchData()} />

          <section className="mb-6">
            <div className="flex items-center gap-2.5 mb-3">
              <Wallet size={14} style={{ color: "var(--gray-700)" }} />
              <span className="text-[10px] font-bold tracking-[2px] uppercase" style={{ color: "var(--gray-700)" }}>Active methods</span>
              <div className="flex-1 h-px" style={{ background: "var(--gray-200)" }} />
              <span className="text-[11px] font-semibold" style={{ color: "var(--gray-700)" }}>{active.length}</span>
            </div>
            {active.length === 0 ? (
              <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-8 text-center" style={{ boxShadow: "var(--shadow-sm)" }}>
                <p className="text-[13px] m-0" style={{ color: "var(--gray-700)" }}>No active payment methods. Add one to get started.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {active.map((m) => {
                  const opening = m.opening_balance;
                  const current = currentBalances[m.name] ?? opening;
                  return (
                    <div key={m.id} className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 flex flex-col gap-2" style={{ boxShadow: "var(--shadow-sm)" }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-extrabold truncate" style={{ color: "var(--gray-900)" }}>{m.name}</div>
                          <div className="text-[10px] uppercase tracking-[1px] mt-0.5" style={{ color: "var(--gray-700)" }}>
                            Opening · <span className="font-mono" style={{ color: "var(--gray-900)" }}>{formatCurrency(opening)}</span>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => { setTransferFrom(m.name); setTransferOpen(true); }} disabled={busyId === m.id || active.length < 2}
                            className="w-8 h-8 rounded-[7px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white disabled:opacity-50"
                            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                            title={active.length < 2 ? "Add another method to enable transfers" : `Transfer from ${m.name}`}>
                            <ArrowLeftRight size={13} />
                          </button>
                          <button onClick={() => openEdit(m)} disabled={busyId === m.id}
                            className="w-8 h-8 rounded-[7px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white disabled:opacity-50"
                            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }} title="Edit">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => void handleArchive(m)} disabled={busyId === m.id}
                            className="w-8 h-8 rounded-[7px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white disabled:opacity-50"
                            style={{ borderColor: "var(--gray-200)", color: "#B45309" }} title="Archive — keep history but hide from pickers">
                            <Archive size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 pt-2 border-t border-[var(--gray-100)] flex items-baseline justify-between">
                        <span className="text-[10px] uppercase tracking-[1px] font-semibold" style={{ color: "var(--gray-700)" }}>Current</span>
                        <span className="text-[18px] font-extrabold font-mono" style={{ color: current >= 0 ? "var(--green)" : "var(--red)" }}>
                          {formatCurrency(current)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mb-6">
            <div className="flex items-center gap-2.5 mb-3">
              <History size={14} style={{ color: "var(--gray-700)" }} />
              <span className="text-[10px] font-bold tracking-[2px] uppercase" style={{ color: "var(--gray-700)" }}>Transfer history</span>
              <div className="flex-1 h-px" style={{ background: "var(--gray-200)" }} />
              <span className="text-[11px] font-semibold" style={{ color: "var(--gray-700)" }}>
                {filteredTransfers.length}{range !== "all" ? ` of ${transfers.length}` : ""}
              </span>
            </div>

            <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--gray-100)]">
                {([
                  { key: "all", label: "All" },
                  { key: "today", label: "Today" },
                  { key: "week", label: "This week" },
                  { key: "month", label: "This month" },
                  { key: "custom", label: "Custom" },
                ] as { key: TransferRange; label: string }[]).map((opt) => {
                  const selected = range === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setRange(opt.key)}
                      className="px-3 py-1.5 rounded-full border-[1.5px] text-[11.5px] font-semibold cursor-pointer"
                      style={{
                        borderColor: selected ? "var(--blue-deeper)" : "var(--gray-200)",
                        background: selected ? "var(--blue-deeper)" : "white",
                        color: selected ? "white" : "var(--gray-800)",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                {range === "custom" && (
                  <div className="flex items-center gap-2 ml-1">
                    <input
                      type="date"
                      value={rangeFrom}
                      onChange={(e) => setRangeFrom(e.target.value)}
                      className="border-[1.5px] rounded-[7px] px-2 py-1 text-[11.5px] outline-none"
                      style={{ borderColor: "var(--gray-200)" }}
                    />
                    <span className="text-[10.5px]" style={{ color: "var(--gray-700)" }}>→</span>
                    <input
                      type="date"
                      value={rangeTo}
                      onChange={(e) => setRangeTo(e.target.value)}
                      className="border-[1.5px] rounded-[7px] px-2 py-1 text-[11.5px] outline-none"
                      style={{ borderColor: "var(--gray-200)" }}
                    />
                    {(rangeFrom || rangeTo) && (
                      <button
                        onClick={() => { setRangeFrom(""); setRangeTo(""); }}
                        className="text-[11px] underline cursor-pointer"
                        style={{ color: "var(--gray-700)" }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                )}
                <div className="flex-1" />
                <div className="text-[11.5px] font-semibold" style={{ color: "var(--gray-700)" }}>
                  Total: <span className="font-mono" style={{ color: "var(--gray-900)" }}>{formatCurrency(filteredTotal)}</span>
                </div>
              </div>

              {filteredTransfers.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-[13px] m-0" style={{ color: "var(--gray-700)" }}>
                    {transfers.length === 0
                      ? "No transfers yet. Move money between methods using the Transfer button above."
                      : "No transfers in this range."}
                  </p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--gray-100)" }}>
                  {filteredTransfers.map((t) => (
                    <div key={t.ref} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--gray-100)] last:border-b-0">
                      <div className="w-[88px] shrink-0 text-[11.5px] font-semibold" style={{ color: "var(--gray-700)" }}>
                        {formatDate(t.date)}
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="text-[12.5px] font-bold truncate" style={{ color: "var(--gray-900)" }}>{t.from}</span>
                        <ArrowRight size={12} style={{ color: "var(--gray-700)" }} />
                        <span className="text-[12.5px] font-bold truncate" style={{ color: "var(--gray-900)" }}>{t.to}</span>
                        {t.note && (
                          <span className="text-[11px] truncate" style={{ color: "var(--gray-700)" }}>· {t.note}</span>
                        )}
                      </div>
                      <div className="shrink-0 text-[14px] font-extrabold font-mono" style={{ color: "var(--gray-900)" }}>
                        {formatCurrency(t.amount)}
                      </div>
                      <button
                        onClick={() => void handleDeleteTransfer(t)}
                        disabled={deletingRef === t.ref}
                        className="w-8 h-8 rounded-[7px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white disabled:opacity-50 shrink-0"
                        style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}
                        title="Delete transfer"
                      >
                        {deletingRef === t.ref ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {archived.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center gap-2.5 mb-3">
                <Archive size={14} style={{ color: "var(--gray-700)" }} />
                <span className="text-[10px] font-bold tracking-[2px] uppercase" style={{ color: "var(--gray-700)" }}>Archived</span>
                <div className="flex-1 h-px" style={{ background: "var(--gray-200)" }} />
                <span className="text-[11px] font-semibold" style={{ color: "var(--gray-700)" }}>{archived.length}</span>
              </div>
              <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
                {archived.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--gray-100)] last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-bold truncate" style={{ color: "var(--gray-700)" }}>{m.name}</div>
                      <div className="text-[10.5px]" style={{ color: "var(--gray-700)" }}>
                        Opening: <span className="font-mono">{formatCurrency(m.opening_balance)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => void handleRestore(m)} disabled={busyId === m.id}
                        className="w-8 h-8 rounded-[7px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white disabled:opacity-50"
                        style={{ borderColor: "var(--gray-200)", color: "var(--blue)" }} title="Restore">
                        <ArchiveRestore size={13} />
                      </button>
                      <button onClick={() => void handleDelete(m)} disabled={busyId === m.id}
                        className="w-8 h-8 rounded-[7px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white disabled:opacity-50"
                        style={{ borderColor: "var(--gray-200)", color: "var(--red)" }} title="Delete permanently">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {transferOpen && (
        <TransferModal
          methods={methods}
          currentBalances={currentBalances}
          initialFrom={transferFrom ?? undefined}
          onClose={() => { setTransferOpen(false); setTransferFrom(null); }}
          onDone={fetchData}
        />
      )}

      {modal && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-12 px-4 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.3)" }}>
          <div className="bg-white rounded-[20px] w-[440px] max-w-full overflow-hidden animate-slide-up" style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
              <h2 className="text-[15px] font-bold">{modal.id ? "Edit payment method" : "Add payment method"}</h2>
              <button onClick={() => !saving && setModal(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
                <X size={12} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                  Name <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input value={modal.name}
                  onChange={(e) => setModal({ ...modal, name: e.target.value })}
                  placeholder="e.g. Cash, EasyPaisa, HBL Bank — XX1234"
                  autoFocus
                  className="border-[1.5px] rounded-[9px] px-3 py-2.5 text-[14px] outline-none"
                  style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)" }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                  Opening balance (Rs)
                </label>
                <input value={modal.opening_balance}
                  onChange={(e) => setModal({ ...modal, opening_balance: e.target.value })}
                  type="number" min="0" step="0.01" placeholder="0"
                  className="border-[1.5px] rounded-[9px] px-3 py-2.5 text-[14px] outline-none font-mono"
                  style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)" }} />
                <p className="text-[10.5px] mt-0.5" style={{ color: "var(--gray-700)" }}>
                  The starting balance you have in this method right now (e.g. cash in hand). All cashbook entries against this method will adjust this number from here on.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
              <button onClick={() => !saving && setModal(null)} disabled={saving}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white disabled:opacity-50"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                Cancel
              </button>
              <button onClick={() => void handleSave()} disabled={saving}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}>
                {saving && <Loader2 size={13} className="animate-spin" />}
                {modal.id ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
