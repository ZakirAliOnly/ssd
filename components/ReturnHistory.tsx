"use client";
import { unitLabel } from "@/lib/productUnits";


import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";
import type { ReturnHistoryEntry } from "@/lib/returnHistory";

const button = "border border-[var(--gray-200)] rounded-[8px] px-3 py-2 text-sm font-semibold bg-white hover:bg-[var(--blue-pale)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[var(--blue)] cursor-pointer";
const input = "border border-[var(--gray-200)] rounded-[8px] px-3 py-2 text-sm bg-[var(--gray-50)] focus-visible:outline-2 focus-visible:outline-[var(--blue)]";

export function ReturnHistory({ onPrint }: { onPrint: (entry: ReturnHistoryEntry) => void }) {
  const [type, setType] = useState<"sales" | "supplier">("sales");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnHistoryEntry[]>([]);
  const [count, setCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReturnHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params: Record<string, string> = selectedId ? { type, id: selectedId } : { type, q: query, page: String(page) };
        const response = await fetch(`/api/returns/history?${new URLSearchParams(params)}`, { signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "Could not load return history.");
        if (selectedId) setDetail(result.returns[0]);
        else { setRows(result.returns); setCount(result.count); }
      } catch (err) {
        if (!controller.signal.aborted) { setRows([]); setDetail(null); setError(err instanceof Error ? err.message : "Could not load return history."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [type, query, page, selectedId, refresh]);
  const reset = () => { setPage(1); setRows([]); setLoading(true); setError(""); };
  return <section className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 sm:p-5">
    <h2 className="text-lg font-bold mb-4">Return History</h2>
    {selectedId ? <button type="button" className={`${button} mb-4`} onClick={() => { setSelectedId(null); setDetail(null); setLoading(true); }}><ChevronLeft size={16} className="inline mr-1" />Back to history</button> : <div className="flex flex-wrap gap-3 mb-4">
      <label className="flex flex-col gap-1 text-sm font-semibold">Return type
        <select value={type} className={input} onChange={e => { setType(e.target.value as "sales" | "supplier"); reset(); }}>
          <option value="sales">Sales returns</option><option value="supplier">Supplier returns</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold flex-1 min-w-0">Search returns
        <input type="search" className={`${input} w-full`} value={query} placeholder="Invoice number, party, product or return ID" onChange={e => { setQuery(e.target.value); reset(); }} />
      </label>
    </div>}
    {loading && <p role="status" className="py-6 text-sm">Loading return history...</p>}
    {!loading && error && <p role="alert" className="text-sm text-[var(--red)]">{error} <button type="button" className={button} onClick={() => setRefresh(v => v + 1)}>Retry</button></p>}
    {!loading && !error && selectedId && detail && <div>
      <div className="flex flex-wrap justify-between gap-3 mb-4">
        <div><h3 className="text-base font-bold">{detail.scope}</h3><p className="text-sm">{detail.invoice_number} · {detail.party}</p></div>
        <button type="button" className={button} onClick={() => onPrint(detail)}><Printer size={16} className="inline mr-2" />Print receipt</button>
      </div>
      <dl className="grid sm:grid-cols-2 gap-3 mb-4 text-sm">
        <div><dt className="font-semibold">Return date</dt><dd>{formatDate(detail.return_date)}</dd></div>
        <div><dt className="font-semibold">Invoice date</dt><dd>{formatDate(detail.invoice_date)}</dd></div>
        <div><dt className="font-semibold">Return ID</dt><dd className="break-all">{detail.id}</dd></div>
        <div><dt className="font-semibold">Processed by</dt><dd>{detail.created_by_name || "—"}</dd></div>
      </dl>
      <p className="text-sm mb-4">{detail.scope === "Whole invoice" ? "All original invoice items and quantities were returned in this return." : detail.scope === "Remaining invoice" ? "This return includes all quantities left after earlier partial returns." : "Only the products and quantities listed below were returned."}</p>
      {detail.reason && <p className="text-sm whitespace-pre-wrap mb-4"><strong>Reason: </strong>{detail.reason}</p>}
      <div className="overflow-x-auto"><table className={`${DT.table} min-w-[560px]`}>
        <thead><tr>{["Product / Description", "Returned qty", type === "supplier" ? "Stock removed" : "Stock restored", "Credit"].map((h, i) => <th key={h} scope="col" className={`${DT.thDense} ${i === 3 ? "text-right" : i ? "text-center" : "text-left"}`} style={DT.thStyle}>{h}</th>)}</tr></thead>
        <tbody>{detail.items.map(item => <tr key={item.id} className={DT.row}>
          <td className={DT.tdDense}><strong>{item.product_name}</strong><div className="text-sm whitespace-pre-wrap break-words">{item.description}</div></td>
          <td className={`${DT.tdDense} text-center tabular-nums`}>{Number(item.qty)} {unitLabel(item.unit)}</td>
          <td className={`${DT.tdDense} text-center tabular-nums`}>{Number(item.stock_restored_qty)}</td>
          <td className={`${DT.tdDense} text-right font-mono`}>{formatCurrency(Number(item.amount))}</td>
        </tr>)}</tbody>
        <tfoot><tr className="font-bold"><td colSpan={3} className={DT.tdDense}>Total credit</td><td className={`${DT.tdDense} text-right font-mono`}>{formatCurrency(Number(detail.amount))}</td></tr></tfoot>
      </table></div>
      <p className="text-xs text-[var(--gray-800)] mt-3">This record credits the return value. Cash refunds are recorded separately.</p>
    </div>}
    {!selectedId && !loading && !error && <>
      <div className="overflow-x-auto"><table className={`${DT.table} min-w-[700px]`}>
        <thead><tr>{["Return date", "Invoice", "Party / Supplier", "Return scope", "Credit", ""].map((h, i) => <th key={i} scope="col" className={`${DT.thDense} ${i === 4 ? "text-right" : "text-left"}`} style={DT.thStyle}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={DT.row}>
          <td className={DT.tdDense}>{formatDate(row.return_date)}</td><td className={DT.tdDense}>{row.invoice_number}</td><td className={DT.tdDense}>{row.party}</td><td className={DT.tdDense}>{row.scope}</td>
          <td className={`${DT.tdDense} text-right font-mono`}>{formatCurrency(Number(row.amount))}</td>
          <td className={DT.tdDense}><button type="button" className={button} aria-label={`View return details for ${row.invoice_number} on ${formatDate(row.return_date)}`} onClick={() => { setSelectedId(row.id); setDetail(null); setLoading(true); }}>View details</button></td>
        </tr>)}{!rows.length && <tr><td colSpan={6} className={DT.empty}>No returns match your search.</td></tr>}</tbody>
      </table></div>
      <div className="flex flex-wrap justify-between gap-3 items-center mt-4 text-sm"><span>{count} returns · Page {page} of {Math.max(1, Math.ceil(count / 25))}</span><div className="flex gap-2">
        <button type="button" aria-label="Previous history page" disabled={page <= 1} className={button} onClick={() => { setPage(p => p - 1); setLoading(true); }}><ChevronLeft size={16} /></button>
        <button type="button" aria-label="Next history page" disabled={page * 25 >= count} className={button} onClick={() => { setPage(p => p + 1); setLoading(true); }}><ChevronRight size={16} /></button>
      </div></div>
    </>}
  </section>;
}
