"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import { db, savePurchase } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import {
  Plus,
  Printer,
  Trash2,
  Pencil,
  X,
  Loader2,
  Download,
  Truck,
  Wallet,
  FileText,
  BookOpen,
} from "lucide-react";
import { DT } from "@/lib/dataTableStyles";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import {
  PurchaseOrderPdfDocument,
  type PurchaseOrderPdfPayload,
} from "@/components/PurchaseOrderPdfDocument";
import { usePaymentMethods, getMethodBalance, type PaymentMethod } from "@/lib/paymentMethods";
import { type LedgerRow, ledgerRowsForDateRange, openingBalanceBeforeDate } from "@/lib/ledger";
import { useUser } from "@/lib/UserContext";
import { confirmDialog } from "@/components/ConfirmModal";
import { logActivity } from "@/lib/activityLog";
import { buildSupplierPaymentWhatsAppMessage, openWhatsAppNewTab } from "@/lib/whatsappWaMe";
import { SearchableSelect } from "@/components/SearchableSelect";
import { PrintHeader } from "@/components/PrintHeader";
import { LedgerLineItems } from "@/components/LedgerLineItems";
import type { PurchaseOrderItem } from "@/lib/database.types";
import { PrintFooter } from "@/components/PrintFooter";

interface SupplierRow {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  /** Amount we owed this supplier before POs recorded here (Rs, ≥ 0). */
  opening_balance: number;
}

interface PoLine {
  id?: string;
  stockReceivedQty?: number;
  description: string;
  qty: number;
  rate: number;
  productId: string | null;
  expiryDate: string | null;
  amount: number;
}

interface PoDraft {
  requestId: string;
  poNumber: string;
  supplierId: string;
  orderDate: string;
  notes: string;
  amountPaid: string;
  payMethod: PaymentMethod;
  items: PoLine[];
}

interface SavedPO {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  order_date: string;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  payment_status: string;
  supplier_phone?: string;
}

function blankLine(): PoLine {
  return { description: "", qty: 1, rate: 0, amount: 0, productId: null, expiryDate: null };
}

function purchaseItemsPayload(items: PoLine[]) {
  return items.map(item => ({ id: item.id, product_id: item.productId, description: item.description,
    expiry_date: item.expiryDate, qty: item.qty, rate: item.rate }));
}

function calcLine(line: PoLine): PoLine {
  const qty = Math.max(0, Number(line.qty) || 0);
  const rate = Number(line.rate) || 0;
  const amount = Math.round(qty * rate * 100) / 100;
  return { ...line, qty, rate, amount };
}

function computePoPayment(grandTotal: number, amountPaidStr: string) {
  const paidParsed = parseFloat(String(amountPaidStr).replace(/,/g, "")) || 0;
  const amountPaid = Math.min(Math.max(0, paidParsed), grandTotal);
  const balanceDue = Math.round((grandTotal - amountPaid) * 100) / 100;
  const paymentStatus: "unpaid" | "partial" | "paid" =
    balanceDue <= 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";
  return { amountPaid, balanceDue, paymentStatus };
}

/** Opening payable + remaining PO balances for this supplier (estimate). */
function estimatedSupplierPayable(supplierId: string, openingBalance: number, pos: SavedPO[]) {
  const opening = Math.max(0, Number(openingBalance) || 0);
  const poRemain = pos
    .filter((p) => p.supplier_id === supplierId)
    .reduce((s, p) => s + (Number(p.balance_due) || 0), 0);
  return Math.round((opening + poRemain) * 100) / 100;
}

interface SupplierLedgerCashbookEntry {
  id: string;
  date: string;
  created_at: string;
  description: string;
  amount: number;
  type: string;
  method?: string | null;
  account_name?: string | null;
  reference?: string | null;
}

interface SupplierLedgerPo {
  id: string;
  po_number: string;
  order_date: string;
  created_at?: string;
  grand_total: number;
  payment_method?: string | null;
}

/** Sign convention mirrors the customer ledger so the same UI/print template renders cleanly:
 *    debit = adds to what we owe the supplier  (opening balance, PO grand totals)
 *    credit = reduces what we owe the supplier (cashbook payments / refunds)
 *    closing balance > 0 = payable to supplier */
function buildSupplierLedgerRows(
  supplierName: string,
  supplierCreatedAt: string,
  openingBalance: number,
  pos: SupplierLedgerPo[],
  cashbook: SupplierLedgerCashbookEntry[]
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const nameLower = supplierName.toLowerCase();
  const opening = Math.max(0, Number(openingBalance) || 0);

  // Opening balance row — anchored to the supplier's creation date so it sorts first.
  if (opening > 0) {
    const openDate = (supplierCreatedAt || "").slice(0, 10) || "1970-01-01";
    rows.push({
      date: openDate,
      sortAt: `${openDate}T00:00:00_opening`,
      doc: "Opening",
      desc: "Opening balance",
      debit: opening,
      credit: 0,
      method: "—",
    });
  }

  pos.forEach((po) => {
    const date = po.order_date;
    rows.push({
      date,
      sortAt: `${date}T${po.created_at || "1970-01-01"}_po`,
      doc: po.po_number,
      purchaseOrderId: po.id,
      desc: "Purchase invoice",
      debit: Number(po.grand_total) || 0,
      credit: 0,
      method: po.payment_method || "—",
    });
  });

  cashbook
    .filter((c) => (c.account_name || "").toLowerCase() === nameLower)
    .forEach((c) => {
      rows.push({
        date: c.date,
        sortAt: `${c.date}T${c.created_at || "1970-01-01"}_${c.id}`,
        doc: "Cashbook",
        desc: c.description || (c.type === "in" ? "Cashbook entry (in)" : "Cashbook entry (out)"),
        // A cash refund received settles a supplier credit; noncash return
        // adjustments and cash paid reduce what we owe.
        debit: c.type === "in" ? Number(c.amount) || 0 : 0,
        credit: c.type === "out" ? Number(c.amount) || 0 : 0,
        method: c.method || "—",
      });
    });

  rows.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  return rows;
}

interface SupplierUnpaidPoRow {
  id: string;
  po_number: string;
  order_date: string;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
}

