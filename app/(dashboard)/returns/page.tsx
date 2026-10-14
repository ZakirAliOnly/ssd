"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";
import { planInvoiceReturn, type ReturnLineSource, type ReturnedLine } from "@/lib/invoiceReturns";

type InvoiceSummary = { id: string; invoice_number: string; client_name: string; invoice_date: string;
  grand_total: string; is_walk_in: boolean; returns: { amount: string }[] };
type ReturnRecord = { id: string; return_date: string; reason: string; amount: string; created_by_name: string;
  items: { id: string; product_name: string; qty: string; amount: string; stock_restored_qty: string }[] };
type InvoiceDetail = Omit<InvoiceSummary, "returns"> & { discount_amount: string;
  items: (ReturnLineSource & { product: { name: string } | null; return_items: ReturnedLine[] })[];
  returns: ReturnRecord[] };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const inputClass = "border border-[var(--gray-200)] rounded-[8px] px-3 py-2 text-sm bg-[var(--gray-50)] text-[var(--gray-900)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] disabled:opacity-60";
const buttonClass = "px-4 py-2 rounded-[8px] text-sm font-semibold border border-[var(--gray-200)] bg-white hover:bg-[var(--blue-pale)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
const remaining = (line: InvoiceDetail["items"][number]) => Math.round((Number(line.qty) - line.return_items.reduce((sum, item) => sum + Number(item.qty), 0)) * 100) / 100;

