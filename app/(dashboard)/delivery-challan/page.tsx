"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { ClipboardList, Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatDate } from "@/lib/helpers";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintHeader } from "@/components/PrintHeader";
import type { InvoiceItem } from "@/lib/database.types";

type InvoicePick = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_phone: string;
  invoice_date: string;
  job_notes?: string;
};

type PrintRow = {
  id: string;
  detail: string;
  qty: string;
};

/** Matches sample `delivery_chalan.pdf` date style (e.g. 23-Aug-25). */
function formatChallanDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const mon = d.toLocaleDateString("en-GB", { month: "short" });
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yr}`;
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true });
}

function itemsToPrintRows(items: InvoiceItem[]): PrintRow[] {
  return items.map((it, i) => {
    const qty = Number(it.qty) || 1;
    const detail = [it.category, it.description].filter(Boolean).join(" — ");
    return {
      id: it.id || `row-${i}`,
      detail,
      qty: String(qty),
    };
  });
}

const DEFAULT_TERMS =
  "Goods delivered as per above details. Please verify quantity and condition on receipt. Subject to invoice and payment terms.";

export default function DeliveryChallanPage() {
  const docRef = useRef<HTMLDivElement>(null);
  const loadVersion = useRef(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [invoices, setInvoices] = useState<InvoicePick[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<InvoicePick | null>(null);
  const [listError, setListError] = useState("");

  const [headerParty, setHeaderParty] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [challanTime, setChallanTime] = useState("");
  const [cell, setCell] = useState("");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [lineItems, setLineItems] = useState<InvoiceItem[]>([]);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [challanNumber, setChallanNumber] = useState("");

  useEffect(() => {
    const requestedInvoice = new URLSearchParams(window.location.search).get("invoice");
    if (requestedInvoice) setInvoiceId(requestedInvoice);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingList(true);
      setListError("");
      let query = db.from("invoices")
        .select("id, invoice_number, client_name, client_phone, invoice_date, job_notes")
        .order("created_at", { ascending: false })
        .limit(300);
      const search = invoiceSearch.trim();
      if (search) query = query.ilike("invoice_number", search);
      const { data, error } = await Promise.resolve(query).catch(() => ({
        data: null,
        error: { message: "Check your connection and try searching again." },
      }));
      if (!active) return;
      setLoadingList(false);
      if (error) {
        setInvoices([]);
        setListError(error.message);
        return;
      }
      setInvoices((data ?? []) as InvoicePick[]);
    }, invoiceSearch.trim() ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [invoiceSearch]);

  const loadInvoice = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    setChallanNumber("");
    if (!id) {
      setLoadingInvoice(false);
      setSelectedInvoice(null);
      setHeaderParty("");
      setChallanDate("");
      setChallanTime(nowTimeStr());
      setCell("");
      setLineItems([]);
      setInvoiceRef("");
      setTerms(DEFAULT_TERMS);
      return;
    }
    setLoadingInvoice(true);
    try {
      const { data: inv, error: invErr } = await db.from("invoices").select("*").eq("id", id).single();
      if (invErr || !inv) {
        showToast(invErr?.message || "Invoice not found", "err");
        return;
      }
      const { data: rows, error: itemErr } = await db
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", id)
        .order("id", { ascending: true });
      if (itemErr) {
        showToast(itemErr.message, "err");
        return;
      }
      // Party contact details can be updated after the invoice was created.
      const partyName = String(inv.client_name ?? "").trim();
      let partyCell = "";
      if (partyName) {
        const { data: parties, error: partyErr } = await db
          .from("accounts")
          .select("phone, whatsapp")
          .eq("name", partyName)
          .limit(1);
        if (partyErr) showToast(partyErr.message, "err");
        const party = parties?.[0];
        partyCell = String(party?.whatsapp ?? "").trim() || String(party?.phone ?? "").trim();
      }
      const items = (rows ?? []) as InvoiceItem[];
      const response = await fetch("/api/delivery-challans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not assign challan number.");
      if (version !== loadVersion.current) return;
      setChallanNumber(result.number);
      // Preserve the selected invoice when a search returns different results.
      setSelectedInvoice({
        id,
        invoice_number: String(inv.invoice_number ?? ""),
        client_name: String(inv.client_name ?? ""),
        client_phone: String(inv.client_phone ?? ""),
        invoice_date: String(inv.invoice_date ?? ""),
      });
      setHeaderParty(String(inv.client_name ?? ""));
      setChallanDate(String(inv.invoice_date ?? ""));
      setChallanTime(nowTimeStr());
      setCell(partyCell || String(inv.client_phone ?? "").trim());
      setInvoiceRef(String(inv.invoice_number ?? ""));
      setLineItems(items);
      if (String(inv.job_notes ?? "").trim()) {
        setTerms(String(inv.job_notes));
      } else {
        setTerms(DEFAULT_TERMS);
      }
    } catch (error) {
      if (version === loadVersion.current) showToast(error instanceof Error ? error.message : "Could not load challan.", "err");
    } finally {
      if (version === loadVersion.current) setLoadingInvoice(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoice(invoiceId);
  }, [invoiceId, loadInvoice]);

  const printRows = useMemo(() => itemsToPrintRows(lineItems), [lineItems]);
  const rowsForPdf = useMemo(
    () =>
      printRows.length
        ? printRows
        : [{ id: "e", detail: "", qty: "" }],
    [printRows],
  );

  const displayDate = formatChallanDate(challanDate);

  async function downloadPdf() {
    const node = docRef.current;
    if (!node || pdfBusy || !invoiceId || !challanNumber || loadingInvoice) return;
    setPdfBusy(true);
    const prev = {
      display: node.style.display,
      position: node.style.position,
      left: node.style.left,
      top: node.style.top,
      width: node.style.width,
    };
    node.style.display = "block";
    node.style.position = "absolute";
    node.style.left = "-99999px";
    node.style.top = "0";
    node.style.width = "148mm";

    try {
      await new Promise((r) => setTimeout(r, 200));
      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a5" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgProps = pdf.getImageProperties(imgData);
      const imgWidth = pageWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      const totalPages = Math.max(1, Math.ceil(imgHeight / pageHeight));
      for (let i = 0; i < totalPages; i++) {
        if (i > 0) pdf.addPage();
        const y = -pageHeight * i;
        pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight);
      }
      const safe = (challanNumber || "challan").replace(/[^\w.-]+/g, "_");
      const party = (headerParty || "Client").slice(0, 40).replace(/[^\w\s.-]+/g, "").replace(/\s+/g, "_");
      pdf.save(`DeliveryChallan_${safe}_${party || "SSDiagnostics"}.pdf`);
      showToast("PDF downloaded", "ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate PDF";
      showToast(msg, "err");
    } finally {
      node.style.display = prev.display;
      node.style.position = prev.position;
      node.style.left = prev.left;
      node.style.top = prev.top;
      node.style.width = prev.width;
      setPdfBusy(false);
    }
  }

  function handlePrint() {
    if (!invoiceId || !challanNumber || loadingInvoice) {
      showToast("Select an invoice first", "err");
      return;
    }
    window.print();
  }

  const canPrint = Boolean(invoiceId && challanNumber) && !loadingInvoice;

  return (
    <>
      <div className="no-print max-w-5xl animate-fade-in">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-extrabold flex items-center gap-2" style={{ color: "var(--gray-900)" }}>
              <ClipboardList size={24} className="shrink-0" style={{ color: "var(--blue-deeper)" }} />
              Delivery challan
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>
              Select an invoice to build a delivery challan (layout aligned with{" "}
              <a href="/delivery_chalan.pdf" target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: "var(--blue-deeper)" }}>
                sample PDF
              </a>
              ). Print or download PDF — does not change accounts or stock.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-5 mb-5" style={{ boxShadow: "var(--shadow-sm)" }}>
          <label className="flex flex-col gap-1.5 max-w-xl mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
              Search by invoice number
            </span>
            <input
              type="search"
              value={invoiceSearch}
              onChange={(e) => { setInvoiceSearch(e.target.value); setLoadingList(true); }}
              placeholder="Enter full or partial invoice number"
              aria-describedby="invoice-search-status"
              className="border-[1.5px] rounded-[9px] px-3 py-2.5 text-[13px] outline-none"
              style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
            />
          </label>
          <p id="invoice-search-status" role="status" className="text-xs mb-3" style={{ color: "var(--gray-600)" }}>
            {loadingList ? "Searching invoices…" : listError ? `Could not load invoices: ${listError}` : invoices.length === 0
              ? "No invoices found. Try another invoice number."
              : invoices.length === 300 ? "Showing the latest 300 matches. Enter more of the invoice number to narrow the results."
              : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} found. Select one below.`}
          </p>
          <label className="flex flex-col gap-1.5 max-w-xl">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
              Invoice
            </span>
            <select
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              disabled={loadingList}
              className="border-[1.5px] rounded-[9px] px-3 py-2.5 text-[13px] outline-none cursor-pointer"
              style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
            >
              <option value="">— Select invoice —</option>
              {selectedInvoice && selectedInvoice.id === invoiceId && !invoices.some(inv => inv.id === invoiceId) && (
                <option value={selectedInvoice.id}>
                  {selectedInvoice.invoice_number} — {selectedInvoice.client_name} (selected)
                </option>
              )}
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number} — {inv.client_name} ({formatDate(inv.invoice_date)})
                </option>
              ))}
            </select>
          </label>
          {loadingInvoice && (
            <p className="text-[12px] mt-2 flex items-center gap-2" style={{ color: "var(--gray-600)" }}>
              <Loader2 size={14} className="animate-spin" /> Loading line items…
            </p>
          )}
        </div>

        {invoiceId && !loadingInvoice && (
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-5 mb-5" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h2 className="text-sm font-bold mb-3" style={{ color: "var(--gray-900)" }}>Products to deliver</h2>
            {printRows.length ? (
              <table className="w-full text-[13px] border-collapse">
                <thead><tr style={{ color: "var(--blue-deeper)" }}>
                  <th scope="col" className="text-left p-2 border-b border-[var(--gray-100)]">Product</th>
                  <th scope="col" className="text-center p-2 border-b border-[var(--gray-100)]">Qty</th>
                </tr></thead>
                <tbody>{printRows.map(row => (
                  <tr key={row.id}>
                    <td className="p-2 border-b border-[var(--gray-100)] whitespace-pre-wrap break-words">{row.detail}</td>
                    <td className="p-2 border-b border-[var(--gray-100)] text-center tabular-nums align-top">{row.qty}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p className="text-[13px]" style={{ color: "var(--gray-800)" }}>No products on this invoice.</p>}
          </div>
        )}

        {invoiceId ? (
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-5 space-y-4 mb-5" style={{ boxShadow: "var(--shadow-sm)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--gray-800)" }}>
              Edit challan header (optional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="text-sm font-bold sm:col-span-2" role="status">Challan No: {challanNumber || (loadingInvoice ? "Assigning…" : "Unavailable")}</div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                  Party / consignee
                </span>
                <input
                  value={headerParty}
                  onChange={(e) => setHeaderParty(e.target.value)}
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                  style={{ borderColor: "var(--gray-200)" }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                    Date
                  </span>
                  <input
                    type="date"
                    value={challanDate}
                    onChange={(e) => setChallanDate(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: "var(--gray-200)" }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                    Time
                  </span>
                  <input
                    value={challanTime}
                    onChange={(e) => setChallanTime(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: "var(--gray-200)" }}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                  Cell
                </span>
                <input
                  value={cell}
                  onChange={(e) => setCell(e.target.value)}
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                  style={{ borderColor: "var(--gray-200)" }}
                />
              </label>

            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                Terms &amp; conditions
              </span>
              <textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={3}
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none resize-y"
                style={{ borderColor: "var(--gray-200)" }}
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={handlePrint}
                disabled={!canPrint}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold border-[1.5px] cursor-pointer bg-white disabled:opacity-45"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
              >
                <Printer size={18} />
                Print
              </button>
              <button
                type="button"
                onClick={() => void downloadPdf()}
                disabled={!canPrint || pdfBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold border-none cursor-pointer text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}
              >
                <Download size={18} />
                {pdfBusy ? "Preparing…" : "Download PDF"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Print / PDF template — matches quotation / sample delivery_chalan layout */}
      <div
        ref={docRef}
        className="delivery-challan-doc print-only bg-white"
        style={{
          width: "148mm",
          maxWidth: "100%",
          padding: "6mm",
          boxSizing: "border-box",
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#111",
          fontSize: 11,
          lineHeight: 1.35,
        }}
      >
        <PrintHeader variant="challan" />

        {/* Title bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: "#0369a1", color: "#fff", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase" }}>Delivery Challan</span>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{challanNumber}</span>
          {invoiceRef ? <span style={{ fontSize: 11, fontWeight: 700 }}>Ref: {invoiceRef}</span> : null}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 10,
            gap: 16,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.5, textTransform: "uppercase", maxWidth: "58%" }}>
            {headerParty || "\u00A0"}
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700 }}>Date</span>
              <span>{displayDate}</span>
              <span style={{ color: "#000" }}>{challanTime || "\u00A0"}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            fontSize: 11,
          }}
        >
          <div>
            <span style={{ fontWeight: 700 }}>Cell</span>
            <span style={{ marginLeft: 8 }}>{cell || "\u00A0"}</span>
          </div>

        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #000",
            fontSize: 10,
            marginBottom: 12,
          }}
        >
          <thead><tr>{["S.#", "Product", "Qty"].map((label, index) => (
            <th key={label} style={{ border: "1px solid #000", padding: "6px", fontWeight: 700,
              textAlign: index === 1 ? "left" : "center", width: index === 1 ? "76%" : "12%" }}>{label}</th>
          ))}</tr></thead>
          <tbody>
            {rowsForPdf.map((r, idx) => (
              <tr key={r.id}>
                <td style={{ border: "1px solid #000", padding: "5px 4px", textAlign: "center", fontFamily: "monospace" }}>{idx + 1}</td>
                <td style={{ border: "1px solid #000", padding: "5px 6px", verticalAlign: "top" }}>{r.detail || "\u00A0"}</td>

                <td style={{ border: "1px solid #000", padding: "5px 3px", textAlign: "center", fontFamily: "monospace" }}>{r.qty || "\u00A0"}</td>

              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 11, textDecoration: "underline" }}>Terms &amp; Conditions</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 10, color: "#222", lineHeight: 1.45 }}>{terms || "\u00A0"}</div>
        </div>

        {/* Footer image */}
        <PrintFooter style={{ marginTop: 16 }} />
      </div>
    </>
  );
}