export default function SupplierPage() {
  const userProfile = useUser();
  const { methods: paymentMethods } = usePaymentMethods();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [savedPOs, setSavedPOs] = useState<SavedPO[]>([]);
  const [poDraft, setPoDraft] = useState<PoDraft | null>(null);
  const [editPoId, setEditPoId] = useState<string | null>(null);
  const purchaseSaveRef = useRef(false);
  const [savingPo, setSavingPo] = useState(false);
  const [deletingPoId, setDeletingPoId] = useState<string | null>(null);

  const [supplierModal, setSupplierModal] = useState<SupplierRow | null>(null);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);

  /** Pay supplier (like Receive payment on accounts): cash out + reduce opening / PO balances. */
  const [showPaySupplierModal, setShowPaySupplierModal] = useState(false);
  const [paySupplierTarget, setPaySupplierTarget] = useState<SupplierRow | null>(null);
  const [paySupplierLoading, setPaySupplierLoading] = useState(false);
  const [payOpeningSnapshot, setPayOpeningSnapshot] = useState(0);
  const [payCreditSnapshot, setPayCreditSnapshot] = useState(0);
  const [paySupplierUnpaid, setPaySupplierUnpaid] = useState<SupplierUnpaidPoRow[]>([]);
  const [spDate, setSpDate] = useState(todayISO());
  const [spMethod, setSpMethod] = useState<PaymentMethod>("Cash");
  const [spDesc, setSpDesc] = useState("");
  const [spAmount, setSpAmount] = useState("");
  const [spSaving, setSpSaving] = useState(false);

  // Ledger modal state — mirrors the Parties ledger so PDF/print parity is straightforward.
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [ledgerSupplier, setLedgerSupplier] = useState<SupplierRow | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerItemsByPo, setLedgerItemsByPo] = useState<Record<string, PurchaseOrderItem[]>>({});
  const [ledgerPos, setLedgerPos] = useState<SupplierLedgerPo[]>([]);
  const [ledgerCashbook, setLedgerCashbook] = useState<SupplierLedgerCashbookEntry[]>([]);
  const [ledgerOpeningSnapshot, setLedgerOpeningSnapshot] = useState(0);
  const [ledgerSupplierCreatedAt, setLedgerSupplierCreatedAt] = useState("");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerMonth, setLedgerMonth] = useState("");
  const [ledgerDownloading, setLedgerDownloading] = useState(false);
  const ledgerPdfRef = useRef<HTMLDivElement | null>(null);

  const pdfRef = useRef<HTMLDivElement>(null);
  const [pdfData, setPdfData] = useState<PurchaseOrderPdfPayload | null>(null);
  const [generatingPdfFor, setGeneratingPdfFor] = useState<string | null>(null);
  const [printingPdfFor, setPrintingPdfFor] = useState<string | null>(null);
  const [draftPdfBusy, setDraftPdfBusy] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    const { data } = await db
      .from("suppliers")
      .select("id, name, phone, address, notes, opening_balance")
      .order("name");
    if (data) {
      setSuppliers(
        (data as SupplierRow[]).map((r) => ({
          ...r,
          opening_balance: Number(r.opening_balance) || 0,
        }))
      );
    }
  }, []);

  const fetchPOs = useCallback(async () => {
    const { data } = await db
      .from("purchase_orders")
      .select(
        "id, po_number, supplier_id, supplier_name, supplier_phone, order_date, grand_total, amount_paid, balance_due, payment_status"
      )
      .order("created_at", { ascending: false })
      .limit(80);
    if (data) {
      setSavedPOs(
        (data as SavedPO[]).map((r) => ({
          ...r,
          balance_due: Number(r.balance_due) || 0,
          grand_total: Number(r.grand_total) || 0,
          amount_paid: Number(r.amount_paid) || 0,
        }))
      );
    }
  }, []);

  useEffect(() => {
    void fetchSuppliers();
    void fetchPOs();
  }, [fetchSuppliers, fetchPOs]);

  const scheduleAfterPrint = useCallback((cleanup: () => void) => {
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      window.removeEventListener("afterprint", run);
      cleanup();
    };
    window.addEventListener("afterprint", run);
    window.setTimeout(run, 3500);
  }, []);

  function openNewSupplier() {
    setSupplierModal({ id: "", name: "", phone: "", address: "", notes: "", opening_balance: 0 });
  }

  function openEditSupplier(s: SupplierRow) {
    setSupplierModal({ ...s });
  }

  async function saveSupplier() {
    if (!supplierModal || !supplierModal.name.trim()) {
      showToast("Supplier name is required", "err");
      return;
    }
    setSupplierSaving(true);
    try {
      const ob = Math.max(0, parseFloat(String(supplierModal.opening_balance)) || 0);
      if (supplierModal.id) {
        const { error } = await db
          .from("suppliers")
          .update({
            name: supplierModal.name.trim(),
            phone: supplierModal.phone.trim(),
            address: supplierModal.address.trim(),
            notes: supplierModal.notes.trim(),
            opening_balance: ob,
          })
          .eq("id", supplierModal.id);
        if (error) {
          showToast(error.message, "err");
          return;
        }
        showToast("Supplier updated", "ok");
      } else {
        const { error } = await db.from("suppliers").insert({
          name: supplierModal.name.trim(),
          phone: supplierModal.phone.trim(),
          address: supplierModal.address.trim(),
          notes: supplierModal.notes.trim(),
          opening_balance: ob,
        });
        if (error) {
          showToast(error.message, "err");
          return;
        }
        showToast("Supplier added", "ok");
      }
      setSupplierModal(null);
      void fetchSuppliers();
    } finally {
      setSupplierSaving(false);
    }
  }

  async function deleteSupplier(s: SupplierRow) {
    if (deletingSupplierId) return;
    const { count, error: cErr } = await db
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", s.id);
    if (cErr) {
      showToast(cErr.message, "err");
      return;
    }
    if ((count ?? 0) > 0) {
      showToast("Cannot delete: this supplier has purchase invoices", "err");
      return;
    }
    const ok = await confirmDialog({
      title: "Delete supplier?",
      message: `Delete supplier "${s.name}"? This cannot be undone.`,
      tone: "danger",
    });
    if (!ok) return;
    setDeletingSupplierId(s.id);
    try {
      const { error } = await db.from("suppliers").delete().eq("id", s.id);
      if (error) {
        showToast(error.message, "err");
        return;
      }
      await logActivity({
        action: "delete",
        entityType: "supplier",
        entityId: s.id,
        title: "Supplier Deleted",
        subtitle: s.name,
        amount: Number(s.opening_balance ?? 0) || null,
      });
      showToast("Supplier removed", "ok");
      void fetchSuppliers();
    } finally {
      setDeletingSupplierId(null);
    }
  }

  async function deletePurchaseInvoice(po: SavedPO) {
    if (!userProfile?.isAdmin || deletingPoId) return;
    const ok = await confirmDialog({ title: "Delete purchase invoice?",
      message: `Delete ${po.po_number}? Its received stock will be removed. Invoices with payments, returns or sold stock cannot be deleted.`, tone: "danger" });
    if (!ok) return;
    setDeletingPoId(po.id);
    try {
      const { error } = await db.from("purchase_orders").delete().eq("id", po.id);
      if (error) { showToast(error.message, "err"); return; }
      showToast("Purchase invoice deleted", "ok");
      await Promise.all([fetchPOs(), fetchSuppliers()]);
    } finally { setDeletingPoId(null); }
  }

  function openPoModal() {
    if (suppliers.length === 0) {
      showToast("Add at least one supplier first", "err");
      return;
    }
    setPoDraft({
      requestId: crypto.randomUUID(),
      poNumber: "",
      supplierId: suppliers[0]?.id ?? "",
      orderDate: todayISO(),
      notes: "",
      amountPaid: "",
      payMethod: "Cash",
      items: [blankLine()],
    });
  }

  function openPoModalForSupplier(s: SupplierRow) {
    if (suppliers.length === 0) {
      showToast("Add at least one supplier first", "err");
      return;
    }
    setPoDraft({
      requestId: crypto.randomUUID(),
      poNumber: "",
      supplierId: s.id,
      orderDate: todayISO(),
      notes: "",
      amountPaid: "",
      payMethod: "Cash",
      items: [blankLine()],
    });
  }

  async function openEditPo(po: SavedPO) {
    const { data: poRow, error: poErr } = await db.from("purchase_orders").select("*").eq("id", po.id).single();
    if (poErr || !poRow) { showToast(poErr?.message || "Could not load PO", "err"); return; }
    const { data: itemRows, error: itemErr } = await db
      .from("purchase_order_items")
      .select("id, description, product_id, expiry_date, stock_received_qty, qty, rate, amount")
      .eq("purchase_order_id", po.id)
      .order("id", { ascending: true });
    if (itemErr) { showToast(itemErr.message, "err"); return; }
    const items: PoLine[] = ((itemRows ?? []) as Record<string, unknown>[]).map((it) => ({
      id: String(it.id),
      stockReceivedQty: Number(it.stock_received_qty),
      description: String(it.description ?? ""),
      qty: Number(it.qty),
      rate: Number(it.rate),
      amount: Number(it.amount),
      productId: it.product_id ? String(it.product_id) : null,
      expiryDate: it.expiry_date ? String(it.expiry_date).slice(0, 10) : null,
    }));
    setEditPoId(po.id);
    setPoDraft({
      requestId: crypto.randomUUID(),
      poNumber: poRow.po_number as string,
      supplierId: (poRow.supplier_id as string) ?? "",
      orderDate: (poRow.order_date as string) ?? todayISO(),
      notes: String(poRow.notes ?? ""),
      amountPaid: String(Number(poRow.amount_paid) || 0),
      payMethod: (poRow.payment_method as PaymentMethod) ?? "Cash",
      items: items.length > 0 ? items : [blankLine()],
    });
  }

  async function openPaySupplierModal(s: SupplierRow) {
    setPaySupplierTarget(s);
    setSpDate(todayISO());
    setSpMethod("Cash");
    setSpDesc("");
    setSpAmount("");
    setPaySupplierUnpaid([]);
    setPayOpeningSnapshot(0);
    setPayCreditSnapshot(0);
    setShowPaySupplierModal(true);
    setPaySupplierLoading(true);
    try {
      const [{ data: sup }, { data: pos }] = await Promise.all([
        db.from("suppliers").select("opening_balance").eq("id", s.id).single(),
        db
          .from("purchase_orders")
          .select("id, po_number, order_date, grand_total, amount_paid, balance_due")
          .eq("supplier_id", s.id)
          .order("order_date", { ascending: true }),
      ]);
      const opening = Math.max(0, Number(sup?.opening_balance) || 0);
      const rows = (pos ?? []) as SupplierUnpaidPoRow[];
      const unpaid = rows.filter((p) => Number(p.balance_due) > 0.005);
      const credit = rows.reduce((sum, p) => sum + Math.min(0, Number(p.balance_due) || 0), 0);
      setPayCreditSnapshot(credit);
      setPayOpeningSnapshot(opening);
      setPaySupplierUnpaid(unpaid);
      const poOwed = unpaid.reduce((acc, p) => acc + Math.max(0, Number(p.balance_due) || 0), 0);
      const out = Math.round((opening + poOwed + credit) * 100) / 100;
      setSpAmount(out > 0 ? String(out) : "");
    } catch {
      showToast("Could not load supplier balances", "err");
      setShowPaySupplierModal(false);
      setPaySupplierTarget(null);
    } finally {
      setPaySupplierLoading(false);
    }
  }

  function closePaySupplierModal() {
    if (spSaving) return;
    setShowPaySupplierModal(false);
    setPaySupplierTarget(null);
    setPaySupplierUnpaid([]);
    setPayOpeningSnapshot(0);
  }

  async function openLedgerModal(s: SupplierRow) {
    setLedgerSupplier(s);
    setShowLedgerModal(true);
    setLedgerLoading(true);
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerMonth("");
    setLedgerPos([]);
    setLedgerItemsByPo({});
    setLedgerCashbook([]);
    setLedgerOpeningSnapshot(Number(s.opening_balance) || 0);
    setLedgerSupplierCreatedAt("");
    const [{ data: supRow }, { data: poRows }, { data: cbRows }] = await Promise.all([
      db.from("suppliers").select("opening_balance, created_at").eq("id", s.id).single(),
      db
        .from("purchase_orders")
        .select("id, po_number, order_date, created_at, grand_total, payment_method")
        .eq("supplier_id", s.id)
        .order("order_date", { ascending: true })
        .order("created_at", { ascending: true }),
      db
        .from("cashbook")
        .select("id, date, created_at, description, amount, type, method, account_name, reference")
        .ilike("account_name", s.name)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (supRow) {
      setLedgerOpeningSnapshot(Number((supRow as { opening_balance: number }).opening_balance) || 0);
      setLedgerSupplierCreatedAt(String((supRow as { created_at: string }).created_at || ""));
    }
    if (poRows) setLedgerPos(poRows as SupplierLedgerPo[]);
    if (cbRows) setLedgerCashbook(cbRows as SupplierLedgerCashbookEntry[]);
    const poIds = ((poRows ?? []) as SupplierLedgerPo[]).map(po => po.id);
    if (poIds.length) {
      try {
        const { data: items, error } = await db.from("purchase_order_items").select("*")
          .in("purchase_order_id", poIds).order("id", { ascending: true });
        if (error) showToast(error.message, "err");
        const grouped: Record<string, PurchaseOrderItem[]> = {};
        for (const item of (items ?? []) as PurchaseOrderItem[]) (grouped[item.purchase_order_id] ||= []).push(item);
        setLedgerItemsByPo(grouped);
      } catch {
        showToast("Could not load purchase item details. Reopen the ledger to try again.", "err");
      }
    }
    setLedgerLoading(false);
  }

  function closeLedgerModal() {
    setShowLedgerModal(false);
    setLedgerSupplier(null);
    setLedgerPos([]);
    setLedgerItemsByPo({});
    setLedgerCashbook([]);
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerMonth("");
  }

  function applyLedgerMonth(ym: string) {
    if (!ym) {
      setLedgerDateFrom("");
      setLedgerDateTo("");
      return;
    }
    const [y, m] = ym.split("-").map((v) => parseInt(v, 10));
    if (!y || !m) return;
    const last = new Date(y, m, 0).getDate();
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    setLedgerDateFrom(from);
    setLedgerDateTo(to);
  }

  async function downloadLedgerPdf() {
    if (ledgerDownloading || ledgerLoading || !ledgerSupplier) return;
    const node = ledgerPdfRef.current;
    if (!node) {
      showToast("Report layout not ready", "err");
      return;
    }
    setLedgerDownloading(true);
    const prevDisplay = node.style.display;
    const prevPosition = node.style.position;
    const prevLeft = node.style.left;
    const prevTop = node.style.top;
    const prevWidth = node.style.width;
    const prevFlexDir = node.style.flexDirection;
    const prevMinHeight = node.style.minHeight;
    // Flex column + A4 content-area min-height (273mm @ 96dpi ≈ 1031px)
    // pins the footer to the bottom of the page even with few entries.
    node.style.setProperty("display", "flex", "important");
    node.style.setProperty("flex-direction", "column", "important");
    node.style.setProperty("min-height", "1031px", "important");
    node.style.position = "absolute";
    node.style.left = "-99999px";
    node.style.top = "0";
    node.style.width = "210mm";
    try {
      await new Promise((r) => setTimeout(r, 80));
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
        pdf.addImage(imgData, "PNG", 0, -pageHeight * i, imgWidth, imgHeight);
      }
      const safe = ledgerSupplier.name.replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 80) || "Supplier";
      pdf.save(`Ledger-${safe}.pdf`);
      showToast("Ledger PDF downloaded", "ok");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create PDF", "err");
    } finally {
      node.style.removeProperty("display");
      node.style.removeProperty("flex-direction");
      node.style.removeProperty("min-height");
      node.style.display = prevDisplay;
      node.style.flexDirection = prevFlexDir;
      node.style.minHeight = prevMinHeight;
      node.style.position = prevPosition;
      node.style.left = prevLeft;
      node.style.top = prevTop;
      node.style.width = prevWidth;
      setLedgerDownloading(false);
    }
  }

  // Memo-equivalents inlined; small data so re-derivation per render is fine.
  const ledgerAllRows = ledgerSupplier
    ? buildSupplierLedgerRows(
        ledgerSupplier.name,
        ledgerSupplierCreatedAt,
        ledgerOpeningSnapshot,
        ledgerPos,
        ledgerCashbook
      )
    : [];
  const ledgerDisplayWithBal = ledgerRowsForDateRange(ledgerAllRows, ledgerDateFrom, ledgerDateTo);
  const ledgerOpeningBefore = openingBalanceBeforeDate(ledgerAllRows, ledgerDateFrom);

  async function handlePaySupplier() {
    if (!paySupplierTarget) return;
    const amt = parseFloat(String(spAmount).replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast("Enter a valid amount", "err");
      return;
    }
    if (!spMethod || !spMethod.trim()) {
      showToast("Please select a payment method", "err");
      return;
    }
    if (!paymentMethods.some((m) => m.name === spMethod)) {
      showToast("Select a valid payment method", "err");
      return;
    }
    const available = await getMethodBalance(spMethod);
    if (amt > available) {
      showToast(`Not enough funds in "${spMethod}" (available ${formatCurrency(available)}). Choose a different payment method.`, "err");
      return;
    }

    setSpSaving(true);
    try {
      const [{ data: supFresh, error: supErr }, { data: poRows, error: poErr }] = await Promise.all([
        db.from("suppliers").select("opening_balance").eq("id", paySupplierTarget.id).single(),
        db
          .from("purchase_orders")
          .select("id, grand_total, amount_paid, balance_due, order_date")
          .eq("supplier_id", paySupplierTarget.id)
          .order("order_date", { ascending: true }),
      ]);
      if (supErr) {
        showToast(supErr.message, "err");
        return;
      }
      if (poErr) {
        showToast(poErr.message, "err");
        return;
      }

      const opening = Math.max(0, Number(supFresh?.opening_balance) || 0);
      const unpaidList = ((poRows ?? []) as { id: string; balance_due: number | string; amount_paid: number | string; grand_total: number | string }[]).filter((p) => Number(p.balance_due) > 0.005);
      const poOwed = unpaidList.reduce((s, p) => s + Math.max(0, Number(p.balance_due) || 0), 0);
      const credits = (poRows ?? []).reduce((sum: number, p: { balance_due: unknown }) => sum + Math.min(0, Number(p.balance_due) || 0), 0);
      const outstanding = Math.round((opening + poOwed + credits) * 100) / 100;

      if (outstanding <= 0) {
        showToast("Nothing owed to this supplier", "err");
        return;
      }
      if (amt > outstanding + 0.01) {
        showToast(`Maximum payable is ${formatCurrency(outstanding)}`, "err");
        return;
      }

      const name = paySupplierTarget.name.trim();
      const cbDesc = spDesc.trim()
        ? `Supplier payment — ${name} — ${spDesc.trim()}`
        : `Supplier payment — ${name}`;

      const { error: cbErr } = await db.from("cashbook").insert({
        type: "out",
        description: cbDesc,
        amount: amt,
        date: spDate,
        account_name: name,
        method: spMethod,
        reference: paySupplierTarget.id,
      });
      if (cbErr) {
        showToast(cbErr.message, "err");
        return;
      }

      let rem = Math.round(amt * 100) / 100;
      let newOpening = opening;
      const toOpening = Math.min(rem, newOpening);
      newOpening = Math.round((newOpening - toOpening) * 100) / 100;
      rem = Math.round((rem - toOpening) * 100) / 100;

      const { error: obErr } = await db
        .from("suppliers")
        .update({ opening_balance: Math.max(0, newOpening) })
        .eq("id", paySupplierTarget.id);
      if (obErr) {
        showToast(`Cash recorded but opening balance not updated: ${obErr.message}`, "err");
        void fetchSuppliers();
        void fetchPOs();
        closePaySupplierModal();
        return;
      }

      for (const po of unpaidList) {
        if (rem <= 0.005) break;
        const bd = Math.max(0, Number(po.balance_due) || 0);
        const pay = Math.min(rem, bd);
        const newPaid = Math.round((Number(po.amount_paid) + pay) * 100) / 100;
        const gt = Number(po.grand_total) || 0;
        const newBal = Math.round((gt - newPaid) * 100) / 100;
        const paymentStatus: "unpaid" | "partial" | "paid" =
          newBal <= 0 ? "paid" : newPaid > 0 ? "partial" : "unpaid";
        const { error: updErr } = await db
          .from("purchase_orders")
          .update({
            amount_paid: newPaid,
            balance_due: Math.max(0, newBal),
            payment_status: paymentStatus,
          })
          .eq("id", po.id);
        if (updErr) {
          showToast(`Cash recorded; PO ${po.id} update failed: ${updErr.message}`, "err");
          void fetchSuppliers();
          void fetchPOs();
          closePaySupplierModal();
          return;
        }
        rem = Math.round((rem - pay) * 100) / 100;
      }

      showToast(`Paid ${formatCurrency(amt)} to ${name}`, "ok");
      const remainingPayable = Math.max(0, Math.round((outstanding - amt) * 100) / 100);
      const waMsg = buildSupplierPaymentWhatsAppMessage({
        supplierName: name,
        amount: amt,
        dateISO: spDate,
        method: spMethod,
        description: spDesc.trim() || undefined,
        remainingPayable,
      });
      if (!openWhatsAppNewTab(paySupplierTarget.phone || "", waMsg)) {
        showToast("Payment saved. Add supplier phone to open WhatsApp notification.", "info");
      }
      closePaySupplierModal();
      void fetchSuppliers();
      void fetchPOs();
    } finally {
      setSpSaving(false);
    }
  }

  function draftToPdfPayload(d: PoDraft): PurchaseOrderPdfPayload | null {
    const sup = suppliers.find((x) => x.id === d.supplierId);
    if (!sup) return null;
    const items = d.items.map((it) => calcLine(it));
    const grandTotal = items.reduce((s, it) => s + it.amount, 0);
    const { amountPaid, balanceDue, paymentStatus } = computePoPayment(grandTotal, d.amountPaid);
    return {
      po: {
        po_number: d.poNumber,
        supplier_name: sup.name,
        supplier_phone: sup.phone,
        order_date: d.orderDate,
        payment_status: paymentStatus,
        grand_total: grandTotal,
        amount_paid: amountPaid,
        balance_due: balanceDue,
        payment_method: d.payMethod,
        notes: d.notes.trim(),
      },
      items: items.map((it) => ({
        description: it.description,
        expiry_date: it.expiryDate,
        qty: it.qty,
        rate: it.rate,
        amount: it.amount,
      })),
    };
  }

  async function fetchPoPdfPayload(poId: string): Promise<PurchaseOrderPdfPayload | null> {
    const { data: po, error: poErr } = await db.from("purchase_orders").select("*").eq("id", poId).single();
    if (poErr || !po) {
      showToast(poErr?.message || "Purchase invoice not found", "err");
      return null;
    }
    const { data: rows, error: itemErr } = await db
      .from("purchase_order_items")
      .select("description, expiry_date, unit, qty, rate, amount")
      .eq("purchase_order_id", poId)
      .order("id", { ascending: true });
    if (itemErr) {
      showToast(itemErr.message, "err");
      return null;
    }
    return {
      po: {
        po_number: po.po_number as string,
        supplier_name: po.supplier_name as string,
        supplier_phone: (po.supplier_phone as string) || "",
        order_date: po.order_date as string,
        payment_status: po.payment_status as string,
        grand_total: Number(po.grand_total),
        amount_paid: Number(po.amount_paid),
        balance_due: Number(po.balance_due),
        payment_method: (po.payment_method as string) || "Cash",
        notes: String(po.notes ?? "").trim(),
      },
      items: ((rows ?? []) as Record<string, unknown>[]).map((it) => ({
        description: String(it.description ?? ""),
        expiry_date: it.expiry_date ? String(it.expiry_date).slice(0, 10) : null,
        qty: Number(it.qty),
        rate: Number(it.rate),
        amount: Number(it.amount),
      })),
    };
  }

  async function generatePdfBlob(): Promise<Blob> {
    const node = pdfRef.current;
    if (!node) throw new Error("PDF template not found");
    const prevDisplay = node.style.display;
    const prevPosition = node.style.position;
    const prevLeft = node.style.left;
    const prevTop = node.style.top;
    const prevWidth = node.style.width;
    node.style.display = "block";
    node.style.position = "absolute";
    node.style.left = "-99999px";
    node.style.top = "0";
    node.style.width = "210mm";
    try {
      await new Promise((r) => setTimeout(r, 100));
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
        pdf.addImage(imgData, "PNG", 0, -pageHeight * i, imgWidth, imgHeight);
      }
      return pdf.output("blob");
    } finally {
      node.style.display = prevDisplay;
      node.style.position = prevPosition;
      node.style.left = prevLeft;
      node.style.top = prevTop;
      node.style.width = prevWidth;
    }
  }

  async function updatePurchaseOrder() {
    if (!poDraft || !editPoId) return;
    const items = poDraft.items.map((it) => calcLine(it));
    const grandTotal = items.reduce((s, it) => s + it.amount, 0);
    if (grandTotal <= 0) { showToast("Add at least one line with an amount", "err"); return; }
    setSavingPo(true);
    try {
      const { error } = await savePurchase({ order_date: poDraft.orderDate, notes: poDraft.notes.trim() },
        purchaseItemsPayload(items), editPoId);
      if (error) { showToast(error.message, "err"); return; }
      showToast(`Purchase invoice ${poDraft.poNumber} updated`, "ok");
      setPoDraft(null);
      setEditPoId(null);
      void fetchPOs();
    } finally {
      setSavingPo(false);
    }
  }

  async function savePurchaseOrder() {
    if (purchaseSaveRef.current) return;
    purchaseSaveRef.current = true;
    try {
      if (!poDraft) return;
      if (editPoId) { await updatePurchaseOrder(); return; }
      const sup = suppliers.find((x) => x.id === poDraft.supplierId);
      if (!sup) {
        showToast("Select a supplier", "err");
        return;
      }
      const items = poDraft.items.map((it) => calcLine(it));
      const grandTotal = items.reduce((s, it) => s + it.amount, 0);
      if (grandTotal <= 0) {
        showToast("Add at least one line with an amount", "err");
        return;
      }
      const { amountPaid, balanceDue } = computePoPayment(grandTotal, poDraft.amountPaid);

      if (amountPaid > 0) {
        if (!poDraft.payMethod || !poDraft.payMethod.trim()) {
          showToast("Please select a payment method", "err");
          return;
        }
        if (!paymentMethods.some((m) => m.name === poDraft.payMethod)) {
          showToast("Select a valid payment method", "err");
          return;
        }
        const available = await getMethodBalance(poDraft.payMethod);
        if (amountPaid > available) {
          showToast(`Not enough funds in "${poDraft.payMethod}" (available ${formatCurrency(available)}). Choose a different payment method.`, "err");
          return;
        }
      }

      setSavingPo(true);
      try {
        const { data: poRow, error: poErr } = await savePurchase({
          supplier_id: sup.id, order_date: poDraft.orderDate, notes: poDraft.notes.trim(),
          amount_paid: amountPaid, payment_method: poDraft.payMethod,
        }, purchaseItemsPayload(items), undefined, poDraft.requestId);
        if (poErr || !poRow) {
          showToast(poErr?.message || "Could not save purchase invoice", "err");
          return;
        }
        const assignedPoNumber = String((poRow as { po_number: string }).po_number);

        setEditPoId(String(poRow.id));
        setPoDraft(current => current ? { ...current, items: (poRow.items as Record<string, unknown>[]).map(row => ({
          id: String(row.id), productId: row.product_id ? String(row.product_id) : null,
          stockReceivedQty: Number(row.stock_received_qty),
          description: String(row.description), qty: Number(row.qty), rate: Number(row.rate), amount: Number(row.amount),
          expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
        })) } : null);

        if (amountPaid > 0 && !poRow.cashbook_entry_id) {
          const { data: cb, error: cbErr } = await db
            .from("cashbook")
            .insert({
              type: "out",
              description: `Purchase invoice ${assignedPoNumber} — ${sup.name}`,
              amount: amountPaid,
              date: poDraft.orderDate,
              method: poDraft.payMethod,
              reference: String(poRow.id),
              account_name: sup.name,
            })
            .select()
            .single();
          if (cbErr) {
            showToast(`PO saved but cashbook error: ${cbErr.message}`, "err");
          } else if (cb) {
            await db.from("purchase_orders").update({ cashbook_entry_id: cb.id }).eq("id", poRow.id);
            const waMsg = buildSupplierPaymentWhatsAppMessage({
              supplierName: sup.name,
              amount: amountPaid,
              dateISO: poDraft.orderDate,
              method: poDraft.payMethod,
              description: `Advance/paid amount for PO ${assignedPoNumber}`,
              remainingPayable: Math.max(0, balanceDue),
            });
            if (!openWhatsAppNewTab(sup.phone || "", waMsg)) {
              showToast("PO saved. Add supplier phone to send WhatsApp payment notice.", "info");
            }
          }
        }

        showToast(`Purchase invoice ${assignedPoNumber} saved`, "ok");
        setEditPoId(null);
        setPoDraft(null);
        void fetchPOs();
      } finally {
        setSavingPo(false);
      }
    } finally { purchaseSaveRef.current = false; }
  }

  async function downloadPoPdf(po: SavedPO) {
    if (generatingPdfFor || printingPdfFor || draftPdfBusy) return;
    setGeneratingPdfFor(po.id);
    try {
      const payload = await fetchPoPdfPayload(po.id);
      if (!payload) return;
      setPdfData(payload);
      await new Promise((r) => setTimeout(r, 150));
      const blob = await generatePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
      const poSupplier = safe(payload.po.supplier_name || "Supplier");
      const poNum = safe(payload.po.po_number);
      const poDate = safe(payload.po.order_date?.slice(0, 10) ?? "");
      a.download = `${poSupplier} - ${poNum} - ${poDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("PDF downloaded", "ok");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "PDF failed", "err");
    } finally {
      setPdfData(null);
      setGeneratingPdfFor(null);
    }
  }

  async function printPoPdf(po: SavedPO) {
    if (generatingPdfFor || printingPdfFor || draftPdfBusy) return;
    setPrintingPdfFor(po.id);
    try {
      const payload = await fetchPoPdfPayload(po.id);
      if (!payload) {
        setPrintingPdfFor(null);
        return;
      }
      setPdfData(payload);
      await new Promise((r) => setTimeout(r, 200));
      scheduleAfterPrint(() => {
        setPdfData(null);
        setPrintingPdfFor(null);
      });
      window.print();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Print failed", "err");
      setPdfData(null);
      setPrintingPdfFor(null);
    }
  }

  async function printDraftPo() {
    if (!poDraft || draftPdfBusy || generatingPdfFor || printingPdfFor) return;
    const payload = draftToPdfPayload(poDraft);
    if (!payload) {
      showToast("Select a supplier", "err");
      return;
    }
    const grandTotal = payload.items.reduce((s, it) => s + it.amount, 0);
    if (grandTotal <= 0) {
      showToast("Add lines with amounts before printing", "err");
      return;
    }
    setDraftPdfBusy(true);
    try {
      setPdfData(payload);
      await new Promise((r) => setTimeout(r, 200));
      scheduleAfterPrint(() => {
        setPdfData(null);
        setDraftPdfBusy(false);
      });
      window.print();
    } catch {
      setPdfData(null);
      setDraftPdfBusy(false);
    }
  }

  async function downloadDraftPo() {
    if (!poDraft || draftPdfBusy || generatingPdfFor || printingPdfFor) return;
    const payload = draftToPdfPayload(poDraft);
    if (!payload) {
      showToast("Select a supplier", "err");
      return;
    }
    const grandTotal = payload.items.reduce((s, it) => s + it.amount, 0);
    if (grandTotal <= 0) {
      showToast("Add lines with amounts before download", "err");
      return;
    }
    setDraftPdfBusy(true);
    try {
      setPdfData(payload);
      await new Promise((r) => setTimeout(r, 150));
      const blob = await generatePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
      const draftPoSupplier = safe(payload.po.supplier_name || "Supplier");
      const draftPoNum = safe(payload.po.po_number);
      const draftPoDate = safe(payload.po.order_date?.slice(0, 10) ?? "");
      a.download = `${draftPoSupplier} - ${draftPoNum} - ${draftPoDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("PDF downloaded", "ok");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "PDF failed", "err");
    } finally {
      setPdfData(null);
      setDraftPdfBusy(false);
    }
  }

  const STATUS = {
    paid: { bg: "var(--green-light)", color: "var(--green)" },
    partial: { bg: "var(--orange-light)", color: "#B45309" },
    unpaid: { bg: "var(--red-light)", color: "var(--red)" },
  } as Record<string, { bg: string; color: string }>;

  const payModalInputStyle = {
    borderColor: "var(--gray-200)",
    background: "var(--gray-50)",
    color: "var(--gray-900)",
  } as const;

  const payModalOutstanding =
    Math.round(
      (payOpeningSnapshot + payCreditSnapshot +
        paySupplierUnpaid.reduce((s, p) => s + Math.max(0, Number(p.balance_due) || 0), 0)) *
        100
    ) / 100;

  const supplierTableColCount = userProfile?.isAdmin ? 10 : 9;

  const supplierTableHeaders: {
    label: string;
    title?: string;
    align: "left" | "center";
  }[] = [
    { label: "Name", align: "left" },
    { label: "Phone", align: "left" },
    { label: "Opening owed", title: "Amount owed before POs in this app", align: "left" },
    { label: "Est. payable", title: "Opening owed + unpaid balances on all POs for this supplier", align: "left" },
    { label: "Address", align: "left" },
    { label: "Ledger", title: "View full transaction ledger and download/print report", align: "center" },
    { label: "Pay supplier", title: "Cash out — reduce opening balance then oldest POs first", align: "center" },
    { label: "New invoice", title: "Create purchase invoice with this supplier selected", align: "center" },
    { label: "Actions", title: "Edit or delete supplier", align: "center" },
  ];

  return (
    <>
      <div className="animate-fade-in">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}
            >
              <Truck size={22} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>
                Supplier billing
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--gray-700)" }}>
                Payments for purchase invoices post to Cash Book as <b>money out</b> (reduces cash in hand). Set supplier opening payables below; they are not cash until you pay.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">

            <button
              type="button"
              onClick={openNewSupplier}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border border-[var(--gray-200)] text-[12.5px] font-semibold cursor-pointer"
              style={{ background: "white", color: "var(--gray-900)" }}
            >
              <Plus size={14} /> Add supplier
            </button>
            <button
              type="button"
              onClick={openPoModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white"
              style={{
                background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))",
                boxShadow: "0 2px 10px rgba(2,132,199,.28)",
              }}
            >
              <Plus size={14} /> New purchase invoice
            </button>
          </div>
        </div>

        <section className="mb-8">
          <div className="flex items-center gap-2.5 mb-3">
            <Truck size={14} style={{ color: "var(--gray-700)" }} />
            <span className="text-[10px] font-bold tracking-[2px] uppercase" style={{ color: "var(--gray-700)" }}>
              Suppliers
            </span>
            <div className="flex-1 h-px" style={{ background: "var(--gray-200)" }} />
            <span className="text-[11px] font-semibold" style={{ color: "var(--gray-700)" }}>{suppliers.length}</span>
          </div>
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="overflow-x-auto">
              <table className={`${DT.table} min-w-[900px]`}>
                <thead>
                  <tr>
                    {supplierTableHeaders.map((h) => (
                      <th
                        key={h.label}
                        title={h.title}
                        className={`${DT.th} ${h.align === "center" ? "text-center" : "text-left"} ${h.label === "Pay supplier" || h.label === "New invoice" ? "min-w-[108px]" : ""} ${h.label === "Actions" ? "min-w-[88px]" : ""}`}
                        style={DT.thStyle}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={supplierTableColCount} className={DT.empty} style={DT.emptyStyle}>
                        No suppliers — use <strong>Add supplier</strong>
                      </td>
                    </tr>
                  ) : (
                    suppliers.map((s) => {
                      const estPay = estimatedSupplierPayable(s.id, s.opening_balance, savedPOs);
                      return (
                      <tr key={s.id} className={DT.row}>
                        <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{s.name}</td>
                        <td className={`${DT.td} ${DT.cellBody}`}>{s.phone || "—"}</td>
                        <td className={`${DT.td} font-mono text-[12px]`} style={{ color: "var(--gray-800)" }}>
                          {Number(s.opening_balance) > 0 ? formatCurrency(Number(s.opening_balance)) : "—"}
                        </td>
                        <td className={`${DT.td} font-mono text-[12px] font-bold`} style={{ color: estPay > 0 ? "var(--red)" : "var(--gray-400)" }}>
                          {estPay > 0 ? formatCurrency(estPay) : "—"}
                        </td>
                        <td className={`${DT.td} ${DT.cellBody} max-w-[200px] truncate`} title={s.address}>
                          {s.address || "—"}
                        </td>
                        <td className={`${DT.td} text-center align-middle`}>
                          <button
                            type="button"
                            onClick={() => void openLedgerModal(s)}
                            className="inline-flex items-center justify-center gap-1.5 w-full max-w-[140px] mx-auto px-3 py-2 rounded-[9px] border-[1.5px] cursor-pointer hover:bg-[var(--orange-light)] text-[11px] font-bold"
                            style={{ borderColor: "var(--orange)", color: "#B45309" }}
                            title="See full transaction ledger for this supplier"
                          >
                            <BookOpen size={14} /> Ledger
                          </button>
                        </td>
                        <td className={`${DT.td} text-center align-middle`}>
                          <button
                            type="button"
                            onClick={() => void openPaySupplierModal(s)}
                            className="inline-flex items-center justify-center gap-1.5 w-full max-w-[140px] mx-auto px-3 py-2 rounded-[9px] border-[1.5px] cursor-pointer hover:bg-[var(--blue-light)] text-[11px] font-bold"
                            style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
                            title="Pay supplier — cash out, reduce opening balance then oldest POs first"
                          >
                            <Wallet size={14} /> Pay
                          </button>
                        </td>
                        <td className={`${DT.td} text-center align-middle`}>
                          <button
                            type="button"
                            onClick={() => openPoModalForSupplier(s)}
                            className="inline-flex items-center justify-center gap-1.5 w-full max-w-[140px] mx-auto px-3 py-2 rounded-[9px] border-[1.5px] cursor-pointer hover:bg-[var(--blue-pale)] text-[11px] font-bold"
                            style={{ borderColor: "var(--blue-deeper)", color: "var(--blue-deeper)" }}
                            title="New purchase invoice for this supplier"
                          >
                            <FileText size={14} /> New invoice
                          </button>
                        </td>
                        <td className={`${DT.td} text-center align-middle`}>
                          <div className="inline-flex gap-1 justify-center">
                            <button
                              type="button"
                              onClick={() => openEditSupplier(s)}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--gray-50)]"
                              style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            {userProfile?.isAdmin && (
                              <button
                                type="button"
                                onClick={() => void deleteSupplier(s)}
                                disabled={deletingSupplierId === s.id}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--red-light)] disabled:opacity-45"
                                style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}
                                title="Delete"
                              >
                                {deletingSupplierId === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[10px] font-bold tracking-[2px] uppercase" style={{ color: "var(--gray-700)" }}>
              Purchase invoices
            </span>
            <div className="flex-1 h-px" style={{ background: "var(--gray-200)" }} />
            <span className="text-[11px] font-semibold" style={{ color: "var(--gray-700)" }}>{savedPOs.length}</span>
          </div>
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="overflow-x-auto">
              <table className={`${DT.table} min-w-[720px]`}>
                <thead>
                  <tr>
                    {["PO #", "Supplier", "Date", "Total", "Paid", "Status", "Actions"].map((h) => (
                      <th
                        key={h}
                        className={`${DT.th} ${h === "Actions" ? "text-center min-w-[100px]" : "text-left"}`}
                        style={DT.thStyle}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {savedPOs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className={DT.empty} style={DT.emptyStyle}>
                        No purchase invoices yet
                      </td>
                    </tr>
                  ) : (
                    savedPOs.map((po) => {
                      const st = STATUS[po.payment_status] ?? STATUS.unpaid;
                      return (
                        <tr key={po.id} className={DT.row}>
                          <td className={DT.td}>
                            <span
                              className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded"
                              style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}
                            >
                              {po.po_number}
                            </span>
                          </td>
                          <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{po.supplier_name}</td>
                          <td className={`${DT.td} ${DT.cellBody}`}>{po.order_date}</td>
                          <td className={`${DT.td} font-mono font-bold text-[14px]`} style={{ color: "var(--blue-deeper)" }}>
                            {formatCurrency(Number(po.grand_total))}
                          </td>
                          <td className={`${DT.td} font-mono text-[13px]`} style={{ color: "var(--green)" }}>
                            {formatCurrency(Number(po.amount_paid))}
                          </td>
                          <td className={DT.td}>
                            <span className={`${DT.badge} capitalize`} style={{ background: st.bg, color: st.color }}>
                              {po.payment_status}
                            </span>
                          </td>
                          <td className={`${DT.td} text-center px-1 py-2`}>
                            <div className="inline-flex gap-0.5">
                              <button
                                type="button"
                                onClick={() => void openEditPo(po)}
                                disabled={generatingPdfFor !== null || printingPdfFor !== null || draftPdfBusy}
                                title="Edit purchase invoice"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--blue-pale)] disabled:opacity-45"
                                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                              >
                                <Pencil size={14} />
                              </button>
                              {userProfile?.isAdmin && <button type="button" onClick={() => void deletePurchaseInvoice(po)}
                                disabled={deletingPoId !== null || savingPo} title="Delete purchase invoice"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--red-light)] disabled:opacity-45"
                                style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}>
                                {deletingPoId === po.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>}
                              <button
                                type="button"
                                onClick={() => {
                                  const msg = buildSupplierPaymentWhatsAppMessage({
                                    supplierName: po.supplier_name,
                                    amount: Number(po.amount_paid) || 0,
                                    dateISO: po.order_date,
                                    method: "N/A",
                                    description: `PO ${po.po_number} status update`,
                                    remainingPayable: Number(po.balance_due) || 0,
                                  });
                                  if (!openWhatsAppNewTab(po.supplier_phone || "", msg)) {
                                    showToast("No valid supplier phone on this PO", "err");
                                  }
                                }}
                                disabled={generatingPdfFor !== null || printingPdfFor !== null || draftPdfBusy}
                                title="Send WhatsApp update"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--gray-50)] disabled:opacity-45"
                                style={{ borderColor: "var(--gray-200)", color: "#0277b5" }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => void printPoPdf(po)}
                                disabled={generatingPdfFor !== null || printingPdfFor !== null || draftPdfBusy}
                                title="Print"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--gray-50)] disabled:opacity-45"
                                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                              >
                                {printingPdfFor === po.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                              </button>
                              <button
                                type="button"
                                onClick={() => void downloadPoPdf(po)}
                                disabled={generatingPdfFor !== null || printingPdfFor !== null || draftPdfBusy}
                                title="Download PDF"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer hover:bg-[var(--gray-50)] disabled:opacity-45"
                                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                              >
                                {generatingPdfFor === po.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div ref={pdfRef} className="print-only" style={{ background: "#fff" }}>
        {pdfData ? <PurchaseOrderPdfDocument data={pdfData} /> : null}
      </div>

      {/* Pay supplier — mirrors accounts "Receive payment" but cash out + reduces opening / PO balances */}
      {showPaySupplierModal && paySupplierTarget && (
        <div
          className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto no-print"
          style={{ background: "rgba(10,30,50,.3)" }}
        >
          <div
            className="bg-white rounded-[20px] w-[440px] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
              <div>
                <h2 className="text-[15px] font-bold" style={{ color: "var(--gray-900)" }}>Pay supplier</h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--gray-800)" }}>{paySupplierTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={closePaySupplierModal}
                disabled={spSaving}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer disabled:opacity-50"
                style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}
              >
                <X size={12} />
              </button>
            </div>

            {paySupplierLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[13px]" style={{ color: "var(--gray-700)" }}>
                <Loader2 size={18} className="animate-spin" /> Loading balances…
              </div>
            ) : (
              <>
                <div
                  className="mx-5 mt-4 px-4 py-3 rounded-[10px] flex flex-col gap-1"
                  style={{
                    background: payModalOutstanding > 0 ? "var(--red-light)" : "var(--gray-100)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold" style={{ color: "var(--gray-800)" }}>Outstanding payable</span>
                    <span
                      className="text-[13px] font-extrabold font-mono"
                      style={{ color: payModalOutstanding > 0 ? "var(--red)" : "var(--gray-600)" }}
                    >
                      {formatCurrency(payModalOutstanding)}
                    </span>
                  </div>
                  <p className="text-[9px] font-medium m-0 leading-snug" style={{ color: "var(--gray-600)" }}>
                    Payment applies to <b>opening balance</b> first, then <b>purchase invoices</b> by date (oldest first). Posts to Cash Book as money out.
                  </p>
                </div>

                {payModalOutstanding <= 0 ? (
                  <p className="px-5 py-6 text-[13px] m-0" style={{ color: "var(--gray-600)" }}>
                    Nothing owed to this supplier. Use <b>New purchase invoice</b> to record new purchases.
                  </p>
                ) : (
                  <div className="px-5 py-3 max-h-[160px] overflow-y-auto border-b border-[var(--gray-100)]">
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--gray-700)" }}>
                      Breakdown
                    </div>
                    {payOpeningSnapshot > 0 && (
                      <div className="flex justify-between text-[12px] py-1 font-mono" style={{ color: "var(--gray-800)" }}>
                        <span>Opening owed</span>
                        <span>{formatCurrency(payOpeningSnapshot)}</span>
                      </div>
                    )}
                    {paySupplierUnpaid.map((p) => (
                      <div key={p.id} className="flex justify-between text-[12px] py-1 font-mono" style={{ color: "var(--gray-800)" }}>
                        <span className="truncate pr-2" title={p.po_number}>
                          {p.po_number} <span className="text-[10px] opacity-80">({formatDate(p.order_date)})</span>
                        </span>
                        <span>{formatCurrency(Math.max(0, Number(p.balance_due) || 0))}</span>
                      </div>
                    ))}
                  </div>
                )}

                {payModalOutstanding > 0 && (
                  <div className="p-5">
                    <div className="flex flex-col gap-3.5">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                          Date
                        </label>
                        <input
                          type="date"
                          value={spDate}
                          onChange={(e) => setSpDate(e.target.value)}
                          className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                          style={payModalInputStyle}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                          Payment method
                        </label>
                        <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                          {paymentMethods.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setSpMethod(m.name)}
                              className="flex-1 min-w-[80px] py-2 text-[10px] font-semibold border-none cursor-pointer transition-all"
                              style={{
                                background: spMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                                color: spMethod === m.name ? "#fff" : "var(--gray-500)",
                              }}
                            >
                              {m.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                          Description <span style={{ color: "var(--gray-700)" }}>(optional)</span>
                        </label>
                        <input
                          value={spDesc}
                          onChange={(e) => setSpDesc(e.target.value)}
                          placeholder={`Supplier payment — ${paySupplierTarget.name}`}
                          className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                          style={payModalInputStyle}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                          Amount <span style={{ color: "var(--red)" }}>*</span>
                        </label>
                        <input
                          value={spAmount}
                          onChange={(e) => setSpAmount(e.target.value)}
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                          style={payModalInputStyle}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
                  <button
                    type="button"
                    onClick={closePaySupplierModal}
                    disabled={spSaving}
                    className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white disabled:opacity-50"
                    style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePaySupplier()}
                    disabled={spSaving || paySupplierLoading || payModalOutstanding <= 0}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-50"
                    style={{ background: "var(--blue)", boxShadow: "0 2px 10px rgba(14,173,106,.25)" }}
                  >
                    <Wallet size={14} />
                    {spSaving ? "Saving…" : "Record payment"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {supplierModal && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-16 px-3 pb-8 overflow-y-auto no-print">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/35 border-none cursor-default"
            onClick={() => { if (!supplierSaving) setSupplierModal(null); }}
          />
          <div
            className="relative z-10 w-full max-w-md bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden"
            style={{ boxShadow: "var(--shadow-lg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gray-100)]" style={{ background: "var(--blue-deeper)" }}>
              <h2 className="text-[14px] font-extrabold text-white">{supplierModal.id ? "Edit supplier" : "New supplier"}</h2>
              <button
                type="button"
                onClick={() => { if (!supplierSaving) setSupplierModal(null); }}
                className="w-8 h-8 rounded-lg border-none bg-white/10 text-white cursor-pointer flex items-center justify-center hover:bg-white/20"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
                Name *
                <input
                  className="mt-1 w-full border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[14px]"
                  value={supplierModal.name}
                  onChange={(e) => setSupplierModal({ ...supplierModal, name: e.target.value })}
                  placeholder="e.g. ABC Materials"
                />
              </label>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
                Phone
                <input
                  className="mt-1 w-full border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[14px]"
                  value={supplierModal.phone}
                  onChange={(e) => setSupplierModal({ ...supplierModal, phone: e.target.value })}
                />
              </label>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
                Address
                <input
                  className="mt-1 w-full border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[14px]"
                  value={supplierModal.address}
                  onChange={(e) => setSupplierModal({ ...supplierModal, address: e.target.value })}
                />
              </label>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
                Notes
                <textarea
                  className="mt-1 w-full border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[13px] min-h-[72px] resize-y"
                  value={supplierModal.notes}
                  onChange={(e) => setSupplierModal({ ...supplierModal, notes: e.target.value })}
                />
              </label>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
                Opening balance owed (Rs)
                <input
                  type="number"
                  min={0}
                  step="1"
                  className="mt-1 w-full border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[14px] font-mono"
                  value={supplierModal.opening_balance === 0 ? "" : supplierModal.opening_balance}
                  onChange={(e) =>
                    setSupplierModal({
                      ...supplierModal,
                      opening_balance: Math.max(0, parseFloat(e.target.value) || 0),
                    })
                  }
                  placeholder="0"
                />
                <span className="block mt-1 text-[10px] font-normal normal-case" style={{ color: "var(--gray-600)" }}>
                  What you already owed this supplier before purchase invoices here. Does not change cash until you pay (e.g. via Paid now on a purchase invoice or Cash Book).
                </span>
              </label>

            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--gray-100)] bg-[var(--gray-50)]">
              <button
                type="button"
                onClick={() => { if (!supplierSaving) setSupplierModal(null); }}
                className="px-4 py-2 rounded-lg border border-[var(--gray-200)] text-[12px] font-semibold cursor-pointer bg-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveSupplier()}
                disabled={supplierSaving}
                className="px-4 py-2 rounded-lg border-none text-[12px] font-semibold cursor-pointer text-white disabled:opacity-50"
                style={{ background: "var(--blue)" }}
              >
                {supplierSaving ? <Loader2 size={14} className="animate-spin inline" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {poDraft && (
        <PoModal
          draft={poDraft}
          setDraft={setPoDraft}
          suppliers={suppliers}
          savedPOs={savedPOs}
          excludePoId={editPoId}
          paymentMethods={paymentMethods}
          onClose={() => { setPoDraft(null); setEditPoId(null); }}
          onSave={() => void savePurchaseOrder()}
          saving={savingPo}
          draftPdfBusy={draftPdfBusy}
          onPrintDraft={() => void printDraftPo()}
          onDownloadDraft={() => void downloadDraftPo()}
          isEdit={!!editPoId}
        />
      )}

      {/* Supplier ledger modal — mirrors the customer (Parties) ledger UX */}
      {showLedgerModal && ledgerSupplier && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-6 px-4 pb-8 overflow-y-auto no-print"
          style={{ background: "rgba(10,30,50,.35)" }}>
          <div className="bg-white rounded-[20px] w-[min(920px,100%)] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]"
              style={{ background: "linear-gradient(90deg, #B45309, var(--orange))" }}>
              <div>
                <h2 className="text-[15px] font-bold text-white">Supplier ledger</h2>
                <p className="text-[11px] mt-0.5 text-white/80">{ledgerSupplier.name}</p>
              </div>
              <button type="button" onClick={closeLedgerModal}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "rgba(255,255,255,0.2)", color: "white" }}>
                <X size={12} />
              </button>
            </div>

            <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gray-100)]"
              style={{ background: "var(--gray-50)" }}>
              <p className="text-[11px] font-semibold m-0" style={{ color: "var(--gray-800)" }}>
                Opening balance, purchase invoices and cashbook lines for this supplier
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void downloadLedgerPdf()}
                  disabled={ledgerLoading || ledgerDownloading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                  <Download size={14} /> {ledgerDownloading ? "Saving…" : "Download PDF"}
                </button>
                <button type="button" onClick={() => window.print()}
                  disabled={ledgerLoading || ledgerDownloading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                  <Printer size={14} /> Print report
                </button>
              </div>
            </div>

            <div className="px-5 py-3 flex flex-wrap items-end gap-3 border-b border-[var(--gray-100)]"
              style={{ background: "var(--gray-50)" }}>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>Month</label>
                <input type="month" value={ledgerMonth}
                  onChange={(e) => { const v = e.target.value; setLedgerMonth(v); applyLedgerMonth(v); }}
                  className="border-[1.5px] rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none min-w-[150px]"
                  style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>From</label>
                <input type="date" value={ledgerDateFrom}
                  onChange={(e) => { setLedgerDateFrom(e.target.value); setLedgerMonth(""); }}
                  className="border-[1.5px] rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none"
                  style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>To</label>
                <input type="date" value={ledgerDateTo}
                  onChange={(e) => { setLedgerDateTo(e.target.value); setLedgerMonth(""); }}
                  className="border-[1.5px] rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none"
                  style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
              </div>
              <button type="button"
                onClick={() => { setLedgerDateFrom(""); setLedgerDateTo(""); setLedgerMonth(""); }}
                className="px-3 py-1.5 rounded-[9px] text-[11.5px] font-semibold border-[1.5px] bg-white cursor-pointer mb-0.5"
                style={{ borderColor: "var(--gray-200)", color: "var(--gray-700)" }}>
                All dates
              </button>
            </div>

            <div className="p-5 max-h-[min(60vh,520px)] overflow-auto">
              {ledgerLoading ? (
                <p className="text-[13px] m-0" style={{ color: "var(--gray-600)" }}>Loading…</p>
              ) : ledgerAllRows.length === 0 ? (
                <p className="text-[13px] m-0" style={{ color: "var(--gray-600)" }}>No ledger entries yet for this supplier.</p>
              ) : ledgerDisplayWithBal.length === 0 ? (
                <p className="text-[13px] m-0" style={{ color: "var(--gray-600)" }}>No entries in the selected date range.</p>
              ) : (
                <>
                  {ledgerDateFrom.trim() && ledgerOpeningBefore !== 0 ? (
                    <p className="text-[11px] font-semibold m-0 mb-2" style={{ color: "var(--gray-700)" }}>
                      Opening balance (before {formatDate(ledgerDateFrom)}):{" "}
                      <span className="font-mono" style={{ color: "var(--blue-deeper)" }}>
                        {formatCurrency(Math.abs(ledgerOpeningBefore))}
                      </span>
                      {ledgerOpeningBefore > 0 ? " payable" : ledgerOpeningBefore < 0 ? " receivable" : ""}
                    </p>
                  ) : null}
                  <table className={`${DT.table} min-w-[720px]`}>
                    <thead>
                      <tr>
                        {["Date", "Doc / Ref", "Description", "Debit", "Credit", "Balance", "Method"].map((h) => (
                          <th key={h} className={`${DT.thDense} text-left`} style={DT.thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerDisplayWithBal.map((r, idx) => (
                        <Fragment key={`${r.sortAt}-${idx}`}>
                        <tr className={DT.row}>
                          <td className={`${DT.tdDense} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{formatDate(r.date)}</td>
                          <td className={`${DT.tdDense} font-mono text-[12px]`} style={{ color: "var(--gray-900)" }}>{r.doc}</td>
                          <td className={DT.tdDense} style={{ color: "var(--gray-800)" }}>{r.desc}</td>
                          <td className={`${DT.tdDense} font-mono text-right`} style={{ color: r.debit > 0 ? "var(--red)" : "var(--gray-300)" }}>
                            {r.debit > 0 ? formatCurrency(r.debit) : "—"}
                          </td>
                          <td className={`${DT.tdDense} font-mono text-right`} style={{ color: r.credit > 0 ? "var(--green)" : "var(--gray-300)" }}>
                            {r.credit > 0 ? formatCurrency(r.credit) : "—"}
                          </td>
                          <td className={`${DT.tdDense} font-mono font-bold text-right`}
                            style={{ color: r.balance > 0 ? "var(--red)" : r.balance < 0 ? "var(--green)" : "var(--gray-600)" }}>
                            {formatCurrency(r.balance)}
                          </td>
                          <td className={DT.tdDense}>
                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: "var(--gray-100)", color: "var(--gray-900)" }}>{r.method || "—"}</span>
                          </td>
                        </tr>
                        {r.purchaseOrderId && ledgerItemsByPo[r.purchaseOrderId]?.length > 0 && <tr>
                          <td colSpan={7} className="p-0"><LedgerLineItems items={ledgerItemsByPo[r.purchaseOrderId]} /></td>
                        </tr>}
                        </Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} className={`${DT.tdDense} font-bold text-right border-t-2 border-[var(--gray-200)]`}
                          style={{ color: "var(--gray-700)" }}>
                          Closing balance{(ledgerDateFrom.trim() || ledgerDateTo.trim()) ? " (period)" : ""}
                        </td>
                        <td className={`${DT.tdDense} font-mono font-extrabold text-right border-t-2 border-[var(--gray-200)]`}
                          style={{
                            color: (() => {
                              const b = ledgerDisplayWithBal.at(-1)?.balance ?? 0;
                              if (b > 0) return "var(--red)";
                              if (b < 0) return "var(--green)";
                              return "var(--gray-600)";
                            })(),
                          }}>
                          {formatCurrency(ledgerDisplayWithBal.at(-1)?.balance ?? 0)}
                        </td>
                        <td className={`${DT.tdDense} border-t-2 border-[var(--gray-200)]`} />
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </div>

            <div className="flex justify-end px-5 py-3.5 border-t border-[var(--gray-100)]">
              <button type="button" onClick={closeLedgerModal}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Off-screen / print-only A4 layout — mirrors the A4 invoice template (header bar, colors, borders, totals, footer) */}
      {ledgerSupplier && (
        <div ref={ledgerPdfRef} className="ledger-a4-print-only" style={{ background: "#fff", fontFamily: "Arial, Helvetica, sans-serif", color: "#111", fontSize: 11 }}>
          <PrintHeader />

          {/* Title bar — matches A4 invoice */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 12px", background: "#075985", color: "#fff", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase" }}>Supplier Ledger</span>
            <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13 }}>
              {(ledgerDateFrom.trim() || ledgerDateTo.trim())
                ? `${ledgerDateFrom.trim() ? formatDate(ledgerDateFrom.trim()) : "Start"} — ${ledgerDateTo.trim() ? formatDate(ledgerDateTo.trim()) : "End"}`
                : "All Transactions"}
            </span>
          </div>

          {/* Statement-for / date block — matches the invoice "Bill To" header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "0 12px", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 8, color: "#111", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Statement For</div>
              <div style={{ fontWeight: 900, color: "#111", fontSize: 16, lineHeight: 1.2 }}>{ledgerSupplier.name}</div>
              {ledgerSupplier.phone ? <div style={{ fontSize: 11, color: "#111", marginTop: 3 }}>{ledgerSupplier.phone}</div> : null}
              {ledgerDateFrom.trim() && ledgerOpeningBefore !== 0 ? (
                <div style={{ fontSize: 10, color: "#111", marginTop: 6, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700 }}>Opening balance (before {formatDate(ledgerDateFrom.trim())}): </span>
                  {formatCurrency(Math.abs(ledgerOpeningBefore))}{ledgerOpeningBefore > 0 ? " payable" : " receivable"}
                </div>
              ) : null}
            </div>
            <div style={{ textAlign: "right", minWidth: 160 }}>
              <div style={{ marginBottom: 5, display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 8, color: "#111", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>Printed:</span>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{formatDate(todayISO())}</span>
              </div>
              <div style={{ marginTop: 4, textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: 10, color: "#111" }}>S.S. Diagnostics</div>
              </div>
            </div>
          </div>

          {ledgerAllRows.length === 0 ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <p style={{ padding: "12px 12px", fontSize: 12, color: "#111", margin: 0 }}>No ledger entries for this supplier.</p>
            </div>
          ) : ledgerDisplayWithBal.length === 0 ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <p style={{ padding: "12px 12px", fontSize: 12, color: "#111", margin: 0 }}>No entries in the selected date range.</p>
            </div>
          ) : (() => {
            const gridCols = "11% 16% 32% 10% 10% 10% 11%";
            const cellPad = "6px 8px";
            return (
              <div style={{ padding: "0 12px", marginBottom: 12, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: 13 }}>
                <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "#075985", color: "#fff" }}>
                  {[
                    { label: "Date", align: "left" as const },
                    { label: "Doc / Ref", align: "left" as const },
                    { label: "Description", align: "left" as const },
                    { label: "Debit", align: "right" as const },
                    { label: "Credit", align: "right" as const },
                    { label: "Balance", align: "right" as const },
                    { label: "Method", align: "left" as const },
                  ].map((h, i, arr) => (
                    <div
                      key={h.label}
                      style={{
                        padding: "6px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        textAlign: h.align,
                        textTransform: "uppercase",
                        letterSpacing: 0.7,
                        borderLeft: "1px solid #000",
                        ...(i === arr.length - 1 ? { borderRight: "1px solid #000" } : {}),
                      }}
                    >
                      {h.label}
                    </div>
                  ))}
                </div>

                {ledgerDisplayWithBal.map((r, idx) => (
                  <Fragment key={`${r.sortAt}-p-${idx}`}>
                  <div
                    style={{ display: "grid", gridTemplateColumns: gridCols, background: idx % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #000" }}
                  >
                    <div style={{ padding: cellPad, color: "#111", borderLeft: "1px solid #000" }}>{formatDate(r.date)}</div>
                    <div style={{ padding: cellPad, fontWeight: 800, color: "#075985", fontFamily: "monospace", borderLeft: "1px solid #000" }}>{r.doc}</div>
                    <div style={{ padding: cellPad, color: "#111", borderLeft: "1px solid #000" }}>{r.desc}</div>
                    <div style={{ padding: cellPad, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: r.debit > 0 ? "#111" : "#ccc", borderLeft: "1px solid #000" }}>
                      {r.debit > 0 ? formatCurrency(r.debit) : "—"}
                    </div>
                    <div style={{ padding: cellPad, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: r.credit > 0 ? "#111" : "#ccc", borderLeft: "1px solid #000" }}>
                      {r.credit > 0 ? formatCurrency(r.credit) : "—"}
                    </div>
                    <div style={{ padding: cellPad, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: "#111", borderLeft: "1px solid #000" }}>
                      {formatCurrency(r.balance)}
                    </div>
                    <div style={{ padding: cellPad, color: "#333", borderLeft: "1px solid #000", borderRight: "1px solid #000" }}>
                      {r.method || "—"}
                    </div>
                  </div>
                  {r.purchaseOrderId && ledgerItemsByPo[r.purchaseOrderId]?.length > 0 && <div style={{ border: "1px solid #000", borderTop: 0 }}>
                    <LedgerLineItems items={ledgerItemsByPo[r.purchaseOrderId]} />
                  </div>}
                  </Fragment>
                ))}

                <div style={{ flex: 1, display: "grid", gridTemplateColumns: gridCols, borderBottom: "1px solid #000" }}>
                  <div style={{ borderLeft: "1px solid #000" }} />
                  <div style={{ borderLeft: "1px solid #000" }} />
                  <div style={{ borderLeft: "1px solid #000" }} />
                  <div style={{ borderLeft: "1px solid #000" }} />
                  <div style={{ borderLeft: "1px solid #000" }} />
                  <div style={{ borderLeft: "1px solid #000" }} />
                  <div style={{ borderLeft: "1px solid #000", borderRight: "1px solid #000" }} />
                </div>
              </div>
            );
          })()}

          {/* Closing balance — mirrors invoice totals box */}
          {ledgerDisplayWithBal.length > 0 ? (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px", marginBottom: 16 }}>
              <div style={{ width: 260 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 10px", borderTop: "2px solid #111" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Closing Balance{(ledgerDateFrom.trim() || ledgerDateTo.trim()) ? " (period)" : ""}
                  </span>
                  <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 14, color: "#111" }}>
                    {formatCurrency(ledgerDisplayWithBal.at(-1)?.balance ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <PrintFooter />
        </div>
      )}
    </>
  );
}

function PoModal({
  draft,
  setDraft,
  suppliers,
  savedPOs,
  excludePoId,
  paymentMethods,
  onClose,
  onSave,
  saving,
  draftPdfBusy,
  onPrintDraft,
  onDownloadDraft,
  isEdit,
}: {
  draft: PoDraft;
  setDraft: React.Dispatch<React.SetStateAction<PoDraft | null>>;
  suppliers: SupplierRow[];
  savedPOs: SavedPO[];
  excludePoId?: string | null;
  paymentMethods: { id: string; name: string }[];
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  draftPdfBusy: boolean;
  onPrintDraft: () => void;
  onDownloadDraft: () => void;
  isEdit?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const [products, setProducts] = useState<{ id: string; code: string | null; name: string; cost_price: number; expiry_date: string | null }[]>([]);
  useEffect(() => {
    let active = true;
    void db.from("products").select("id, code, name, cost_price, expiry_date").order("name").then(({ data, error }) => {
      if (!active) return;
      if (error) { showToast(error.message, "err"); return; }
      setProducts(data ?? []);
    });
    return () => { active = false; };
  }, []);

  const selectProduct = (idx: number, id: string) => {
    const product = products.find(p => p.id === id);
    // Preserve legacy descriptions and deleted catalogue selections.
    if (id && !product) return;
    setDraft(d => {
      if (!d) return null;
      const items = [...d.items];
      items[idx] = calcLine({ ...items[idx], productId: product?.id ?? null,
        description: product?.name ?? "", expiryDate: product?.expiry_date?.slice(0, 10) ?? null,
        rate: product ? Number(product.cost_price) : 0 });
      return { ...d, items };
    });
  };

  const updateLine = (idx: number, field: keyof PoLine, value: string | number | null) => {
    setDraft((d) => {
      if (!d) return null;
      const items = [...d.items];
      let line = { ...items[idx], [field]: value } as PoLine;
      line = calcLine(line);
      items[idx] = line;
      return { ...d, items };
    });
  };

  const addLine = () => {
    setDraft((d) => (d ? { ...d, items: [...d.items, blankLine()] } : null));
  };

  const removeLine = (idx: number) => {
    setDraft((d) => {
      if (!d || d.items.length <= 1) return d;
      return { ...d, items: d.items.filter((_, i) => i !== idx) };
    });
  };

  const items = draft.items.map((it) => calcLine(it));
  const grandTotal = items.reduce((s, it) => s + it.amount, 0);
  const { amountPaid: paidPreview } = computePoPayment(grandTotal, draft.amountPaid);
  const sup = suppliers.find((x) => x.id === draft.supplierId);
  const filteredPos = excludePoId ? savedPOs.filter((p) => p.id !== excludePoId) : savedPOs;
  const previousBalance = sup ? estimatedSupplierPayable(sup.id, sup.opening_balance, filteredPos) : 0;
  const totalRemaining = Math.round((previousBalance + grandTotal - paidPreview) * 100) / 100;

  const sm =
    "border border-[var(--gray-200)] rounded-[6px] px-2 py-1.5 text-[12px] outline-none bg-white focus:border-[var(--blue)] w-full";

  return (
    <>
    <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-4 sm:pt-8 px-3 pb-8 overflow-y-auto no-print">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/35 border-none cursor-default" onClick={() => { if (!saving) onClose(); }} />
      <div
        className="relative z-10 w-full max-w-[1000px] bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--gray-100)]"
          style={{ background: "var(--blue-deeper)" }}
        >
          <div>
            <h2 className="text-[15px] font-extrabold text-white tracking-tight">{isEdit ? "Edit purchase invoice" : "New purchase invoice"}</h2>
            <p className="text-[11px] text-white/75 mt-0.5 font-mono font-bold">{draft.poNumber || "Auto-assigned on save"}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onPrintDraft}
              disabled={saving || draftPdfBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border-[1.5px] text-[11px] font-bold cursor-pointer text-white hover:bg-white/10 disabled:opacity-40"
              style={{ borderColor: "rgba(255,255,255,0.35)" }}
            >
              {draftPdfBusy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              Print
            </button>
            <button
              type="button"
              onClick={onDownloadDraft}
              disabled={saving || draftPdfBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border-[1.5px] text-[11px] font-bold cursor-pointer text-white hover:bg-white/10 disabled:opacity-40"
              style={{ borderColor: "rgba(255,255,255,0.35)" }}
            >
              {draftPdfBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              PDF
            </button>
            <button
              type="button"
              onClick={() => { if (!saving) onClose(); }}
              disabled={saving}
              className="w-9 h-9 rounded-[8px] flex items-center justify-center border-none cursor-pointer text-white hover:bg-white/10 disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
              Supplier *
              <select
                className={`mt-1 ${sm}`}
                value={draft.supplierId}
                disabled={isEdit}
                onChange={(e) => setDraft((d) => (d ? { ...d, supplierId: e.target.value } : null))}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
              Order date
              <input
                type="date"
                className={`mt-1 ${sm}`}
                value={draft.orderDate}
                onChange={(e) => setDraft((d) => (d ? { ...d, orderDate: e.target.value } : null))}
              />
            </label>
            {!isEdit && (
              <label className="block text-[11px] font-bold uppercase tracking-wide col-span-2" style={{ color: "var(--gray-700)" }}>
                Paid now (optional)
                <input
                  className={`mt-1 ${sm}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.amountPaid}
                  onChange={(e) => setDraft((d) => (d ? { ...d, amountPaid: e.target.value } : null))}
                />
                <span className="block mt-1 text-[10px] font-normal normal-case font-sans" style={{ color: "var(--gray-600)" }}>
                  Recorded as <b>Debit (out)</b> in Cash Book — reduces <b>cash in hand</b> by this amount.
                </span>
              </label>
            )}
            {isEdit && (
              <div className="col-span-2 rounded-[9px] px-3 py-2.5 text-[12px]" style={{ background: "var(--blue-pale)", color: "var(--gray-800)" }}>
                <b>Payments are not changed when editing.</b> Use <em>Pay supplier</em> to record additional payments.
              </div>
            )}
          </div>

          {!isEdit && (
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>How paid</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDraft((d) => (d ? { ...d, payMethod: m.name } : null))}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border-[1.5px] transition-all"
                    style={{
                      borderColor: draft.payMethod === m.name ? "var(--blue)" : "var(--gray-200)",
                      background: draft.payMethod === m.name ? "var(--blue-light)" : "white",
                      color: draft.payMethod === m.name ? "var(--blue-deeper)" : "var(--gray-800)",
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>
            Notes (optional)
            <textarea
              className="mt-1 w-full border border-[var(--gray-200)] rounded-lg px-3 py-2 text-[13px] min-h-[64px]"
              value={draft.notes}
              onChange={(e) => setDraft((d) => (d ? { ...d, notes: e.target.value } : null))}
              placeholder="Order / delivery notes"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-700)" }}>Line items</span>
              <button type="button" onClick={addLine} className="text-[11px] font-bold text-[var(--blue)] flex items-center gap-1">
                <Plus size={12} /> Add line
              </button>
            </div>
            <p className="text-xs mb-2 text-[var(--gray-700)]">New purchase invoices add stock. Sales use the oldest purchase batch first.</p>
            <div className="overflow-x-auto border border-[var(--gray-100)] rounded-xl">
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ background: "var(--gray-50)" }}>
                    {["#", "Product", "Expiry", "Qty", "Rate", "Amount", ""].map((h) => (
                      <th key={h} className="text-left px-2 py-2 font-bold text-[10px] uppercase tracking-wide" style={{ color: "var(--gray-600)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.items.map((it, idx) => {
                    const calc = calcLine(it);
                    return (
                      <tr key={idx} className="border-t border-[var(--gray-100)]">
                        <td className="px-2 py-2 text-[var(--gray-500)] w-8">{idx + 1}</td>
                        <td className="px-2 py-2 min-w-[160px]">
                          <SearchableSelect
                            value={it.productId ?? it.description}
                            onChange={(value) => selectProduct(idx, value)}
                            options={[
                              ...products.map(p => ({ value: p.id, label: `${p.code ? `#${p.code} - ` : ""}${p.name}` })),
                              ...(!it.productId && it.description ? [{ value: it.description, label: it.description }] : []),
                              ...(it.productId && !products.some(p => p.id === it.productId) ? [{ value: it.productId, label: it.description }] : []),
                            ]}
                            placeholder="Select product"
                            inputClassName={sm}
                          />
                          {it.id && it.stockReceivedQty === 0 && <p className="mt-1 text-[10px] text-[var(--gray-700)]">Historical purchase; existing stock is counted in opening batches.</p>}
                        </td>
                        <td className="px-2 py-2 min-w-[120px] text-[var(--gray-700)]">
                          <label className="block text-[10px] font-semibold mb-1">Expiry date
                            <input type="date" value={it.expiryDate ?? ""} disabled={!it.productId || saving || !it.expiryDate}
                              onChange={event => updateLine(idx, "expiryDate", event.target.value || null)} className={sm} />
                          </label>
                          <label className="inline-flex items-center gap-1.5 text-[11px]">
                            <input type="checkbox" checked={!it.expiryDate} disabled={!it.productId || saving}
                              onChange={event => updateLine(idx, "expiryDate", event.target.checked ? null : todayISO())} /> Non-expiry
                          </label>
                        </td>
                        <td className="px-2 py-2 w-20">
                          <input
                            type="number"
                            className={sm}
                            value={it.qty || ""}
                            min={0.01}
                            step={0.01}
                            placeholder="Qty"
                            onChange={(e) => updateLine(idx, "qty", parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-2 py-2 w-28">
                          <input
                            type="number"
                            className={sm}
                            value={it.rate || ""}
                            onChange={(e) => updateLine(idx, "rate", parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-2 py-2 font-mono font-bold w-28" style={{ color: "var(--blue-deeper)" }}>
                          {formatCurrency(calc.amount)}
                        </td>
                        <td className="px-1 py-2 w-10">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            disabled={draft.items.length <= 1}
                            className="p-1.5 rounded-lg text-[var(--red)] disabled:opacity-30"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div
            className="rounded-xl border border-[var(--gray-100)] p-4 space-y-2"
            style={{ background: "var(--gray-50)" }}
          >
            <div className="flex justify-between text-[12px] font-bold">
              <span style={{ color: "var(--gray-700)" }}>Previous Balance</span>
              <span className="font-mono" style={{ color: previousBalance > 0 ? "var(--red)" : "var(--gray-500)" }}>{formatCurrency(previousBalance)}</span>
            </div>
            <div className="flex justify-between text-[12px] font-bold">
              <span style={{ color: "var(--gray-700)" }}>Current Bill</span>
              <span className="font-mono" style={{ color: "var(--blue-deeper)" }}>{formatCurrency(grandTotal)}</span>
            </div>
            <div className="flex justify-between text-[12px] font-bold">
              <span style={{ color: "var(--gray-700)" }}>Payment</span>
              <span className="font-mono" style={{ color: "var(--green)" }}>{formatCurrency(paidPreview)}</span>
            </div>
            <div className="flex justify-between text-[12px] font-bold">
              <span style={{ color: "var(--gray-700)" }}>Remaining</span>
              <span className="font-mono" style={{ color: totalRemaining > 0 ? "var(--red)" : "var(--green)" }}>
                {formatCurrency(totalRemaining)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--gray-100)] bg-[var(--gray-50)]">
          <button
            type="button"
            onClick={() => { if (!saving) onClose(); }}
            disabled={saving}
            className="px-5 py-2.5 rounded-[9px] border border-[var(--gray-200)] text-[12px] font-bold cursor-pointer bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || grandTotal <= 0}
            className="px-5 py-2.5 rounded-[9px] border-none text-[12px] font-bold cursor-pointer text-white disabled:opacity-45"
            style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}
          >
            {saving ? <Loader2 size={16} className="animate-spin inline" /> : isEdit ? "Update purchase invoice" : "Save purchase invoice"}
          </button>
        </div>
      </div>
    </div>

    </>
  );
}
