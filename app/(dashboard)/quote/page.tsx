"use client";

import { invoiceUnitRate, invoiceLineTotal } from "@/lib/invoicePricing";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Download, FilePlus2, FileStack, FileText, Loader2, Package, Pencil, Plus, Printer, Save, Trash2, X } from "lucide-react";

import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintHeader } from "@/components/PrintHeader";
import type { InvoiceItem, Quotation } from "@/lib/database.types";
import { useUser } from "@/lib/UserContext";
import { SearchableSelect } from "@/components/SearchableSelect";
import { confirmDialog } from "@/components/ConfirmModal";
import { logActivity } from "@/lib/activityLog";

type FlowPhase = "choose" | "edit";
type SourceKind = "new" | "invoice";

interface LineItem {
  id: string;
  product: string;
  description: string;
  width: number;
  height: number;
  sqft: number;
  rate: number;
  qty: number;
  total: number;
}

interface QuotePrintRow {
  id: string;
  detail: string;
  qty: string;
  rate: string;
  amount: string;
}

function blankLine(): LineItem {
  return {
    id: crypto.randomUUID(),
    product: "",
    description: "",
    width: 0,
    height: 0,
    sqft: 0,
    rate: 0,
    qty: 1,
    total: 0,
  };
}

function calcLine(item: LineItem): LineItem {
  return { ...item, width: 0, height: 0, sqft: 0, total: invoiceLineTotal(item.rate, item.qty) };
}

function formatQuoteDate(iso: string): string {
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

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function lineItemsToPrintRows(items: LineItem[]): QuotePrintRow[] {
  return items.map((it) => {
    const detail = [it.product, it.description].filter(Boolean).join(" — ");
    return {
      id: it.id,
      detail,
      qty: String(it.qty || 1),
      rate: it.rate ? String(it.rate) : "",
      amount: it.total > 0 ? String(Math.round(it.total)) : "",
    };
  });
}

type InvoicePick = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_phone: string;
  invoice_date: string;
  grand_total: number;
};

