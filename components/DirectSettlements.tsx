"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowUpRight, CheckCircle2, Link2, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { confirmDialog } from "@/components/ConfirmModal";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { useUser } from "@/lib/UserContext";

type Option = { id: string; name: string; balance: number };
type RecordRow = { id: string; customer_id: string; supplier_id: string; customer_name: string; supplier_name: string; date: string; amount: string | number;
  reference: string; notes: string; created_by_name: string; reversed_at: string | null; reversal_reason: string };
type Data = { records: RecordRow[]; customers?: Option[]; suppliers?: Option[] };
const businessToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const inputClass = "w-full rounded-xl border border-[var(--gray-200)] bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-500";

export function DirectSettlements({ historyOnly = false, onChanged }: { historyOnly?: boolean; onChanged?: () => void }) {
  const user = useUser();
  const [data, setData] = useState<Data>({ records: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  const [customerId, setCustomerId] = useState(""), [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState(""), [date, setDate] = useState(businessToday);
  const [reference, setReference] = useState(""), [notes, setNotes] = useState("");
  const [reverse, setReverse] = useState<RecordRow | null>(null), [reason, setReason] = useState("");
  useEffect(() => {
    if (!open && !reverse) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { setOpen(false); setReverse(null); }
    };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", escape); };
  }, [open, reverse, busy]);
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/direct-settlements${historyOnly ? "?history=1" : ""}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load settlements.");
      setData(result); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load settlements."); }
    finally { setLoading(false); }
  }, [historyOnly]);
  useEffect(() => { void fetchData(); }, [fetchData]);
  const customer = data.customers?.find(c => c.id === customerId), supplier = data.suppliers?.find(s => s.id === supplierId);
  const value = Number(amount), limit = Math.max(0, Math.min(customer?.balance ?? 0, supplier?.balance ?? 0));
  const valid = !!customer && !!supplier && value > 0 && value <= limit && !!date;
  async function post(body: object) {
    const response = await fetch("/api/direct-settlements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not confirm settlement. Reload history before retrying.");
    return result;
  }
  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await confirmDialog({ title: "Confirm direct payment", message: `${customer!.name} paid ${formatCurrency(value)} directly to ${supplier!.name}.`,
      details: "Both outstanding balances will decrease. Your cash and bank balances stay the same.", confirmText: "Record settlement", tone: "info" });
    if (!ok) { setBusy(false); return; }
    setError("");
    try {
      const body = { customer_id: customerId, supplier_id: supplierId, amount: value, date, reference: reference.trim(), notes: notes.trim() };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      await post({ ...body, request_id: pending.current.id });
      setOpen(false); setAmount(""); setReference(""); setNotes(""); pending.current = null;
      setSuccess("Settlement recorded. Both ledgers updated; cash and bank balances unchanged.");
      await fetchData(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record settlement."); }
    finally { setBusy(false); }
  }
  async function undo() {
    if (!reverse || !reason.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await post({ action: "reverse", id: reverse.id, reason: reason.trim() });
      setReverse(null); setReason(""); setSuccess("Settlement reversed in both ledgers. Original history preserved.");
      await fetchData(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reverse settlement."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Direct settlements" className="my-6 overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-white" style={{ boxShadow: "var(--shadow-sm)" }}>
    <div className="flex flex-wrap items-center justify-between gap-4 p-5" style={{ background: "linear-gradient(115deg,#f0f9ff,#f0fdfa)" }}>
      <div className="flex items-start gap-3"><div className="rounded-xl bg-white p-2.5 text-sky-700"><Link2 size={23} /></div><div>
        <h2 className="text-base font-extrabold text-slate-900">Customer pays supplier directly</h2>
        <p className="mt-1 text-xs text-slate-600">One entry updates both ledgers. No money enters or leaves your cash or bank.</p>
      </div></div>
      {!historyOnly && <button onClick={() => { setOpen(true); setError(""); setSuccess(""); }} disabled={loading || !!error} className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Record direct payment <ArrowUpRight size={15} className="inline ml-1" /></button>}
    </div>
    {error && <div role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button className="ml-2 underline" onClick={() => void fetchData()}>Refresh balances</button></div>}
    {success && <p role="status" className="m-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {loading ? <p className="p-5 text-sm text-slate-500"><Loader2 className="inline animate-spin mr-2" size={15} />Loading settlements…</p> : <>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Direct settlement history · {data.records.length}</h3><span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-800">No cash movement</span></div>
      {!data.records.length ? <p className="px-5 pb-5 text-sm text-slate-500">No direct settlements recorded yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Date / reference", "Customer → supplier", "Settled amount", "Status", ""].map((h,i) => <th key={i} className="px-5 py-3 font-semibold">{h}</th>)}</tr></thead><tbody>
        {data.records.map(r => <tr key={r.id} className="border-t border-slate-100 align-top"><td className="px-5 py-4 whitespace-nowrap">{formatDate(r.date)}<div className="mt-1 text-slate-500">{r.reference || r.id.slice(0, 8)}</div></td>
          <td className="px-5 py-4 min-w-48"><a className="font-bold text-sky-800 hover:underline" href={`/accounts?ledger=${encodeURIComponent(r.customer_id)}`} title={`Customer ledger: ${r.customer_name}`}>{r.customer_name}</a><ArrowRight size={12} className="inline mx-2 text-slate-400" /><a className="font-bold text-teal-800 hover:underline" href={`/supplier?ledger=${encodeURIComponent(r.supplier_id)}`} title={`Supplier ledger: ${r.supplier_name}`}>{r.supplier_name}</a>
            {r.notes && <p className="mt-1 text-slate-500">{r.notes}</p>}<p className="mt-1 text-[10px] text-slate-400">By {r.created_by_name} · {r.id.slice(0,8)}</p></td>
          <td className="px-5 py-4 whitespace-nowrap font-bold text-slate-900">{formatCurrency(Number(r.amount))}<p className="mt-1 text-[10px] font-normal text-slate-500">Cash / bank: Rs 0</p></td>
          <td className="px-5 py-4"><span className={`rounded-full px-2 py-1 font-semibold ${r.reversed_at ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{r.reversed_at ? "Reversed" : "Completed"}</span>{r.reversed_at && <p className="mt-2 min-w-32 text-slate-500">{formatDate(r.reversed_at)} · {r.reversal_reason}</p>}</td>
          <td className="px-5 py-4">{user?.isAdmin && !r.reversed_at && !historyOnly && <button aria-label={`Reverse settlement ${r.reference || r.id.slice(0,8)}`} onClick={() => { setReverse(r); setReason(""); setError(""); }} className="flex items-center gap-1 text-amber-800 font-semibold"><RotateCcw size={13} />Reverse</button>}</td></tr>)}
      </tbody></table></div>}
    </>}
    {(open || reverse) && createPortal(<div className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-950/50 p-3" onClick={e => { if (e.target === e.currentTarget && !busy) { setOpen(false); setReverse(null); } }}>
      <div role="dialog" aria-modal="true" aria-labelledby="direct-title" className="w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" style={{ maxHeight: "92vh" }}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5"><div><h2 id="direct-title" className="text-xl font-extrabold text-slate-900">{reverse ? "Reverse direct settlement" : "Record direct payment"}</h2><p className="mt-1 text-sm text-slate-500">{reverse ? "Restore both balances and keep the complete audit trail." : "Your customer pays your supplier on your behalf."}</p></div><button aria-label="Close direct payment" disabled={busy} onClick={() => { setOpen(false); setReverse(null); }} className="p-1 text-slate-400"><X size={21}/></button></div>
        <div className="space-y-5 p-6">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {reverse ? <><p className="text-sm text-slate-700"><b>{reverse.customer_name}</b> → <b>{reverse.supplier_name}</b> · {formatCurrency(Number(reverse.amount))}</p><label className="block text-sm font-semibold text-slate-700">Reason for reversal<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} className={`${inputClass} mt-2`} placeholder="Explain why this payment must be reversed" /></label><p className="text-xs text-slate-500">Both ledger credits will be reversed together. Original entries remain visible. Cash and bank balances stay the same.</p></> : <>
            <div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Customer who paid</label><SearchableSelect value={customerId} onChange={setCustomerId} options={(data.customers ?? []).map(c => ({ value: c.id, label: c.name, searchText: `${c.name} ${c.id}` }))} placeholder="Select customer" inputClassName={inputClass} /><p className="mt-2 text-xs text-slate-500">Customer owes you <b className="text-slate-800">{customer ? formatCurrency(customer.balance) : "—"}</b></p></div>
            <div><label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Supplier who received</label><SearchableSelect value={supplierId} onChange={setSupplierId} options={(data.suppliers ?? []).map(s => ({ value: s.id, label: s.name, searchText: `${s.name} ${s.id}` }))} placeholder="Select supplier" inputClassName={inputClass} /><p className="mt-2 text-xs text-slate-500">You owe supplier <b className="text-slate-800">{supplier ? formatCurrency(supplier.balance) : "—"}</b></p></div></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-700">Amount (PKR)<input aria-label="Settlement amount" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={`${inputClass} mt-2`} /></label><label className="block text-sm font-semibold text-slate-700">Payment date<input type="date" value={date} max={businessToday()} onChange={e => setDate(e.target.value)} className={`${inputClass} mt-2`} /></label></div>
            {customer && supplier && <p className={`text-xs ${value > limit ? "text-red-600" : "text-slate-500"}`}>Maximum settlement: {formatCurrency(limit)}. Advances and overpayments are not allowed.</p>}
            <label className="block text-sm font-semibold text-slate-700">Payment reference <span className="font-normal text-slate-400">(optional)</span><input value={reference} onChange={e => setReference(e.target.value)} maxLength={200} placeholder="Bank reference, receipt or transaction ID" className={`${inputClass} mt-2`} /></label>
            <label className="block text-sm font-semibold text-slate-700">Notes <span className="font-normal text-slate-400">(optional)</span><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="Any details to keep with this payment" rows={2} className={`${inputClass} mt-2`} /></label>
            <div className="rounded-xl border border-sky-100 bg-sky-50 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-bold text-sky-900"><CheckCircle2 size={17} />After this settlement</div><div className="grid gap-3 sm:grid-cols-3">{[["Customer still owes", customer ? formatCurrency(Math.max(0,customer.balance - (value || 0))) : "—"],["Supplier still payable", supplier ? formatCurrency(Math.max(0,supplier.balance - (value || 0))) : "—"],["Cash / bank change", "Rs 0"]].map(([label, text]) => <div key={label}><p className="text-[11px] text-sky-800">{label}</p><p className="mt-1 text-lg font-extrabold text-slate-900">{text}</p></div>)}</div></div>
          </>}
          <div className="flex items-start gap-2 text-xs text-slate-500"><ShieldCheck size={16} className="shrink-0 text-teal-700" /><p>{reverse ? "Reversal is an admin action and requires a reason." : "Both ledgers update together. No cash or bank transaction is created. You can reverse this entry with a reason."}</p></div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button disabled={busy} onClick={() => { setOpen(false); setReverse(null); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={busy || (reverse ? !reason.trim() : !valid)} onClick={() => void (reverse ? undo() : save())} className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 ${reverse ? "bg-amber-700" : "bg-sky-700"}`}>{busy ? "Saving…" : reverse ? "Reverse both ledgers" : "Review & record"}</button></div>
      </div>
    </div>, document.body)}
  </section>;
}