export default function ReturnsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<InvoiceSummary[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setListError("");
      try {
        const response = await fetch(`/api/returns?${new URLSearchParams({ q: query, page: String(page) })}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load invoices.");
        setList(result.invoices); setCount(result.count);
      } catch (err) {
        if (!controller.signal.aborted) { setList([]); setListError(err instanceof Error ? err.message : "Could not load invoices."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, refresh]);

  useEffect(() => {
    if (!selectedId) { setInvoice(null); return; }
    const controller = new AbortController();
    setInvoice(null); setDetailLoading(true); setError(""); setQuantities({}); setReviewing(false); setUncertain(false);
    setReason(""); setDate(today()); requestId.current = crypto.randomUUID();
    void (async () => {
      try {
        const response = await fetch(`/api/returns?id=${selectedId}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load invoice.");
        setInvoice(result.invoice);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load invoice."); }
      finally { if (!controller.signal.aborted) setDetailLoading(false); }
    })();
    return () => controller.abort();
  }, [selectedId, refresh]);

  const previous = useMemo(() => invoice?.items.flatMap(item => item.return_items) ?? [], [invoice]);
  const selections = useMemo(() => Object.entries(quantities).filter(([, value]) => value.trim() !== "" && Number(value) !== 0)
    .map(([invoice_item_id, qty]) => ({ invoice_item_id, qty: Number(qty) })), [quantities]);
  const preview = useMemo(() => {
    if (!invoice || !selections.length) return { plan: null, error: "" };
    try { return { plan: planInvoiceReturn(invoice, previous, selections), error: "" }; }
    catch (err) { return { plan: null, error: err instanceof Error ? err.message : "Check return quantities." }; }
  }, [invoice, previous, selections]);
  const locked = saving || uncertain;
  const returnable = invoice?.items.some(item => remaining(item) > 0) ?? false;

  async function submitReturn() {
    if (saving || !invoice || !preview.plan) return;
    setSaving(true); setError(""); setSuccess("");
    let definiteFailure = false;
    try {
      const response = await fetch("/api/returns", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, requestId: requestId.current, date, reason, selections }) });
      const result = await response.json();
      if (!response.ok) { definiteFailure = true; setUncertain(false); throw new Error(result.error || "Could not save this return."); }
      setSuccess(`Return saved. ${formatCurrency(Number(result.record.amount))} credit recorded. Stock has been restored where tracked. No cash refund was recorded.`);
      setRefresh(value => value + 1);
    } catch (err) {
      // Keep the same request ID on retry, so a lost response cannot create a second return.
      if (!definiteFailure) setUncertain(true);
      setError(err instanceof Error ? err.message : "Could not confirm return. Reload the invoice before creating another return.");
    } finally { setSaving(false); }
  }

  return <div style={{ color: "var(--gray-900)" }}>
    <div className="mb-5"><h1 className="text-2xl font-extrabold">Returns</h1>
      <p className="text-sm mt-1 text-[var(--gray-800)]">Return an entire invoice or selected quantities. Returned stock is restored and the value is credited; cash refunds are recorded separately.</p></div>
    {success && <p role="status" className="mb-4 rounded-[8px] border border-[var(--green)] bg-[var(--green-light)] p-3 text-sm">{success}</p>}
    <div className="bg-white border border-[var(--gray-100)] rounded-[14px] mb-6 overflow-hidden">
      <div className="p-4 border-b border-[var(--gray-100)]">
        <label htmlFor="return-search" className="block text-sm font-semibold mb-2">Find an invoice</label>
        <div className="relative max-w-lg"><Search size={17} className="absolute left-3 top-3 text-[var(--gray-800)]" aria-hidden="true" />
          <input id="return-search" type="search" value={query} disabled={locked} onChange={event => { setPage(1); setQuery(event.target.value); }}
            placeholder="Search invoice number, ID or party" className={`${inputClass} w-full pl-9`} /></div>
      </div>
      {listError ? <div role="alert" className="p-4 text-sm text-[var(--red)]">{listError}<button onClick={() => setRefresh(value => value + 1)} className={`${buttonClass} ml-3`}>Retry</button></div>
        : <div className="overflow-x-auto"><table className={`${DT.table} min-w-[680px]`}>
          <thead><tr>{["Invoice", "Date", "Party", "Invoice total", "Returned value", ""].map((title, index) => <th key={index} scope="col" className={`${DT.th} ${index === 3 || index === 4 ? "text-right" : "text-left"}`} style={DT.thStyle}>{title}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={6} className={DT.empty}>Loading invoices...</td></tr> : list.map(row => <tr key={row.id} className={DT.row} style={selectedId === row.id ? { background: "var(--blue-pale)" } : undefined}>
            <td className={`${DT.td} ${DT.cellPrimary}`}>{row.invoice_number}</td><td className={`${DT.td} whitespace-nowrap`}>{formatDate(row.invoice_date)}</td>
            <td className={DT.td}>{row.client_name || "Walk-in"}{row.is_walk_in && <span className="block text-xs text-[var(--gray-800)]">Walk-in</span>}</td>
            <td className={`${DT.td} ${DT.cellMono} text-right`}>{formatCurrency(Number(row.grand_total))}</td>
            <td className={`${DT.td} ${DT.cellMono} text-right`}>{formatCurrency(row.returns.reduce((sum, entry) => sum + Number(entry.amount), 0))}</td>
            <td className={`${DT.td} text-right`}><button type="button" disabled={locked} onClick={() => { setSelectedId(row.id); setSuccess(""); }} aria-pressed={selectedId === row.id} className={buttonClass}>{selectedId === row.id ? "Selected" : "Select"}</button></td>
          </tr>)}{!loading && !list.length && <tr><td colSpan={6} className={DT.empty}>No invoices match your search.</td></tr>}</tbody>
        </table></div>}
      <div className="p-3 flex items-center justify-between gap-3 text-sm"><span>{count} invoices · Page {page} of {Math.max(1, Math.ceil(count / 25))}</span><div className="flex gap-2">
        <button type="button" aria-label="Previous page" disabled={page <= 1 || loading || locked} onClick={() => setPage(value => value - 1)} className={buttonClass}><ChevronLeft size={16} /></button>
        <button type="button" aria-label="Next page" disabled={page * 25 >= count || loading || locked} onClick={() => setPage(value => value + 1)} className={buttonClass}><ChevronRight size={16} /></button>
      </div></div>
    </div>
    {detailLoading && <p role="status" className="p-4 text-sm">Loading invoice items...</p>}
    {error && <p role="alert" className="mb-4 text-sm text-[var(--red)]">{error}</p>}
    {selectedId && !detailLoading && !invoice && <button className={buttonClass} onClick={() => setRefresh(value => value + 1)}>Reload invoice</button>}
    {invoice && <section className="bg-white border border-[var(--gray-100)] rounded-[14px] p-4 sm:p-5">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4"><div><h2 className="text-lg font-bold">Return from {invoice.invoice_number}</h2>
        <p className="text-sm text-[var(--gray-800)]">{invoice.client_name || "Walk-in"} · {formatDate(invoice.invoice_date)}</p></div>
        <button type="button" disabled={locked || !returnable} className={buttonClass} onClick={() => { setQuantities(Object.fromEntries(invoice.items.map(item => [item.id, String(remaining(item))]))); setReviewing(false); }}>
          <RotateCcw size={15} className="inline mr-2" />Return whole invoice</button></div>
      <p className="text-sm mb-4 text-[var(--gray-800)]">Whole invoice selects every remaining quantity. Enter a quantity for each product you want to return. Credits use the original discounted invoice value, including taxes. Previously returned units cannot be returned again.</p>
      <div className="overflow-x-auto"><table className={`${DT.table} min-w-[760px]`}><thead><tr>{["Product / Description", "Sold qty", "Returned qty", "Remaining qty", "Return qty", "Credit"].map((title, index) => <th key={title} scope="col" className={`${DT.thDense} ${index === 0 ? "text-left" : index === 5 ? "text-right" : "text-center"}`} style={DT.thStyle}>{title}</th>)}</tr></thead>
        <tbody>{invoice.items.map(item => <tr key={item.id}>
          <td className={`${DT.tdDense} align-top`}><span className="font-semibold">{item.product?.name || item.category || "Invoice item"}</span><span className="block text-sm whitespace-pre-wrap break-words text-[var(--gray-800)]">{item.description}</span>
            {Number(item.stock_deducted_qty) === 0 && <span className="block text-xs text-[var(--gray-800)]">No tracked stock deduction; return credits value only.</span>}</td>
          <td className={`${DT.tdDense} text-center tabular-nums`}>{Number(item.qty)}</td>
          <td className={`${DT.tdDense} text-center tabular-nums`}>{Math.round((Number(item.qty) - remaining(item)) * 100) / 100}</td>
          <td className={`${DT.tdDense} text-center tabular-nums`}>{remaining(item)}</td>
          <td className={`${DT.tdDense} text-center`}><input type="number" min="0" max={remaining(item)} step="0.01" disabled={locked || remaining(item) <= 0} value={quantities[item.id] ?? ""} placeholder="0"
            aria-label={`Return quantity for ${item.product?.name || item.category}`} onChange={event => { setQuantities(value => ({ ...value, [item.id]: event.target.value })); setReviewing(false); }} className={`${inputClass} w-24 text-center`} /></td>
          <td className={`${DT.tdDense} text-right font-mono`}>{formatCurrency(preview.plan?.lines.find(line => line.invoice_item_id === item.id)?.amount ?? 0)}</td>
        </tr>)}</tbody></table></div>
      {!returnable && <p role="status" className="mt-4 text-sm">All items on this invoice have already been returned.</p>}
      {returnable && <><div className="grid sm:grid-cols-[180px_1fr] gap-4 my-4">
        <div><label htmlFor="return-date" className="block text-sm font-semibold mb-1">Return date</label><input id="return-date" type="date" min={invoice.invoice_date.slice(0, 10)} max={today()} value={date} disabled={locked} onChange={event => { setDate(event.target.value); setReviewing(false); }} className={`${inputClass} w-full`} /></div>
        <div><label htmlFor="return-reason" className="block text-sm font-semibold mb-1">Reason (optional)</label><input id="return-reason" value={reason} maxLength={1000} disabled={locked} onChange={event => { setReason(event.target.value); setReviewing(false); }} className={`${inputClass} w-full`} placeholder="e.g. Wrong product or customer return" /></div>
      </div>
      {preview.error && <p role="alert" className="text-sm text-[var(--red)] mb-3">{preview.error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--gray-100)] pt-4"><div><span className="text-sm font-semibold">Return credit</span><strong className="block text-lg font-mono">{formatCurrency(preview.plan?.amount ?? 0)}</strong></div>
        {!reviewing ? <button type="button" disabled={!preview.plan || locked || !date} onClick={() => setReviewing(true)} className={`${buttonClass} bg-[var(--blue-deeper)] text-white hover:bg-[var(--blue)]`}>Review return</button>
          : <div className="flex flex-wrap gap-2 items-center"><span className="text-sm">Confirm {preview.plan?.lines.length} item(s) for {formatCurrency(preview.plan?.amount ?? 0)}?</span>
            <button disabled={locked} type="button" className={buttonClass} onClick={() => setReviewing(false)}>Back</button>
            <button type="button" disabled={saving || !preview.plan} className={`${buttonClass} bg-[var(--blue-deeper)] text-white hover:bg-[var(--blue)]`} onClick={() => void submitReturn()}>{saving ? "Saving..." : uncertain ? "Retry same return" : "Confirm return"}</button></div>}
      </div>
      {uncertain && <p role="status" className="text-sm mt-3">The save response was interrupted. Retry the same return safely, or <button type="button" disabled={saving} className="underline font-semibold" onClick={() => setRefresh(value => value + 1)}>reload this invoice</button> to check its history.</p>}
      </>}
      <div className="mt-6 border-t border-[var(--gray-100)] pt-4"><h3 className="text-base font-bold mb-3">Return history</h3>
        {!invoice.returns.length ? <p className="text-sm text-[var(--gray-800)]">No returns recorded for this invoice.</p> : <div className="space-y-3">{invoice.returns.map(record => <div key={record.id} className="border border-[var(--gray-100)] rounded-[8px] p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{formatDate(record.return_date)}</strong><strong className="font-mono">{formatCurrency(Number(record.amount))}</strong></div>
          <p className="text-xs text-[var(--gray-800)] break-all">Return ID: {record.id} · {record.created_by_name}</p>
          {record.reason && <p className="mt-1 whitespace-pre-wrap">{record.reason}</p>}
          <ul className="mt-2 list-disc pl-5">{record.items.map(item => <li key={item.id}>{item.product_name}: {Number(item.qty)} returned · {Number(item.stock_restored_qty)} restored to stock · {formatCurrency(Number(item.amount))}</li>)}</ul>
        </div>)}</div>}
      </div>
    </section>}
  </div>;
}
