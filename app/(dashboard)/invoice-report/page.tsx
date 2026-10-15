"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import { Printer, FileText } from "lucide-react";
import type { Invoice } from "@/lib/database.types";
import { DT } from "@/lib/dataTableStyles";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintHeader } from "@/components/PrintHeader";
import { useUser } from "@/lib/UserContext";
import { SearchableSelect } from "@/components/SearchableSelect";

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  paid:    { bg: "var(--green-light)", color: "var(--green)", label: "Paid" },
  partial: { bg: "var(--orange-light)", color: "#B45309", label: "Partial" },
  unpaid:  { bg: "var(--red-light)", color: "var(--red)", label: "Unpaid" },
};

export default function InvoiceReportPage() {
  const userProfile = useUser();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string }[]>([]);

  // Filters
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(todayISO());
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "partial" | "unpaid">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: invData }, { data: acctData }] = await Promise.all([
      db
        .from("invoices")
        .select("*")
        .gte("invoice_date", fromDate)
        .lte("invoice_date", toDate)
        .order("invoice_date", { ascending: true })
        .order("created_at", { ascending: true }),
      db.from("accounts").select("id, name").order("name"),
    ]);
    if (invData) setInvoices(invData);
    if (acctData) setAllAccounts(acctData);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtered list
  const filtered = invoices.filter((inv) => {
    const nameMatch = clientFilter === "all" || inv.client_name === clientFilter;
    const statusMatch = statusFilter === "all" || inv.payment_status === statusFilter;
    return nameMatch && statusMatch;
  });

  // Totals
  const totalAmount  = filtered.reduce((s, i) => s + Number(i.grand_total), 0);
  const totalReceived = filtered.reduce((s, i) => s + Number(i.amount_received), 0);
  const totalBalance  = filtered.reduce((s, i) => s + Number(i.balance_due), 0);
  const countPaid    = filtered.filter((i) => i.payment_status === "paid").length;
  const countPartial = filtered.filter((i) => i.payment_status === "partial").length;
  const countUnpaid  = filtered.filter((i) => i.payment_status === "unpaid").length;

  return (
    <>
      {/* ── Screen UI ── */}
      <div className="no-print animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Invoice Report</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Summary of all invoices for the selected period</p>
          </div>
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer"
            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
            <Printer size={14} /> Print / PDF
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 mb-4 flex flex-wrap gap-3 items-end"
          style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>From Date</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none"
              style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>To Date</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none"
              style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
          </div>
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Client</label>
            <SearchableSelect
              value={clientFilter}
              onChange={setClientFilter}
              options={allAccounts.map((a) => ({ value: a.name, label: a.name }))}
              placeholder="— All Clients —"
              emptyValue="all"
              inputClassName="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none w-full"
              inputStyle={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Status</label>
            <div className="flex border-[1.5px] rounded-[8px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
              {(["all", "paid", "partial", "unpaid"] as const).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className="px-3 py-1.5 text-[11px] font-semibold border-none cursor-pointer capitalize"
                  style={{
                    background: statusFilter === s ? "var(--blue-deeper)" : "var(--gray-50)",
                    color: statusFilter === s ? "#fff" : "var(--gray-500)",
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {[
            { label: "Total Invoices", val: String(filtered.length), color: "var(--blue-deeper)" },
            { label: "Total Amount", val: formatCurrency(totalAmount), color: "var(--gray-900)" },
            { label: "Received", val: formatCurrency(totalReceived), color: "var(--green)" },
            { label: "Balance Due", val: formatCurrency(totalBalance), color: "var(--red)" },
            { label: "Paid", val: String(countPaid), color: "var(--green)" },
            { label: "Unpaid / Partial", val: `${countUnpaid} / ${countPartial}`, color: "var(--red)" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-[12px] border border-[var(--gray-100)] px-4 py-3"
              style={{ boxShadow: "var(--shadow-xs)" }}>
              <div className="text-[10px] font-bold tracking-wider uppercase mb-1" style={{ color: "var(--gray-800)" }}>{c.label}</div>
              <div className="text-[14px] font-extrabold font-mono" style={{ color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
          {loading ? (
            <div className="text-center py-10 text-[13px]" style={{ color: "var(--gray-800)" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center">
              <FileText size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
              <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No invoices found for this period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={`${DT.table} min-w-[900px]`}>
                <thead>
                  <tr>
                    {["#", "Invoice No", "Date", "Client", "Created By", "Subtotal", "Discount", "Grand Total", "Received", "Balance Due", "Status"].map((h) => {
                      const right = ["Subtotal", "Discount", "Grand Total", "Received", "Balance Due"].includes(h);
                      return (
                        <th key={h} className={`${DT.thDense} ${right ? "text-right" : "text-left"}`} style={DT.thStyle}>
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv, idx) => {
                    const st = STATUS_STYLES[inv.payment_status] || STATUS_STYLES.unpaid;
                    return (
                      <tr key={inv.id} className={DT.row}>
                        <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>
                          {idx + 1}
                        </td>
                        <td className={DT.tdDense}>
                          <span className="font-mono text-[11px] font-extrabold" style={{ color: "var(--blue-deeper)" }}>{inv.invoice_number}</span>
                        </td>
                        <td className={`${DT.tdDense} ${DT.cellBody} whitespace-nowrap`} style={{ color: "var(--gray-900)" }}>
                          {formatDate(inv.invoice_date)}
                        </td>
                        <td className={DT.tdDense}>
                          <div className={DT.cellPrimary} style={{ color: "var(--gray-900)" }}>{inv.client_name}</div>
                          {inv.client_phone && <div className="text-[12px] font-semibold mt-0.5" style={{ color: "var(--gray-800)" }}>{inv.client_phone}</div>}
                        </td>
                        <td className={DT.tdDense} style={{ color: "var(--gray-800)" }}>
                          <div className="text-[12px] font-semibold">{inv.created_by_name || "—"}</div>
                          {inv.created_by_email && (
                            <div className="text-[10px]" style={{ color: "var(--gray-600)" }}>{inv.created_by_email}</div>
                          )}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[13.5px] font-semibold`} style={{ color: "var(--gray-700)" }}>
                          {formatCurrency(inv.subtotal)}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[13.5px] font-semibold`} style={{ color: "var(--red)" }}>
                          {inv.discount_amount > 0 ? `− ${formatCurrency(inv.discount_amount)}` : "—"}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: "var(--gray-900)" }}>
                          {formatCurrency(inv.grand_total)}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: "var(--green)" }}>
                          {formatCurrency(inv.amount_received)}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`}
                          style={{ color: inv.balance_due > 0 ? "var(--red)" : "var(--green)" }}>
                          {formatCurrency(inv.balance_due)}
                        </td>
                        <td className={DT.tdDense}>
                          <span className={DT.badge}
                            style={{ background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--gray-50)" }}>
                    <td colSpan={4} className={`${DT.tdDense} text-[13.5px] font-bold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-700)" }}>
                      Total ({filtered.length} invoices)
                    </td>
                    <td className={`${DT.tdDense} font-mono text-right text-[13.5px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-900)" }}>
                      {formatCurrency(filtered.reduce((s, i) => s + Number(i.subtotal), 0))}
                    </td>
                    <td className={`${DT.tdDense} font-mono text-right text-[13.5px] font-bold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--red)" }}>
                      {formatCurrency(filtered.reduce((s, i) => s + Number(i.discount_amount), 0))}
                    </td>
                    <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-900)" }}>
                      {formatCurrency(totalAmount)}
                    </td>
                    <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--green)" }}>
                      {formatCurrency(totalReceived)}
                    </td>
                    <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--red)" }}>
                      {formatCurrency(totalBalance)}
                    </td>
                    <td className={`${DT.tdDense} border-t-2 border-[var(--gray-200)]`}>
                      <div className="flex gap-1 flex-wrap text-[10px] font-bold">
                        <span style={{ color: "var(--green)" }}>{countPaid} paid</span>
                        <span style={{ color: "#B45309" }}>{countPartial} partial</span>
                        <span style={{ color: "var(--red)" }}>{countUnpaid} unpaid</span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Print Layout ── */}
      <div className="print-only a4-report" style={{ background: "#fff", fontFamily: "Arial, Helvetica, sans-serif", color: "#111", fontSize: 11 }}>
        <PrintHeader />

        {/* Title bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", background: "#0369a1", color: "#fff", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase" }}>Invoice Report</span>
          <span style={{ fontSize: 10, fontWeight: 600 }}>
            {formatDate(fromDate)} — {formatDate(toDate)}
            {clientFilter !== "all" && <span> · {clientFilter}</span>}
            {statusFilter !== "all" && <span> · {statusFilter}</span>}
          </span>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: "0 12px", marginBottom: 14 }}>
          {[
            { label: "Total Invoices", val: String(filtered.length), color: "#0369a1" },
            { label: "Grand Total", val: formatCurrency(totalAmount), color: "#111" },
            { label: "Amount Received", val: formatCurrency(totalReceived), color: "#16a34a" },
            { label: "Balance Due", val: formatCurrency(totalBalance), color: "#dc2626" },
          ].map((c) => (
            <div key={c.label} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 10px", textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: c.color, fontFamily: "monospace" }}>{c.val}</div>
            </div>
          ))}
        </div>

        {/* Invoices table */}
        <div style={{ padding: "0 12px", marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
            <thead>
              <tr>
                {["#", "Invoice No", "Date", "Client / Party", "Grand Total", "Received", "Balance Due", "Status"].map((h) => (
                  <th key={h} style={{ background: "#0369a1", color: "#fff", fontWeight: 700, textAlign: h === "Grand Total" || h === "Received" || h === "Balance Due" ? "right" : "left", padding: "7px 8px", fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, idx) => (
                <tr key={inv.id} style={{ background: idx % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "6px 8px", color: "#666", borderLeft: "1px solid #e5e7eb" }}>{idx + 1}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 800, color: "#0369a1", fontFamily: "monospace", borderLeft: "1px solid #e5e7eb" }}>{inv.invoice_number}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap", borderLeft: "1px solid #e5e7eb" }}>{formatDate(inv.invoice_date)}</td>
                  <td style={{ padding: "6px 8px", borderLeft: "1px solid #e5e7eb" }}>
                    <div style={{ fontWeight: 700 }}>{inv.client_name}</div>
                    {inv.client_phone && <div style={{ fontSize: 9.5, color: "#555" }}>{inv.client_phone}</div>}
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 800, fontFamily: "monospace", textAlign: "right", borderLeft: "1px solid #e5e7eb" }}>{formatCurrency(inv.grand_total)}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 700, fontFamily: "monospace", textAlign: "right", color: "#16a34a", borderLeft: "1px solid #e5e7eb" }}>{formatCurrency(inv.amount_received)}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 800, fontFamily: "monospace", textAlign: "right", color: inv.balance_due > 0 ? "#dc2626" : "#16a34a", borderLeft: "1px solid #e5e7eb" }}>{formatCurrency(inv.balance_due)}</td>
                  <td style={{ padding: "6px 8px", borderLeft: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb" }}>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 5px", borderRadius: 3, background: inv.payment_status === "paid" ? "#dcfce7" : inv.payment_status === "partial" ? "#fff7ed" : "#fef2f2", color: inv.payment_status === "paid" ? "#16a34a" : inv.payment_status === "partial" ? "#ea580c" : "#dc2626", textTransform: "uppercase" }}>
                      {inv.payment_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f3f4f6", borderTop: "2px solid #0369a1" }}>
                <td colSpan={4} style={{ padding: "7px 8px", fontWeight: 900, fontSize: 11, borderLeft: "1px solid #e5e7eb" }}>
                  TOTAL — {filtered.length} Invoice{filtered.length !== 1 ? "s" : ""}
                  <span style={{ fontSize: 9.5, color: "#555", fontWeight: 500, marginLeft: 6 }}>
                    ({countPaid} paid · {countPartial} partial · {countUnpaid} unpaid)
                  </span>
                </td>
                <td style={{ padding: "7px 8px", fontWeight: 900, fontFamily: "monospace", textAlign: "right", fontSize: 12, borderLeft: "1px solid #e5e7eb" }}>{formatCurrency(totalAmount)}</td>
                <td style={{ padding: "7px 8px", fontWeight: 900, fontFamily: "monospace", textAlign: "right", fontSize: 12, color: "#16a34a", borderLeft: "1px solid #e5e7eb" }}>{formatCurrency(totalReceived)}</td>
                <td style={{ padding: "7px 8px", fontWeight: 900, fontFamily: "monospace", textAlign: "right", fontSize: 12, color: "#dc2626", borderLeft: "1px solid #e5e7eb" }}>{formatCurrency(totalBalance)}</td>
                <td style={{ borderLeft: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb" }} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer image */}
        <PrintFooter />
      </div>
    </>
  );
}