export default function QuotePage() {
  const userProfile = useUser();
  const docRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>("choose");
  const [sourceKind, setSourceKind] = useState<SourceKind>("new");
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteNumber, setQuoteNumber] = useState("");
  const [sourceInvoiceId, setSourceInvoiceId] = useState<string | null>(null);
  const [invoicePickId, setInvoicePickId] = useState("");
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  const [partyName, setPartyName] = useState("");
  const [quoteDate, setQuoteDate] = useState(todayISO());
  const [quoteTime, setQuoteTime] = useState(nowTimeStr);
  const [cell, setCell] = useState("");
  const [delNo, setDelNo] = useState("");
  const [terms, setTerms] = useState(
    "Prices valid for 15 days from quotation date. Payment terms as agreed. Delivery subject to production schedule."
  );
  const [recvName, setRecvName] = useState("");
  const [recvDate, setRecvDate] = useState("");
  const [deliverName, setDeliverName] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const [quoteProducts, setQuoteProducts] = useState<{ id: string; name: string; sale_price: number }[]>([]);
  const [invoices, setInvoices] = useState<InvoicePick[]>([]);
  const [savedQuotes, setSavedQuotes] = useState<Quotation[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // List action states
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const [printingQuoteId, setPrintingQuoteId] = useState<string | null>(null);

  // Quote products management modal
  const [showQuoteProdsModal, setShowQuoteProdsModal] = useState(false);
  const [quoteProdsLoading, setQuoteProdsLoading] = useState(false);
  const [newQProdName, setNewQProdName] = useState("");
  const [newQProdPrice, setNewQProdPrice] = useState("");
  const [addingQProd, setAddingQProd] = useState(false);

  const refreshQuoteNumber = useCallback(async () => {
    const { data, error } = await db.from("quotations").select("quote_number").order("created_at", { ascending: false }).limit(150);
    if (error) {
      setQuoteNumber("Q-SSD001");
      return;
    }
    let max = 0;
    for (const r of data ?? []) {
      // Include historical quotation prefixes so numbering continues across renames.
      const m = String((r as { quote_number: string }).quote_number).match(/^Q-[A-Z]+(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    setQuoteNumber(`Q-SSD${String(max + 1).padStart(3, "0")}`);
  }, []);

  const fetchProductsAndInvoices = useCallback(async () => {
    const [{ data: p }, { data: inv }] = await Promise.all([
      db.from("products").select("id, name, sale_price").order("name"),
      db
        .from("invoices")
        .select("id, invoice_number, client_name, client_phone, invoice_date, grand_total")
        .order("created_at", { ascending: false })
        .limit(250),
    ]);
    const { data: qp, error: qpErr } = await db.from("quotation_products").select("id, name, sale_price").order("name");
    if (!qpErr && qp) setQuoteProducts(qp as { id: string; name: string; sale_price: number }[]);
    else setQuoteProducts((p as { id: string; name: string; sale_price: number }[]) ?? []);
    if (inv) setInvoices(inv as InvoicePick[]);
  }, []);

  const fetchSavedQuotations = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await db.from("quotations").select("*").order("created_at", { ascending: false }).limit(100);
    setLoadingList(false);
    if (error) {
      setSavedQuotes([]);
      return;
    }
    setSavedQuotes((data ?? []) as Quotation[]);
  }, []);

  useEffect(() => {
    void fetchProductsAndInvoices();
    void fetchSavedQuotations();
  }, [fetchProductsAndInvoices, fetchSavedQuotations]);

  // Refresh product list whenever the modal opens
  useEffect(() => {
    if (!showQuoteProdsModal) { setNewQProdName(""); setNewQProdPrice(""); return; }
    setQuoteProdsLoading(true);
    db
      .from("quotation_products")
      .select("id, name, sale_price")
      .order("name")
      .then(({ data }) => {
        if (data) setQuoteProducts(data as { id: string; name: string; sale_price: number }[]);
        setQuoteProdsLoading(false);
      });
  }, [showQuoteProdsModal]);

  async function addQuoteProduct() {
    if (!newQProdName.trim()) return;
    setAddingQProd(true);
    const price = parseFloat(newQProdPrice) || 0;
    const { data, error } = await db
      .from("quotation_products")
      .insert({ name: newQProdName.trim(), sale_price: price })
      .select()
      .single();
    setAddingQProd(false);
    if (error) { showToast(error.message, "err"); return; }
    setQuoteProducts((prev) =>
      [...prev, data as { id: string; name: string; sale_price: number }].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    );
    setNewQProdName("");
    setNewQProdPrice("");
  }

  async function removeQuoteProduct(id: string) {
    const { error } = await db.from("quotation_products").delete().eq("id", id);
    if (error) { showToast(error.message, "err"); return; }
    setQuoteProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function resetEditorForNew() {
    setEditingQuoteId(null);
    setSourceInvoiceId(null);
    setPartyName("");
    setQuoteDate(todayISO());
    setQuoteTime(nowTimeStr());
    setCell("");
    setDelNo("");
    setRecvName("");
    setRecvDate("");
    setDeliverName("");
    setLineItems([blankLine()]);
    void refreshQuoteNumber();
  }

  function startNewQuotation() {
    setSourceKind("new");
    setPhase("edit");
    resetEditorForNew();
  }

  function startFromInvoicePath() {
    setSourceKind("invoice");
    setPhase("edit");
    resetEditorForNew();
    setInvoicePickId("");
  }

  function backToChoose() {
    if (phase !== "edit") return;
    if (partyName.trim() || lineItems.some((l) => l.product || l.total > 0)) {
      if (!confirm("Discard this quotation draft and go back?")) return;
    }
    setPhase("choose");
    setLineItems([]);
    setEditingQuoteId(null);
    setSourceInvoiceId(null);
    void fetchSavedQuotations();
  }

  async function loadInvoiceIntoQuote() {
    if (!invoicePickId) {
      showToast("Select an invoice first", "err");
      return;
    }
    setLoadingInvoice(true);
    try {
      const { data: inv, error: e1 } = await db.from("invoices").select("*").eq("id", invoicePickId).single();
      if (e1 || !inv) {
        showToast(e1?.message || "Invoice not found", "err");
        return;
      }
      const { data: items, error: e2 } = await db
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoicePickId)
        .order("id", { ascending: true });
      if (e2) {
        showToast(e2.message, "err");
        return;
      }
      setSourceInvoiceId(invoicePickId);
      setPartyName(String(inv.client_name ?? ""));
      setCell(String(inv.client_phone ?? ""));
      setQuoteDate(String(inv.invoice_date ?? todayISO()));
      const mapped: LineItem[] =
        (items as InvoiceItem[]).length > 0
          ? (items as InvoiceItem[]).map((it) =>
              calcLine({
                id: crypto.randomUUID(),
                product: String(it.category ?? ""),
                description: String(it.description ?? ""),
                width: 0,
                height: 0,
                sqft: 0,
                rate: invoiceUnitRate(it),
                qty: Number(it.qty) || 1,
                total: Number(it.amount),
              })
            )
          : [blankLine()];
      setLineItems(mapped);
      showToast(`Loaded lines from ${inv.invoice_number}`, "ok");
    } finally {
      setLoadingInvoice(false);
    }
  }

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLineItems((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return calcLine({ ...row, ...patch });
      })
    );
  }

  function onProductSelect(index: number, name: string) {
    const p = quoteProducts.find((x) => x.name === name);
    setLineItems((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, product: name };
        if (p && p.sale_price > 0) next.rate = p.sale_price;
        return calcLine(next);
      })
    );
  }

  const printRows = useMemo(() => lineItemsToPrintRows(lineItems), [lineItems]);
  const grandTotal = useMemo(() => lineItems.reduce((s, l) => s + l.total, 0), [lineItems]);

  async function saveQuotation() {
    if (!partyName.trim()) {
      showToast("Party / client name is required", "err");
      return;
    }
    const hasLine = lineItems.some((l) => l.product.trim() && l.total > 0);
    if (!hasLine) {
      showToast("Add at least one product line with an amount", "err");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        quote_number: quoteNumber,
        party_name: partyName.trim(),
        quote_date: quoteDate,
        quote_time: quoteTime,
        cell: cell.trim(),
        del_no: delNo.trim(),
        terms,
        recv_name: recvName.trim(),
        recv_date: recvDate.trim(),
        deliver_name: deliverName.trim(),
        source_invoice_id: sourceInvoiceId,
        grand_total: grandTotal,
      };

      if (editingQuoteId) {
        const { error: uErr } = await db.from("quotations").update(payload).eq("id", editingQuoteId);
        if (uErr) {
          showToast(uErr.message, "err");
          return;
        }
        await db.from("quotation_items").delete().eq("quotation_id", editingQuoteId);
        const { error: iErr } = await db.from("quotation_items").insert(
          lineItems.map((l) => ({
            quotation_id: editingQuoteId,
            product: l.product,
            description: l.description,
            width: l.width,
            height: l.height,
            sqft: l.sqft,
            rate: l.rate,
            qty: l.qty,
            amount: l.total,
          }))
        );
        if (iErr) {
          showToast(iErr.message, "err");
          return;
        }
        showToast("Quotation updated", "ok");
      } else {
        const { data: row, error: insErr } = await db.from("quotations").insert(payload).select("id").single();
        if (insErr || !row) {
          showToast(insErr?.message ?? "Could not save (run quotations SQL migration?)", "err");
          return;
        }
        const qid = (row as { id: string }).id;
        const { error: iErr } = await db.from("quotation_items").insert(
          lineItems.map((l) => ({
            quotation_id: qid,
            product: l.product,
            description: l.description,
            width: l.width,
            height: l.height,
            sqft: l.sqft,
            rate: l.rate,
            qty: l.qty,
            amount: l.total,
          }))
        );
        if (iErr) {
          showToast(iErr.message, "err");
          await db.from("quotations").delete().eq("id", qid);
          return;
        }
        setEditingQuoteId(qid);
        showToast("Quotation saved (not posted to cashbook)", "ok");
      }
      void fetchSavedQuotations();
    } finally {
      setSaving(false);
    }
  }

  async function loadSavedQuotation(id: string) {
    const { data: q, error: e1 } = await db.from("quotations").select("*").eq("id", id).single();
    if (e1 || !q) {
      showToast(e1?.message || "Not found", "err");
      return;
    }
    const { data: items, error: e2 } = await db
      .from("quotation_items")
      .select("*")
      .eq("quotation_id", id)
      .order("id", { ascending: true });
    if (e2) {
      showToast(e2.message, "err");
      return;
    }
    const qq = q as Quotation;
    setPhase("edit");
    setSourceKind(qq.source_invoice_id ? "invoice" : "new");
    setEditingQuoteId(qq.id);
    setQuoteNumber(qq.quote_number);
    setPartyName(qq.party_name);
    setQuoteDate(qq.quote_date);
    setQuoteTime(qq.quote_time || nowTimeStr());
    setCell(qq.cell);
    setDelNo(qq.del_no);
    setTerms(qq.terms ?? "");
    setRecvName(qq.recv_name);
    setRecvDate(qq.recv_date);
    setDeliverName(qq.deliver_name);
    setSourceInvoiceId(qq.source_invoice_id);
    setLineItems(
      (items ?? []).length
        ? (items as Record<string, unknown>[]).map((it) =>
            calcLine({
              id: crypto.randomUUID(),
              product: String(it.product ?? ""),
              description: String(it.description ?? ""),
              width: 0,
              height: 0,
              sqft: 0,
              rate: invoiceUnitRate(it),
              qty: Number(it.qty) || 1,
              total: Number(it.amount),
            })
          )
        : [blankLine()]
    );
    showToast("Quotation loaded", "ok");
  }

  async function deleteQuotation(id: string) {
    const quote = savedQuotes.find((q) => q.id === id);
    const ok = await confirmDialog({
      title: "Delete quotation?",
      message: quote
        ? `Delete quotation ${quote.quote_number} (${quote.party_name || "—"})? This cannot be undone.`
        : "Delete this quotation? This cannot be undone.",
      details: "All line items on this quotation will also be removed.",
      tone: "danger",
    });
    if (!ok) return;
    setDeletingQuoteId(id);
    const { error } = await db.from("quotations").delete().eq("id", id);
    setDeletingQuoteId(null);
    if (error) { showToast(error.message, "err"); return; }
    if (quote) {
      await logActivity({
        action: "delete",
        entityType: "quotation",
        entityId: id,
        title: "Quotation Deleted",
        subtitle: `${quote.quote_number} — ${quote.party_name || "—"}`,
        amount: Number(quote.grand_total ?? 0) || null,
      });
    }
    showToast("Quotation deleted", "ok");
    setSavedQuotes((prev) => prev.filter((q) => q.id !== id));
  }

  async function printFromList(q: Quotation) {
    if (printingQuoteId) return;
    setPrintingQuoteId(q.id);
    try {
      const { data: items, error } = await db
        .from("quotation_items")
        .select("*")
        .eq("quotation_id", q.id)
        .order("id", { ascending: true });
      if (error) { showToast(error.message, "err"); return; }
      // Populate print-template state without navigating to edit phase
      setQuoteNumber(q.quote_number);
      setPartyName(q.party_name);
      setQuoteDate(q.quote_date);
      setQuoteTime(q.quote_time || nowTimeStr());
      setCell(q.cell);
      setDelNo(q.del_no);
      setTerms(q.terms ?? "");
      setRecvName(q.recv_name);
      setRecvDate(q.recv_date);
      setDeliverName(q.deliver_name);
      setLineItems(
        (items ?? []).length
          ? (items as Record<string, unknown>[]).map((it) =>
              calcLine({
                id: crypto.randomUUID(),
                product: String(it.product ?? ""),
                description: String(it.description ?? ""),
                width: 0,
                height: 0,
                sqft: 0,
                rate: invoiceUnitRate(it),
                qty: Number(it.qty) || 1,
                total: Number(it.amount),
              })
            )
          : [blankLine()]
      );
      // Give React one frame to re-render the print template, then print
      await new Promise((r) => setTimeout(r, 200));
      window.print();
    } finally {
      setPrintingQuoteId(null);
    }
  }


  async function downloadPdf() {
    const node = docRef.current;
    if (!node || pdfBusy) return;
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
    node.style.width = "210mm";

    try {
      await new Promise((r) => setTimeout(r, 200));
      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
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
      const safeDel = (delNo || quoteNumber).replace(/[^\w.-]+/g, "_");
      const safeParty = (partyName || "Client").slice(0, 40).replace(/[^\w\s.-]+/g, "").replace(/\s+/g, "_");
      pdf.save(`Quotation_${safeDel}_${safeParty || "SSDiagnostics"}.pdf`);
    } finally {
      node.style.display = prev.display;
      node.style.position = prev.position;
      node.style.left = prev.left;
      node.style.top = prev.top;
      node.style.width = prev.width;
      setPdfBusy(false);
    }
  }

  const displayDate = formatQuoteDate(quoteDate);
  const rowsForPdf = printRows.length ? printRows : [{ id: "e", detail: "", qty: "", rate: "", amount: "" }];

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <div className="no-print mb-6 max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>
              Quotation
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>
              Quotations are saved separately — they do not affect cashbook, invoices, or party balances.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowQuoteProdsModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-[1.5px] text-[12.5px] font-semibold cursor-pointer"
              style={{ borderColor: "var(--purple)", background: "white", color: "var(--purple)" }}
            >
              <Package size={14} /> Quote Products
            </button>
            {phase === "edit" && (
              <button
                type="button"
                onClick={backToChoose}
                className="text-[12px] font-semibold px-3 py-2 rounded-[8px] border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
              >
                Change source…
              </button>
            )}
          </div>
        </div>

        {phase === "choose" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <button
                type="button"
                onClick={startNewQuotation}
                className="text-left rounded-[16px] border-[1.5px] p-6 transition-all hover:shadow-[var(--shadow)] hover:-translate-y-0.5 cursor-pointer"
                style={{ borderColor: "var(--gray-200)", background: "white", boxShadow: "var(--shadow-sm)" }}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}>
                  <FilePlus2 size={26} />
                </div>
                <div className="text-[16px] font-extrabold" style={{ color: "var(--gray-900)" }}>
                  New quotation
                </div>
                <p className="text-[12px] mt-2 leading-snug" style={{ color: "var(--gray-800)" }}>
                  Build a quote with products, width &amp; height — same as creating an invoice line sheet, without posting to accounts.
                </p>
              </button>
              <button
                type="button"
                onClick={startFromInvoicePath}
                className="text-left rounded-[16px] border-[1.5px] p-6 transition-all hover:shadow-[var(--shadow)] hover:-translate-y-0.5 cursor-pointer"
                style={{ borderColor: "var(--gray-200)", background: "white", boxShadow: "var(--shadow-sm)" }}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "var(--blue-light)", color: "var(--blue)" }}>
                  <FileStack size={26} />
                </div>
                <div className="text-[16px] font-extrabold" style={{ color: "var(--gray-900)" }}>
                  Use an old invoice
                </div>
                <p className="text-[12px] mt-2 leading-snug" style={{ color: "var(--gray-800)" }}>
                  Copy line items from an existing invoice as a starting point. You can edit before saving; nothing is re-posted to the ledger.
                </p>
              </button>
            </div>

            <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden mb-8" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="px-4 py-3 border-b border-[var(--gray-100)] bg-[var(--gray-50)]">
                <h2 className="text-[14px] font-extrabold m-0" style={{ color: "var(--gray-900)" }}>Saved quotations</h2>
                <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--gray-600)" }}>
                  Latest 100 saved quotes. Open one to edit, print, or download PDF.
                </p>
              </div>
              {loadingList ? (
                <div className="px-4 py-10 text-center text-[13px]" style={{ color: "var(--gray-600)" }}>
                  <Loader2 size={20} className="inline animate-spin mr-2 align-middle" />
                  Loading quotations…
                </div>
              ) : savedQuotes.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <FileText size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
                  <p className="text-[13px] m-0 font-medium" style={{ color: "var(--gray-700)" }}>No saved quotations yet.</p>
                  <p className="text-[12px] m-0 mt-1" style={{ color: "var(--gray-600)" }}>Create one using the cards above.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`${DT.table} min-w-[640px]`}>
                    <thead>
                      <tr>
                        {["#", "Quote #", "Party", "Date", "Total", "Actions"].map((h) => (
                          <th
                            key={h}
                            className={`${DT.thDense} ${h === "Total" || h === "Actions" ? "text-right" : "text-left"}`}
                            style={DT.thStyle}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {savedQuotes.map((q, idx) => (
                        <tr key={q.id} className={DT.row}>
                          <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-600)" }}>
                            {idx + 1}
                          </td>
                          <td className={DT.tdDense}>
                            <span className="font-mono text-[11px] font-extrabold" style={{ color: "var(--blue-deeper)" }}>
                              {q.quote_number}
                            </span>
                          </td>
                          <td className={`${DT.tdDense} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>
                            {q.party_name || "—"}
                          </td>
                          <td className={`${DT.tdDense} ${DT.cellBody} whitespace-nowrap`} style={{ color: "var(--gray-800)" }}>
                            {formatDate(q.quote_date)}
                          </td>
                          <td className={`${DT.tdDense} font-mono text-right font-bold text-[14px]`} style={{ color: "var(--blue-deeper)" }}>
                            {formatCurrency(Number(q.grand_total))}
                          </td>
                          <td className={`${DT.tdDense} text-right`}>
                            <div className="inline-flex gap-1 justify-end">
                              {/* Edit */}
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => void loadSavedQuotation(q.id)}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--blue-pale)]"
                                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                              >
                                <Pencil size={13} />
                              </button>
                              {/* Print */}
                              <button
                                type="button"
                                title="Print"
                                onClick={() => void printFromList(q)}
                                disabled={printingQuoteId !== null}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--gray-50)] disabled:opacity-40"
                                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                              >
                                {printingQuoteId === q.id
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <Printer size={13} />}
                              </button>


                              {/* Delete */}
                              {userProfile?.isAdmin && (
                                <button
                                  type="button"
                                  title="Delete"
                                  onClick={() => void deleteQuotation(q.id)}
                                  disabled={deletingQuoteId === q.id}
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--red-light)] disabled:opacity-40"
                                  style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}
                                >
                                  {deletingQuoteId === q.id
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <Trash2 size={13} />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {phase === "edit" && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => void saveQuotation()}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold border-none cursor-pointer text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--blue), #0277b5)" }}
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {editingQuoteId ? "Update save" : "Save quotation"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editingQuoteId && !confirm("Start a brand-new quotation number? Unsaved changes on this screen may be lost.")) return;
                  startNewQuotation();
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
              >
                New blank
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
              >
                <Printer size={18} />
                Print
              </button>
              <button
                type="button"
                onClick={() => void downloadPdf()}
                disabled={pdfBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-bold border-none cursor-pointer text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}
              >
                <Download size={18} />
                {pdfBusy ? "Preparing…" : "Download PDF"}
              </button>
            </div>

            {sourceKind === "invoice" && (
              <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 mb-4 flex flex-wrap gap-3 items-end" style={{ boxShadow: "var(--shadow-sm)" }}>
                <label className="flex flex-col gap-1 min-w-[240px] flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                    Invoice to copy from
                  </span>
                  <select
                    value={invoicePickId}
                    onChange={(e) => setInvoicePickId(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none cursor-pointer"
                    style={{ borderColor: "var(--gray-200)" }}
                  >
                    <option value="">— Select invoice —</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} — {inv.client_name} ({formatDate(inv.invoice_date)}) — {formatCurrency(Number(inv.grand_total))}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void loadInvoiceIntoQuote()}
                  disabled={loadingInvoice || !invoicePickId}
                  className="px-4 py-2.5 rounded-[9px] text-[12.5px] font-bold border-none cursor-pointer text-white disabled:opacity-45"
                  style={{ background: "var(--blue-deeper)" }}
                >
                  {loadingInvoice ? "Loading…" : "Load invoice lines"}
                </button>
              </div>
            )}

            <div className="bg-[var(--gray-50)] rounded-[12px] border border-[var(--gray-100)] p-3 mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--gray-800)" }}>
                Saved quotations
              </div>
              {loadingList ? (
                <span className="text-[12px]" style={{ color: "var(--gray-600)" }}>
                  Loading…
                </span>
              ) : savedQuotes.length === 0 ? (
                <span className="text-[12px]" style={{ color: "var(--gray-600)" }}>
                  None yet — save one to see it here.
                </span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {savedQuotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => void loadSavedQuotation(q.id)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-[8px] border-[1.5px] cursor-pointer bg-white"
                      style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                    >
                      {q.quote_number} · {q.party_name.slice(0, 24)}
                      {q.party_name.length > 24 ? "…" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-5 space-y-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-lg" style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}>
                  {quoteNumber}
                </span>
                {sourceInvoiceId && (
                  <span className="text-[10px] font-semibold" style={{ color: "var(--gray-600)" }}>
                    Template from invoice (quotation only)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                    Party / Client name <span style={{ color: "var(--red)" }}>*</span>
                  </span>
                  <input
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: "var(--gray-200)" }}
                    placeholder="Client / company"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                      Date
                    </span>
                    <input
                      type="date"
                      value={quoteDate}
                      onChange={(e) => setQuoteDate(e.target.value)}
                      className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                      style={{ borderColor: "var(--gray-200)" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                      Time
                    </span>
                    <input
                      value={quoteTime}
                      onChange={(e) => setQuoteTime(e.target.value)}
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
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                    Del No
                  </span>
                  <input
                    value={delNo}
                    onChange={(e) => setDelNo(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                    style={{ borderColor: "var(--gray-200)" }}
                  />
                </label>
              </div>

              <div className="border-t border-[var(--gray-100)] pt-4">
                <div className="rounded-[10px] border border-[var(--gray-100)] overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: 640 }}>
                    <thead>
                      <tr>
                        {["Product", "Description", "Rate", "Qty", "Total", ""].map((h) => (
                          <th key={h} className={`${DT.thDense} text-left`} style={DT.thStyle}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-[var(--blue-pale)] transition-colors">
                          <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ minWidth: 140 }}>
                            <SearchableSelect
                              value={item.product}
                              onChange={(v) => onProductSelect(idx, v)}
                              options={quoteProducts.map((p) => ({ value: p.name, label: p.name }))}
                              placeholder="— Product —"
                              inputClassName="border border-[var(--gray-200)] rounded-[6px] px-2 py-1.5 text-[12px] outline-none bg-white w-full"
                            />
                          </td>
                          <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ minWidth: 120 }}>
                            <input
                              value={item.description}
                              onChange={(e) => updateLine(idx, { description: e.target.value })}
                              placeholder="Specs"
                              className="border border-[var(--gray-200)] rounded-[6px] px-2 py-1.5 text-[12px] outline-none w-full"
                            />
                          </td>

                          <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 92 }}>
                            <input
                              type="number"
                              min={0}
                              value={item.rate || ""}
                              onChange={(e) => updateLine(idx, { rate: parseFloat(e.target.value) || 0 })}
                              className="border-2 border-[var(--gray-200)] rounded-[7px] px-2 py-2 text-[15px] font-bold outline-none w-full text-right"
                            />
                          </td>
                          <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 64 }}>
                            <input
                              type="number"
                              min={1}
                              value={item.qty}
                              onChange={(e) => updateLine(idx, { qty: parseInt(e.target.value, 10) || 1 })}
                              className="border-2 border-[var(--gray-200)] rounded-[7px] px-2 py-2 text-[15px] font-bold outline-none w-full text-center"
                            />
                          </td>
                          <td
                            className="px-2 py-2 border-b border-[var(--gray-100)] font-mono font-extrabold text-right whitespace-nowrap text-[14px]"
                            style={{ color: "var(--blue-deeper)", width: 100 }}
                          >
                            {item.total > 0 ? formatCurrency(item.total) : "—"}
                          </td>
                          <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 40 }}>
                            {lineItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="w-7 h-7 rounded-[6px] flex items-center justify-center border-none cursor-pointer"
                                style={{ background: "var(--red-light)", color: "var(--red)" }}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => setLineItems((prev) => [...prev, blankLine()])}
                  className="mt-3 text-[12px] font-bold px-3 py-2 rounded-[8px] border-none cursor-pointer"
                  style={{ background: "var(--blue-light)", color: "var(--blue)" }}
                >
                  + Add row
                </button>
                <div className="text-right text-[14px] font-extrabold mt-2 font-mono" style={{ color: "var(--blue-deeper)" }}>
                  Grand total {formatCurrency(grandTotal)}
                </div>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--blue-deeper)" }}>
                  Terms &amp; conditions
                </span>
                <textarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={4}
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none resize-y"
                  style={{ borderColor: "var(--gray-200)" }}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-bold" style={{ color: "var(--gray-900)" }}>
                    Received By
                  </div>
                  <input
                    value={recvName}
                    onChange={(e) => setRecvName(e.target.value)}
                    placeholder="Name"
                    className="w-full border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: "var(--gray-200)" }}
                  />
                  <input
                    value={recvDate}
                    onChange={(e) => setRecvDate(e.target.value)}
                    placeholder="Date"
                    className="w-full border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: "var(--gray-200)" }}
                  />
                  <div className="text-[11px] pt-2" style={{ color: "var(--gray-600)" }}>
                    Signature &amp; Stamp
                  </div>
                  <div className="h-14 border-b-2 border-dashed" style={{ borderColor: "var(--gray-300)" }} />
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-bold" style={{ color: "var(--gray-900)" }}>
                    Delivered By
                  </div>
                  <input
                    value={deliverName}
                    onChange={(e) => setDeliverName(e.target.value)}
                    placeholder="Name"
                    className="w-full border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: "var(--gray-200)" }}
                  />
                  <div className="text-[11px] pt-6" style={{ color: "var(--gray-600)" }}>
                    Authorised Sign
                  </div>
                  <div className="h-14 border-b-2 border-dashed" style={{ borderColor: "var(--gray-300)" }} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Hidden on screen — used only for Print + PDF (html2canvas sets display briefly) */}
      <div
        ref={docRef}
        className="quote-doc-print print-only bg-white"
        style={{
          width: "210mm",
          maxWidth: "100%",
          padding: "10mm 12mm 12mm",
          boxSizing: "border-box",
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#111",
          fontSize: 11,
          lineHeight: 1.35,
        }}
      >
        <PrintHeader />

        {/* Title bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", background: "#0369a1", color: "#fff", marginBottom: 10, paddingLeft: 8, paddingRight: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase" }}>Quotation</span>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12 }}>Quote # {quoteNumber}</span>
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
            {partyName || "\u00A0"}
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700 }}>Date</span>
              <span>{displayDate}</span>
              <span style={{ color: "#000" }}>{quoteTime || "\u00A0"}</span>
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
          <div>
            <span style={{ fontWeight: 700 }}>Del No :</span>
            <span style={{ marginLeft: 8, fontFamily: "monospace", fontWeight: 700 }}>{delNo || "\u00A0"}</span>
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
          <thead><tr>{["S.#", "Detail", "Qty", "Rate", "Amount"].map((label, index) => (
            <th key={label} style={{ border: "1px solid #000", padding: "6px", fontWeight: 700,
              textAlign: index === 1 ? "left" : "center", width: index === 1 ? "52%" : "12%" }}>{label}</th>
          ))}</tr></thead>
          <tbody>
            {rowsForPdf.map((r, idx) => (
              <tr key={r.id}>
                <td style={{ border: "1px solid #000", padding: "5px 4px", textAlign: "center", fontFamily: "monospace" }}>{idx + 1}</td>
                <td style={{ border: "1px solid #000", padding: "5px 6px", verticalAlign: "top" }}>{r.detail || "\u00A0"}</td>

                <td style={{ border: "1px solid #000", padding: "5px 3px", textAlign: "center", fontFamily: "monospace" }}>{r.qty || "\u00A0"}</td>

                <td style={{ border: "1px solid #000", padding: "5px 4px", textAlign: "right", fontFamily: "monospace" }}>
                  {r.rate ? formatCurrency(parseNum(r.rate)).replace("Rs ", "") : "\u00A0"}
                </td>
                <td style={{ border: "1px solid #000", padding: "5px 4px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                  {r.amount ? formatCurrency(parseNum(r.amount)).replace("Rs ", "") : "\u00A0"}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} style={{ border: "1px solid #000", padding: "7px 6px", fontWeight: 800, textAlign: "right", letterSpacing: 1 }}>
                TOTAL
              </td>
              <td style={{ border: "1px solid #000", padding: "7px 6px", textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>
                {formatCurrency(grandTotal).replace("Rs ", "")}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 11, textDecoration: "underline" }}>Terms &amp; Conditions</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 10, color: "#222", lineHeight: 1.45 }}>{terms || "\u00A0"}</div>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
          <div style={{ flex: 1, fontSize: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Recieved By</div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>Name:</span> <span>{recvName || "\u00A0"}</span>
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>Date:</span> <span>{recvDate || "\u00A0"}</span>
            </div>
            <div style={{ marginTop: 14, fontWeight: 700 }}>Signature &amp; Stamp</div>
            <div style={{ borderBottom: "1px solid #000", minHeight: 36, marginTop: 6 }} />
          </div>
          <div style={{ flex: 1, fontSize: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Delivered By</div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>Name:</span> <span>{deliverName || "\u00A0"}</span>
            </div>
            <div style={{ marginTop: 48, textAlign: "center", fontWeight: 700 }}>Authorised Sign</div>
            <div style={{ borderBottom: "1px solid #000", minHeight: 36, marginTop: 6 }} />
          </div>
        </div>

        {/* Footer image */}
        <PrintFooter style={{ marginTop: 16 }} />
      </div>

      {/* ── Quote Products Modal ──────────────────────────────────────── */}
      {showQuoteProdsModal && (
        <div className="fixed inset-0 z-[900] flex items-start justify-center backdrop-blur-sm pt-8 px-3 pb-8 overflow-y-auto no-print">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/35 border-none cursor-default"
            onClick={() => setShowQuoteProdsModal(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl" style={{ background: "white", zIndex: 1 }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ background: "var(--purple)", color: "white" }}>
              <div className="flex items-center gap-2">
                <Package size={18} />
                <div>
                  <span className="text-[15px] font-bold">Quote Products</span>
                  <p className="text-[10px] text-white/75 mt-0.5">
                    Product catalog for quotations — selecting a product pre-fills the rate
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowQuoteProdsModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center border-none cursor-pointer hover:bg-white/15"
                style={{ color: "white" }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Add product form */}
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--purple)]"
                  placeholder="Product name"
                  value={newQProdName}
                  onChange={(e) => setNewQProdName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addQuoteProduct(); }}
                />
                <input
                  type="number"
                  className="w-28 border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--purple)]"
                  placeholder="Rate"
                  value={newQProdPrice}
                  onChange={(e) => setNewQProdPrice(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addQuoteProduct(); }}
                />
                <button
                  type="button"
                  onClick={() => void addQuoteProduct()}
                  disabled={addingQProd || !newQProdName.trim()}
                  className="px-4 py-2 rounded-lg border-none text-[12px] font-semibold cursor-pointer text-white disabled:opacity-50 flex items-center gap-1"
                  style={{ background: "var(--purple)" }}
                >
                  {addingQProd ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Add
                </button>
              </div>

              {/* Products list */}
              {quoteProdsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 size={20} className="animate-spin" style={{ color: "var(--purple)" }} />
                </div>
              ) : quoteProducts.length === 0 ? (
                <p className="text-center text-[13px] py-6" style={{ color: "var(--gray-500)" }}>
                  No products yet. Add one above.
                </p>
              ) : (
                <div className="border border-[var(--gray-100)] rounded-xl overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--gray-50)" }}>
                        <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide" style={{ color: "var(--gray-600)" }}>
                          Product
                        </th>
                        <th className="text-right px-3 py-2 font-bold text-[10px] uppercase tracking-wide" style={{ color: "var(--gray-600)" }}>
                          Rate / sqft
                        </th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {quoteProducts.map((p) => (
                        <tr key={p.id} className="border-t border-[var(--gray-100)]">
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--blue-deeper)" }}>
                            {formatCurrency(p.sale_price)}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => void removeQuoteProduct(p.id)}
                              className="p-1 rounded-md hover:bg-[var(--red-light)]"
                              style={{ color: "var(--red)" }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
