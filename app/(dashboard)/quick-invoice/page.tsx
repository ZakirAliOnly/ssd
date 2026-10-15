"use client";

import { invoiceUnitRate, invoiceLineTotal } from "@/lib/invoicePricing";
import { InvoiceDiscountSummary } from "@/components/InvoiceDiscountSummary";
import { InvoiceLineDiscount } from "@/components/InvoiceLineDiscount";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, saveInvoice } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import { Plus, Printer, Trash2, FileText, Clock, X, Loader2, Download, Wallet } from "lucide-react";
import { PrintHeader } from "@/components/PrintHeader";
import { DT } from "@/lib/dataTableStyles";
import type { Invoice } from "@/lib/database.types";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { openWhatsAppMessageOnlyNewTab, openWhatsAppNewTab, buildInvoiceShareWhatsAppMessage } from "@/lib/whatsappWaMe";
import { normalizePaymentMethod, usePaymentMethods, type PaymentMethod } from "@/lib/paymentMethods";
import { createExpense } from "@/lib/expenses";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";
import { SearchableSelect } from "@/components/SearchableSelect";
import { confirmDialog } from "@/components/ConfirmModal";
import { logActivity } from "@/lib/activityLog";
import { ProductCreateModal } from "@/components/ProductCreateModal";

interface InvoiceProduct {
  id: string;
  code: string | null;
  name: string;
  sale_price: number;
  description?: string | null;
  pricing_type?: string | null;
  expiry_date?: string | null;
  quantity?: number;
  product_categories?: { name: string } | null;
}

function productMetadata(products: InvoiceProduct[], productId: string | null | undefined, name: string) {
  const product = products.find((p) => productId ? p.id === productId : p.name.toLowerCase() === name.toLowerCase());
  return { serialNumber: product?.code ?? "", productCategory: product?.product_categories?.name ?? "" };
}

interface Item {
  lineType: "product" | "labor";
  product: string;
  productId?: string | null;
  discountPct?: number;
  laborType: string;
  description: string;
  width: number;
  height: number;
  sqft: number;
  rate: number;
  qty: number;
  total: number;
  pricingType: "standalone";
}

interface WalkInDraft {
  invoiceNumber: string;
  clientName: string;
  /** Optional — PDF + WhatsApp sends here when valid */
  clientPhone: string;
  /** Optional — stored as invoices.job_notes */
  description: string;
  /** Amount collected at invoice time (optional) */
  amountPaid: string;
  payMethod: PaymentMethod;
  discountType: "pct" | "flat";
  discountValue: string;
  items: Item[];
  editingInvoiceId?: string;
  /** When ticked, a pending expense is created for this invoice and the user is
   *  taken to the Expense module to fill in the amount/category. */
  addToExpense: boolean;
}

interface SavedInvoice {
  subtotal?: number;
  discount_amount?: number;
  discount_type?: "pct" | "flat";
  discount_value?: number;
  id: string;
  invoice_number: string;
  client_name: string;
  invoice_date: string;
  grand_total: number;
  amount_received: number;
  previous_balance?: number;
  balance_due: number;
  payment_status: string;
  payment_method?: string;
  created_by_name?: string;
  created_by_email?: string;
}

/** Data rendered into the hidden PDF template (matches Cashbook / Invoice Report print design). */
interface InvoicePdfPayload {
  invoice: {
    invoice_number: string;
    client_name: string;
    client_phone: string;
    invoice_date: string;
    payment_status: string;
    subtotal: number;
    discount_amount?: number;
    discount_type?: "pct" | "flat";
    discount_value?: number;
    grand_total: number;
    previous_balance: number;
    amount_received: number;
    balance_due: number;
    payment_method: string;
    description: string;
    gst_pct: number;
    gst_amount: number;
    stax_pct: number;
    stax_amount: number;
    bra_pct: number;
    bra_amount: number;
  };
  items: Array<{
    serialNumber: string;
    productCategory: string;
    category: string;
    description: string;
    width: number;
    height: number;
    sqft: number;
    rate: number;
    qty: number;
    amount: number;
    discount_pct?: number;
  }>;
}

function blankItem(): Item {
  return { lineType: "product", product: "", laborType: "", description: "", width: 0, height: 0, sqft: 0, rate: 0, qty: 1, total: 0, pricingType: "standalone" };
}

function calcItem(item: Item): Item {
  return { ...item, width: 0, height: 0, sqft: 0, pricingType: "standalone", total: invoiceLineTotal(item.rate, item.qty, item.discountPct ?? 0) };
}

function computeWalkInPayment(draft: WalkInDraft) {
  const subtotal = draft.items.reduce((s, it) => s + it.total, 0);
  const rawDiscount = parseFloat(String(draft.discountValue).replace(/,/g, "")) || 0;
  const discountAmount =
    draft.discountType === "pct"
      ? Math.min(Math.max(0, rawDiscount), 100) * (subtotal / 100)
      : Math.min(Math.max(0, rawDiscount), subtotal);
  const grandTotal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const paidParsed = parseFloat(String(draft.amountPaid).replace(/,/g, "")) || 0;
  const amountReceived = Math.min(Math.max(0, paidParsed), grandTotal);
  const balanceDue = Math.round((grandTotal - amountReceived) * 100) / 100;
  const paymentStatus: "unpaid" | "partial" | "paid" =
    balanceDue <= 0 ? "paid" : amountReceived > 0 ? "partial" : "unpaid";
  return { subtotal, discountAmount, grandTotal, amountReceived, balanceDue, paymentStatus };
}

type WalkInDashStats = {
  todayInvoices: number;
  todaySales: number;
  todayReceived: number;
  todayPending: number;
  totalInvoices: number;
  totalSales: number;
  totalReceived: number;
  totalPending: number;
};

const EMPTY_WALK_IN_DASH: WalkInDashStats = {
  todayInvoices: 0,
  todaySales: 0,
  todayReceived: 0,
  todayPending: 0,
  totalInvoices: 0,
  totalSales: 0,
  totalReceived: 0,
  totalPending: 0,
};

export default function InvoicePage() {
  const userProfile = useUser();
  const router = useRouter();
  const { methods: paymentMethods } = usePaymentMethods();
  const [products, setProducts] = useState<InvoiceProduct[]>([]);
  const [nextNum, setNextNum] = useState(1);
  const [savedInvoices, setSavedInvoices] = useState<SavedInvoice[]>([]);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string; category: string }[]>([]);
  const [draft, setDraft] = useState<WalkInDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const [payInvoice, setPayInvoice] = useState<SavedInvoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("Cash");
  const [payDate, setPayDate] = useState("");
  const [paySaving, setPaySaving] = useState(false);

  const invoicePdfRef = useRef<HTMLDivElement>(null);
  const [invoicePdfData, setInvoicePdfData] = useState<InvoicePdfPayload | null>(null);
  const [generatingPdfFor, setGeneratingPdfFor] = useState<string | null>(null);
  const [printingPdfFor, setPrintingPdfFor] = useState<string | null>(null);
  const [draftPdfBusy, setDraftPdfBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [walkInDash, setWalkInDash] = useState<WalkInDashStats>(EMPTY_WALK_IN_DASH);
  const [walkInDashLoading, setWalkInDashLoading] = useState(true);

  const refreshWalkInStats = useCallback(async () => {
    setWalkInDashLoading(true);
    const { data: invRows, error: invErr } = await db
      .from("invoices")
      .select("grand_total, amount_received, balance_due, invoice_date, client_name")
      .eq("is_walk_in", true);
    if (invErr) {
      showToast(invErr.message, "err");
      setWalkInDash(EMPTY_WALK_IN_DASH);
      setWalkInDashLoading(false);
      return;
    }
    const walk = (invRows ?? []) as { invoice_date: string; grand_total: number | string; amount_received: number | string; balance_due: number | string }[];
    const t = todayISO();
    const walkToday = walk.filter((i) => i.invoice_date === t);
    const n = (x: unknown) => Number(x) || 0;
    setWalkInDash({
      todayInvoices: walkToday.length,
      todaySales: Math.round(walkToday.reduce((s, i) => s + n(i.grand_total), 0) * 100) / 100,
      todayReceived: Math.round(walkToday.reduce((s, i) => s + n(i.amount_received), 0) * 100) / 100,
      todayPending: Math.round(walkToday.reduce((s, i) => s + n(i.balance_due), 0) * 100) / 100,
      totalInvoices: walk.length,
      totalSales: Math.round(walk.reduce((s, i) => s + n(i.grand_total), 0) * 100) / 100,
      totalReceived: Math.round(walk.reduce((s, i) => s + n(i.amount_received), 0) * 100) / 100,
      totalPending: Math.round(walk.reduce((s, i) => s + n(i.balance_due), 0) * 100) / 100,
    });
    setWalkInDashLoading(false);
  }, []);

  const fetchSaved = useCallback(async () => {
    const [{ data: invData }, { data: acctData }] = await Promise.all([
      db
        .from("invoices")
        .select("id, invoice_number, client_name, invoice_date, grand_total, amount_received, previous_balance, balance_due, payment_status, payment_method, created_by_name, created_by_email, subtotal, discount_amount, discount_type, discount_value")
        .eq("is_walk_in", true)
        .order("created_at", { ascending: false })
        .limit(50),
      db.from("accounts").select("id, name, head_accounts(name)").order("name"),
    ]);
    if (invData) setSavedInvoices(invData as SavedInvoice[]);
    if (acctData) {
      setAllAccounts(
        (acctData as Array<{ id: string; name: string; head_accounts?: { name?: string } | null }>).map((a) => {
          const headName = String(a.head_accounts?.name ?? "").trim().toLowerCase();
          const category =
            headName.includes("government") ? "Government" :
            headName.includes("press") ? "Press" :
            headName.includes("shop") ? "Shop" :
            "Others";
          return { id: a.id, name: a.name, category };
        })
      );
    }
  }, []);

  const accountNameSet = useMemo(() => new Set(allAccounts.map((a) => a.name)), [allAccounts]);
  const accountCategoryByName = useMemo(() => {
    const m = new Map<string, string>();
    allAccounts.forEach((a) => m.set(a.name, a.category));
    return m;
  }, [allAccounts]);
  const walkInSavedInvoices = savedInvoices; // already filtered to is_walk_in=true at fetch time
  const filteredInvoices = walkInSavedInvoices;

  function openPayModal(inv: SavedInvoice) {
    setPayInvoice(inv);
    setPayAmount(String(Number(inv.balance_due)));
    setPayMethod(normalizePaymentMethod(inv.payment_method));
    setPayDate(todayISO());
  }

  async function confirmPayBalance() {
    if (!payInvoice) return;
    const inv = payInvoice;
    const balanceDue = Number(inv.balance_due);
    const parsed = parseFloat(String(payAmount).replace(/,/g, "")) || 0;
    const amt = Math.round(Math.min(Math.max(0, parsed), balanceDue) * 100) / 100;
    if (balanceDue <= 0 || amt <= 0) {
      showToast("Enter a valid amount up to the balance due", "err");
      return;
    }
    if (!payMethod || !payMethod.trim()) {
      showToast("Please select a payment method", "err"); return;
    }
    if (!paymentMethods.some((m) => m.name === payMethod)) {
      showToast("Select a valid payment method", "err"); return;
    }

    setPaySaving(true);
    const newReceived = Math.round((Number(inv.amount_received) + amt) * 100) / 100;
    const newBalance = Math.round((Number(inv.grand_total) - newReceived) * 100) / 100;
    const status: "unpaid" | "partial" | "paid" =
      newBalance <= 0 ? "paid" : newReceived > 0 ? "partial" : "unpaid";

    const { error: invErr } = await db
      .from("invoices")
      .update({
        amount_received: newReceived,
        balance_due: newBalance,
        payment_status: status,
      })
      .eq("id", inv.id);
    if (invErr) {
      showToast(invErr.message, "err");
      setPaySaving(false);
      return;
    }

    // Walk-in invoices are always independent of party accounts, regardless of matching names
    const { error: cbErr } = await db.from("cashbook").insert({
      type: "in",
      description: `Walk-in ${inv.invoice_number} — ${inv.client_name}`,
      amount: amt,
      date: payDate.trim() || todayISO(),
      account_name: "",
      method: payMethod,
      reference: inv.id,
    });
    if (cbErr) {
      showToast(cbErr.message, "err");
      setPaySaving(false);
      return;
    }

    showToast("Payment recorded", "ok");
    setPayInvoice(null);
    setPaySaving(false);
    void fetchSaved();
    void refreshWalkInStats();
  }

  const refreshCount = useCallback(async () => {
    const [{ data: qiData }, { data: invData }] = await Promise.all([
      db.from("quick_invoices").select("invoice_number").order("created_at", { ascending: false }).limit(1),
      db.from("invoices").select("invoice_number").order("created_at", { ascending: false }).limit(1),
    ]);
    let maxNum = 0;
    [qiData?.[0], invData?.[0]].forEach((row) => {
      if (row?.invoice_number) {
        const m = (row.invoice_number as string).match(/(\d+)$/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
    });
    setNextNum(maxNum + 1);
  }, []);

  const fetchProducts = useCallback(async () => {
    const { data } = await db.from("products").select("id, code, name, sale_price, description, pricing_type, expiry_date, quantity, product_categories(name)");
    if (data) {
      const sorted = [...data].sort((a, b) => {
        const an = parseInt(String(a.code ?? ""), 10);
        const bn = parseInt(String(b.code ?? ""), 10);
        if (Number.isNaN(an) && Number.isNaN(bn)) return String(a.code ?? "").localeCompare(String(b.code ?? ""));
        if (Number.isNaN(an)) return 1;
        if (Number.isNaN(bn)) return -1;
        return an - bn;
      });
      setProducts(sorted);
      return sorted;
    }
    return [];
  }, []);

  useEffect(() => {
    refreshCount();
    fetchSaved();
    void refreshWalkInStats();
    void fetchProducts();
  }, [refreshCount, fetchSaved, refreshWalkInStats, fetchProducts]);

  // ── Inline product-create modal state (triggered from product picker rows) ──
  const [productCreate, setProductCreate] = useState<{ idx: number; initialName: string } | null>(null);
  // Tracks products inserted via the inline modal during this draft. Deleted if the
  // user cancels the invoice; cleared (kept) if the invoice saves successfully.
  const pendingProductIdsRef = useRef<string[]>([]);
  const invoiceSaveRef = useRef(false);

  const handleProductCreated = useCallback(async (newProduct: { id: string; name: string; sale_price: number; description?: string | null; pricing_type?: string | null; expiry_date?: string | null; quantity?: number }) => {
    pendingProductIdsRef.current.push(newProduct.id);
    await fetchProducts();
    const idx = productCreate?.idx;
    setProductCreate(null);
    if (typeof idx !== "number") return;
    setDraft((d) => {
      if (!d) return d;
      const items = [...d.items];
      const cur = items[idx];
      if (!cur) return d;
      const isStandalone = newProduct.pricing_type === "standalone";
      let item: Item = {
        ...cur,
        product: newProduct.name,
        productId: newProduct.id,
        rate: Number(newProduct.sale_price) || 0,
        pricingType: "standalone",
      };
      if (isStandalone) item = { ...item, width: 0, height: 0, sqft: 0 };
      if (!item.description.trim() && newProduct.description?.trim()) {
        item = { ...item, description: newProduct.description.trim() };
      }
      items[idx] = calcItem(item);
      return { ...d, items };
    });
  }, [fetchProducts, productCreate]);

  /** Run cleanup after the browser print dialog closes (or fallback timeout). Keeps PDF data in DOM until then. */
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

  /** Prevent stuck loading states when browser/network hangs before print opens. */
  async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  }

  function openModal() {
    void fetchProducts();
    setDraft({
      invoiceNumber: `SSD${String(nextNum).padStart(3, "0")}`,
      clientName: "",
      clientPhone: "",
      description: "",
      amountPaid: "",
      payMethod: "Cash",
      discountType: "pct",
      discountValue: "",
      items: [blankItem()],
      addToExpense: false,
    });
  }

  async function closeModal() {
    const pending = pendingProductIdsRef.current;
    if (pending.length > 0) {
      pendingProductIdsRef.current = [];
      await db.from("products").delete().in("id", pending);
      void fetchProducts();
    }
    setDraft(null);
  }

  async function reopenInvoice(inv: SavedInvoice) {
    const { data: full, error: invErr } = await db
      .from("invoices")
      .select("id, invoice_number, client_name, client_phone, job_notes, amount_received, payment_method, discount_type, discount_value")
      .eq("id", inv.id)
      .single();
    if (invErr || !full) {
      showToast(invErr?.message || "Could not load invoice", "err");
      return;
    }
    const { data: rows, error: itemErr } = await db
      .from("invoice_items")
      .select("product_id, category, description, width, height, sqft, rate, qty, amount, discount_pct")
      .eq("invoice_id", inv.id)
      .order("id", { ascending: true });
    if (itemErr) {
      showToast(itemErr.message, "err");
      return;
    }
    const mapped = ((rows ?? []) as Record<string, unknown>[]).map((r) => {
      const productName = String(r.category ?? "");
      const dbProd = products.find((p) => r.product_id ? p.id === String(r.product_id) : p.name === productName);
      const pricingType = "standalone" as const;
      return {
        lineType: "product" as const,
        product: productName,
        productId: r.product_id ? String(r.product_id) : dbProd?.id ?? null,
        laborType: "",
        description: String(r.description ?? ""),
        width: 0,
        height: 0,
        sqft: 0,
        rate: invoiceUnitRate(r),
        discountPct: Number(r.discount_pct ?? 0),
        qty: Number(r.qty) || 1,
        total: Number(r.amount) || 0,
        pricingType,
      };
    });
    setDraft({
      invoiceNumber: String(full.invoice_number ?? inv.invoice_number),
      clientName: String(full.client_name ?? inv.client_name),
      clientPhone: String(full.client_phone ?? ""),
      description: String(full.job_notes ?? ""),
      amountPaid: String(Number(full.amount_received) || 0),
      payMethod: normalizePaymentMethod(String(full.payment_method ?? inv.payment_method ?? "Cash")),
      discountType: String(full.discount_type) === "flat" ? "flat" : "pct",
      discountValue: String(Number(full.discount_value) || 0),
      items: mapped.length ? mapped : [blankItem()],
      editingInvoiceId: inv.id,
      // Expense flag is create-only; not shown when reopening an invoice.
      addToExpense: false,
    });
  }

  async function handleSave() {
    if (invoiceSaveRef.current) return;
    invoiceSaveRef.current = true;
    try {
      if (!draft) return;

      const clientName = draft.clientName.trim() || "Walk-in Customer";
      if (draft.items.some((it) => Number(it.qty) < 1)) {
        showToast("Each item must have a quantity of at least 1", "err");
        return;
      }
      const { subtotal, discountAmount, grandTotal, amountReceived, balanceDue, paymentStatus } = computeWalkInPayment(draft);
      if (grandTotal <= 0) {
        showToast("Add at least one item with a value", "err");
        return;
      }
      if (amountReceived > 0) {
        if (!draft.payMethod || !draft.payMethod.trim()) {
          showToast("Please select a payment method", "err"); return;
        }
        if (!paymentMethods.some((m) => m.name === draft.payMethod)) {
          showToast("Select a valid payment method", "err"); return;
        }
      }

      const stockItems = draft.items.map(it => ({
        product_id: it.lineType === "product" ? (it.productId ?? products.find(p => p.name === it.product)?.id ?? null) : null,
        category: it.lineType === "labor" ? "Labor" : it.product,
        description: it.lineType === "labor" ? it.laborType : it.description.trim(),
        width: it.width, height: it.height, sqft: it.sqft, rate: it.rate, qty: it.qty, amount: it.total, discount_pct: it.discountPct ?? 0,
      }));

      setSaving(true);
      const today = todayISO();
      const inv = draft;
      // Walk-in invoices never carry a party's previous balance — they are independent of party accounts
      const previousBalance = 0;

      let finalInvoiceId = inv.editingInvoiceId ?? "";
      // For a create, this is overwritten with the server-confirmed number once
      // the invoices row is inserted (the server assigns it atomically — see
      // createInvoiceWithUniqueNumber in app/api/db/route.ts). Unchanged on edit.
      let finalInvoiceNumber = inv.invoiceNumber;
      if (inv.editingInvoiceId) {
        const { data: current } = await db
          .from("invoices")
          .select("amount_received")
          .eq("id", inv.editingInvoiceId)
          .single();
        const keepReceived = Math.min(Math.max(0, Number(current?.amount_received) || 0), grandTotal);
        const keepBalance = Math.round((grandTotal - keepReceived) * 100) / 100;
        const keepStatus: "unpaid" | "partial" | "paid" =
          keepBalance <= 0 ? "paid" : keepReceived > 0 ? "partial" : "unpaid";
        const { error: updErr } = await saveInvoice({
            invoice_number: inv.invoiceNumber,
            client_name: clientName,
            client_phone: inv.clientPhone.trim(),
            subtotal,
            grand_total: grandTotal,
            previous_balance: previousBalance,
            amount_received: keepReceived,
            balance_due: keepBalance,
            payment_status: keepStatus,
            payment_method: inv.payMethod,
            discount_type: inv.discountType,
            discount_value: parseFloat(inv.discountValue) || 0,
            discount_amount: discountAmount,
            job_notes: inv.description.trim(),
          }, stockItems, inv.editingInvoiceId);
        if (updErr) {
          showToast(updErr.message, "err");
          setSaving(false);
          return;
        }

        const { data: qRows } = await db
          .from("quick_invoices")
          .select("id")
          .eq("invoice_number", inv.invoiceNumber)
          .limit(1);
        const qid = qRows?.[0]?.id;
        if (qid) {
          await db.from("quick_invoices").update({ client_name: clientName, grand_total: grandTotal }).eq("id", qid);
          await db.from("quick_invoice_items").delete().eq("quick_invoice_id", qid);
          await db.from("quick_invoice_items").insert(
            inv.items.map((it) => ({
              quick_invoice_id: qid,
              product: it.lineType === "labor" ? `Labor: ${it.laborType || "General"}` : it.product,
              description: it.lineType === "labor" ? it.laborType : it.description.trim(),
              width: it.width,
              height: it.height,
              total_size: it.sqft,
              rate_per_sqft: it.rate,
              total: it.total,
              qty: it.qty,
              grand_total: it.total,
            }))
          );
        }
      } else {
        // Save the invoice, canonical items, and stock together — the server assigns invoice_number atomically
        // (with retry on collision), so this is the single source of truth for
        // the number. Whatever `inv.invoiceNumber` shows on screen is only a
        // preview; the confirmed number below is what actually gets saved.
        const { data: invData, error: invErr } = await saveInvoice({
            invoice_number: inv.invoiceNumber,
            client_name: clientName,
            client_phone: inv.clientPhone.trim(),
            invoice_date: today,
            subtotal,
            grand_total: grandTotal,
            previous_balance: previousBalance,
            amount_received: amountReceived,
            balance_due: balanceDue,
            payment_status: paymentStatus,
            payment_method: inv.payMethod,
            discount_type: inv.discountType,
            discount_value: parseFloat(inv.discountValue) || 0,
            discount_amount: discountAmount,
            gst_pct: 0,
            gst_amount: 0,
            stax_pct: 0,
            stax_amount: 0,
            job_notes: inv.description.trim(),
            is_walk_in: true,
          }, stockItems);

        if (invErr) {
          showToast(invErr.message, "err");
          setSaving(false);
          return;
        }

        finalInvoiceId = invData.id;
        finalInvoiceNumber = invData.invoice_number;
        pendingProductIdsRef.current = [];
        setDraft(current => current ? { ...current, editingInvoiceId: invData.id, invoiceNumber: invData.invoice_number } : null);

        // Mirror into quick_invoices (legacy/parallel storage — no unique
        // constraint here) using the CONFIRMED number so both tables agree.
        const { data: qiRows } = await db
          .from("quick_invoices")
          .insert({ invoice_number: finalInvoiceNumber, client_name: clientName, grand_total: grandTotal })
          .select();
        const qiData = qiRows?.[0] ?? null;

        if (qiData) await db.from("quick_invoice_items").insert(
          inv.items.map((it) => ({
            quick_invoice_id: qiData.id,
            product: it.product,
            description: it.description.trim(),
            width: it.width,
            height: it.height,
            total_size: it.sqft,
            rate_per_sqft: it.rate,
            total: it.total,
            qty: it.qty,
            grand_total: it.total,
          }))
        );
      }

      if (!inv.editingInvoiceId && finalInvoiceId && amountReceived > 0) {
        const { error: cbErr } = await db.from("cashbook").insert({
          type: "in",
          description: `Walk-in ${finalInvoiceNumber} — ${clientName}`,
          amount: amountReceived,
          date: today,
          account_name: "",
          method: inv.payMethod,
          reference: finalInvoiceId,
        });
        if (cbErr) {
          showToast(cbErr.message, "err");
          setSaving(false);
          return;
        }
      }

      // If flagged, create a PENDING expense (amount 0, no cash entry yet) linked
      // to this invoice, then send the user to the Expense module to fill in the
      // amount/category — that's where the cash-out gets recorded.
      let goToExpense = false;
      if (!inv.editingInvoiceId && finalInvoiceId && inv.addToExpense) {
        const { error: expErr } = await createExpense({
          category: "",
          description: `${finalInvoiceNumber} · ${clientName}`,
          amount: 0,
          method: inv.payMethod,
          date: today,
          invoiceId: finalInvoiceId,
          invoiceNumber: finalInvoiceNumber,
        });
        if (expErr) {
          showToast(expErr, "err");
          setSaving(false);
          return;
        }
        goToExpense = true;
      }

      showToast(inv.editingInvoiceId ? `Invoice ${finalInvoiceNumber} updated!` : `Invoice ${finalInvoiceNumber} saved!`, "ok");
      pendingProductIdsRef.current = [];
      setDraft(null);
      setSaving(false);
      void fetchProducts();
      refreshCount();
      fetchSaved();
      void refreshWalkInStats();
      if (goToExpense) router.push("/expense");

    } catch {
      showToast("Could not finish invoice save. Reload the invoice list before retrying.", "err");
    } finally {
      invoiceSaveRef.current = false;
      setSaving(false);
    }
  }

  const STATUS = {
    paid: { bg: "var(--green-light)", color: "var(--green)" },
    partial: { bg: "var(--orange-light)", color: "#B45309" },
    unpaid: { bg: "var(--red-light)", color: "var(--red)" },
  } as Record<string, { bg: string; color: string }>;

  async function fetchInvoicePdfPayload(invId: string): Promise<InvoicePdfPayload | null> {
    const { data: full, error: invErr } = await db.from("invoices").select("*").eq("id", invId).single();
    if (invErr || !full) {
      showToast(invErr?.message || "Invoice not found", "err");
      return null;
    }
    const { data: rows, error: itemErr } = await db
      .from("invoice_items")
      .select("product_id, category, description, width, height, sqft, rate, qty, amount, discount_pct")
      .eq("invoice_id", invId)
      .order("id", { ascending: true });
    if (itemErr) {
      showToast(itemErr.message, "err");
      return null;
    }
    const invoiceProducts = await fetchProducts();
    return {
      invoice: {
        invoice_number: full.invoice_number as string,
        client_name: full.client_name as string,
        client_phone: (full.client_phone as string) || "",
        invoice_date: full.invoice_date as string,
        payment_status: full.payment_status as string,
        subtotal: Number(full.subtotal ?? full.grand_total),
        discount_amount: Number(full.discount_amount ?? 0),
        discount_type: full.discount_type === "flat" ? "flat" : "pct",
        discount_value: Number(full.discount_value ?? 0),
        grand_total: Number(full.grand_total),
        previous_balance: Number(full.previous_balance ?? 0),
        amount_received: Number(full.amount_received),
        balance_due: Number(full.balance_due),
        payment_method: (full.payment_method as string) || "Cash",
        description: String((full as Invoice).job_notes ?? "").trim(),
        gst_pct: Number((full as Invoice).gst_pct ?? 0),
        gst_amount: Number((full as Invoice).gst_amount ?? 0),
        stax_pct: Number((full as Invoice).stax_pct ?? 0),
        stax_amount: Number((full as Invoice).stax_amount ?? 0),
        bra_pct: Number((full as Invoice).bra_pct ?? 0),
        bra_amount: Number((full as Invoice).bra_amount ?? 0),
      },
      items: ((rows ?? []) as Record<string, unknown>[]).map((it) => ({
        ...productMetadata(invoiceProducts, it.product_id ? String(it.product_id) : null, String(it.category ?? "")),
        category: String(it.category ?? ""),
        description: String(it.description ?? ""),
        width: 0,
        height: 0,
        sqft: 0,
        rate: Number(it.rate),
        discount_pct: Number(it.discount_pct ?? 0),
        qty: Number(it.qty),
        amount: Number(it.amount),
      })),
    };
  }

  function draftToPdfPayload(d: WalkInDraft): InvoicePdfPayload {
    const clientName = d.clientName.trim() || "Walk-in Customer";
    const { subtotal, grandTotal, amountReceived, balanceDue, paymentStatus } = computeWalkInPayment(d);
    return {
      invoice: {
        invoice_number: d.invoiceNumber,
        client_name: clientName,
        client_phone: d.clientPhone.trim(),
        invoice_date: todayISO(),
        payment_status: paymentStatus,
        subtotal,
        discount_amount: computeWalkInPayment(d).discountAmount,
        discount_type: d.discountType,
        discount_value: Number(d.discountValue) || 0,
        grand_total: grandTotal,
        previous_balance: 0,
        amount_received: amountReceived,
        balance_due: balanceDue,
        payment_method: d.payMethod,
        description: d.description.trim(),
        gst_pct: 0,
        gst_amount: 0,
        stax_pct: 0,
        stax_amount: 0,
        bra_pct: 0,
        bra_amount: 0,
      },
      items: d.items.map((it) => ({
        ...productMetadata(products, it.productId, it.product),
        category: it.lineType === "labor" ? `Labor: ${it.laborType || "General"}` : it.product,
        description: it.lineType === "labor" ? "" : it.description.trim(),
        width: it.width,
        height: it.height,
        sqft: it.sqft,
        rate: it.rate,
        qty: it.qty,
        amount: it.total,
        discount_pct: it.discountPct ?? 0,
      })),
    };
  }

  async function generateInvoicePdfBlob(): Promise<Blob> {
    const node = invoicePdfRef.current;
    if (!node) throw new Error("Invoice PDF template not found");

    const prevDisplay = node.style.display;
    const prevPosition = node.style.position;
    const prevLeft = node.style.left;
    const prevTop = node.style.top;
    const prevWidth = node.style.width;
    const prevFlexDirection = node.style.flexDirection;
    const prevMinHeight = node.style.minHeight;

    // Capture the same content-height receipt used for thermal printing.
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.minHeight = "0";
    node.style.position = "absolute";
    node.style.left = "-99999px";
    node.style.top = "0";
    node.style.width = "80mm";

    try {
      await new Promise((r) => setTimeout(r, 100));

      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const receiptHeight = Math.max(100, (canvas.height * 80) / canvas.width);
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: [80, receiptHeight] });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgProps = pdf.getImageProperties(imgData);
      const imgWidth = pageWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

      const totalPages = Math.max(1, Math.ceil((imgHeight - 0.5) / pageHeight));
      for (let i = 0; i < totalPages; i++) {
        if (i > 0) pdf.addPage();
        const y = -pageHeight * i;
        pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight);
      }

      return pdf.output("blob");
    } finally {
      node.style.display = prevDisplay;
      node.style.position = prevPosition;
      node.style.left = prevLeft;
      node.style.top = prevTop;
      node.style.width = prevWidth;
      node.style.flexDirection = prevFlexDirection;
      node.style.minHeight = prevMinHeight;
    }
  }

  async function downloadInvoicePdf(inv: SavedInvoice) {
    if (generatingPdfFor || printingPdfFor || draftPdfBusy) return;
    setGeneratingPdfFor(inv.id);
    try {
      const payload = await withTimeout(
        fetchInvoicePdfPayload(inv.id),
        12000,
        "PDF request timed out. Please try again."
      );
      if (!payload) return;
      setInvoicePdfData(payload);
      await new Promise((r) => setTimeout(r, 150));
      const blob = await generateInvoicePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
      const invParty = safe(payload.invoice.client_name || "Customer");
      const invNum = safe(payload.invoice.invoice_number);
      const invDate = safe(payload.invoice.invoice_date?.slice(0, 10) ?? "");
      a.download = `${invParty} - ${invNum} - ${invDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("PDF downloaded", "ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate PDF";
      showToast(msg, "err");
    } finally {
      setInvoicePdfData(null);
      setGeneratingPdfFor(null);
    }
  }

  function requestPrint(fn: () => Promise<void>) {
    void fn();
  }

  function applyPrintMode() {
    const a4El = document.querySelector(".thermal-invoice") as HTMLElement | null;
    if (a4El) {
      a4El.style.setProperty("display", "flex", "important");
      a4El.style.setProperty("flex-direction", "column", "important");
      a4El.style.setProperty("min-height", "0", "important");
    }
    const el = document.createElement("style");
    el.id = "__a4_page_style";
    const receiptHeight = Math.max(100, Math.ceil((a4El?.scrollHeight ?? 378) * 25.4 / 96) + 2);
    el.textContent = `@page { size: 80mm ${receiptHeight}mm; margin: 0; }`;
    document.head.appendChild(el);
  }

  function restorePrintMode() {
    document.getElementById("__a4_page_style")?.remove();
    const a4El = document.querySelector(".thermal-invoice") as HTMLElement | null;
    if (a4El) {
      a4El.style.removeProperty("display");
      a4El.style.removeProperty("flex-direction");
      a4El.style.removeProperty("min-height");
    }
  }

  async function printSavedInvoicePdf(inv: SavedInvoice) {
    if (generatingPdfFor || printingPdfFor || draftPdfBusy) return;
    setPrintingPdfFor(inv.id);
    try {
      const payload = await withTimeout(fetchInvoicePdfPayload(inv.id), 12000, "Invoice load timed out. Please try again.");
      if (!payload) { setPrintingPdfFor(null); return; }
      setInvoicePdfData(payload);
      await new Promise((r) => setTimeout(r, 200));
      applyPrintMode();
      scheduleAfterPrint(() => {
        restorePrintMode();
        setInvoicePdfData(null);
        setPrintingPdfFor(null);
      });
      window.print();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to prepare print";
      showToast(msg, "err");
      restorePrintMode();
      setInvoicePdfData(null);
      setPrintingPdfFor(null);
    }
  }

  async function deleteSavedInvoice(inv: SavedInvoice) {
    if (generatingPdfFor || printingPdfFor || draftPdfBusy || deletingId) return;
    const ok = await confirmDialog({
      title: "Delete invoice?",
      message: `Delete invoice ${inv.invoice_number} (${inv.client_name})? This cannot be undone.`,
      details: `Linked invoice items, draft, and any cashbook entries tied to this invoice will also be deleted.`,
      tone: "danger",
    });
    if (!ok) return;
    setDeletingId(inv.id);
    try {
      const { error: invErr } = await db.from("invoices").delete().eq("id", inv.id);
      if (invErr) {
        showToast(invErr.message, "err");
        return;
      }
      await db.from("quick_invoices").delete().eq("invoice_number", inv.invoice_number);
      // Remove any cashbook entries linked to this invoice so Cash in Hand stays accurate
      await db.from("cashbook").delete().eq("reference", inv.id);
      // Drop the linked expense record too (its cashbook "out" entry is removed above)
      await db.from("expenses").delete().eq("invoice_id", inv.id);
      await logActivity({
        action: "delete",
        entityType: "invoice",
        entityId: inv.id,
        title: "Invoice Deleted",
        subtitle: `${inv.invoice_number} — ${inv.client_name}`,
        amount: Number(inv.grand_total ?? 0) || null,
      });
      showToast("Invoice deleted", "ok");
      void fetchProducts();
      void fetchSaved();
      void refreshCount();
      void refreshWalkInStats();
    } finally {
      setDeletingId(null);
    }
  }

  async function sendSavedInvoiceWhatsApp(inv: SavedInvoice) {
    const { data: full, error } = await db
      .from("invoices")
      .select("client_name, client_phone, invoice_number, invoice_date, grand_total, amount_received, balance_due, payment_status, job_notes")
      .eq("id", inv.id)
      .single();
    if (error || !full) {
      showToast(error?.message || "Could not load invoice", "err");
      return;
    }
    const { data: itemRows, error: itemErr } = await db
      .from("invoice_items")
      .select("product_id, category, description, width, height, sqft, rate, qty, amount, discount_pct")
      .eq("invoice_id", inv.id)
      .order("id", { ascending: true });
    if (itemErr) {
      showToast(itemErr.message, "err");
      return;
    }
    const items = ((itemRows ?? []) as Record<string, unknown>[]).map((r) => ({
      category: String(r.category ?? ""),
      description: String(r.description ?? ""),
      width: 0,
      height: 0,
      sqft: 0,
      rate: Number(r.rate),
      qty: Number(r.qty),
      amount: Number(r.amount),
    }));
    const msg = buildInvoiceShareWhatsAppMessage({
      invoiceNumber: String(full.invoice_number),
      clientName: String(full.client_name),
      invoiceDate: String(full.invoice_date),
      grandTotal: Number(full.grand_total),
      amountReceived: Number(full.amount_received),
      balanceDue: Number(full.balance_due),
      paymentStatus: String(full.payment_status),
      invoiceDescription: String((full as Invoice).job_notes ?? "").trim() || undefined,
      items,
    });
    const phone = String(full.client_phone ?? "").trim();
    if (phone) {
      if (openWhatsAppNewTab(phone, msg)) {
        showToast("WhatsApp opened for saved number", "ok");
        return;
      }
      showToast("Saved number isn’t valid for WhatsApp — choose a contact", "info");
    }
    openWhatsAppMessageOnlyNewTab(msg);
    showToast("WhatsApp opened — pick a contact to send", "ok");
  }

  async function printDraftInvoice() {
    if (!draft || draftPdfBusy || generatingPdfFor || printingPdfFor) return;
    const grandTotal = draft.items.reduce((s, it) => s + it.total, 0);
    if (grandTotal <= 0) {
      showToast("Add at least one line with an amount before printing", "err");
      return;
    }
    setDraftPdfBusy(true);
    try {
      setInvoicePdfData(draftToPdfPayload(draft));
      await new Promise((r) => setTimeout(r, 200));
      applyPrintMode();
      scheduleAfterPrint(() => {
        restorePrintMode();
        setInvoicePdfData(null);
        setDraftPdfBusy(false);
      });
      window.print();
    } catch {
      restorePrintMode();
      setInvoicePdfData(null);
      setDraftPdfBusy(false);
    }
  }

  async function downloadDraftInvoice() {
    if (!draft || draftPdfBusy || generatingPdfFor || printingPdfFor) return;
    const grandTotal = draft.items.reduce((s, it) => s + it.total, 0);
    if (grandTotal <= 0) {
      showToast("Add at least one line with an amount before download", "err");
      return;
    }
    setDraftPdfBusy(true);
    try {
      setInvoicePdfData(draftToPdfPayload(draft));
      await new Promise((r) => setTimeout(r, 150));
      const blob = await generateInvoicePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
      const draftParty = safe(draft.clientName.trim() || "Customer");
      const draftNum = safe(draft.invoiceNumber);
      const draftDate = safe(todayISO());
      a.download = `${draftParty} - ${draftNum} - ${draftDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("PDF downloaded", "ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate PDF";
      showToast(msg, "err");
    } finally {
      setInvoicePdfData(null);
      setDraftPdfBusy(false);
    }
  }

  return (
    <>
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Walk-in Invoice</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-700)" }}>
            Create a new walk-in invoice or review history below
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white"
          style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}
        >
          <Plus size={14} /> New Invoice
        </button>
      </div>

      {userProfile?.isAdmin && (
      <div
        className="rounded-[14px] border border-[var(--gray-100)] overflow-hidden mb-5"
        style={{ boxShadow: "var(--shadow-sm)", background: "var(--gray-50)" }}
      >
        <div className="px-4 py-3 border-b border-[var(--gray-100)] bg-white">
          <h2 className="text-[13px] font-extrabold m-0" style={{ color: "var(--gray-900)" }}>Walk-in customers (dashboard)</h2>
          <p className="text-[10px] m-0 mt-0.5 leading-snug" style={{ color: "var(--gray-600)" }}>
            Only invoices whose client name is <strong>not</strong> an account in Accounts — same split as the tables below. Totals use all walk-in invoices in the database.
          </p>
        </div>
        {walkInDashLoading ? (
          <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--gray-600)" }}>Loading walk-in totals…</div>
        ) : (
          <div className="p-4 space-y-4">
            <div>
              <div className="text-[9px] font-bold tracking-[1.2px] uppercase mb-2" style={{ color: "var(--blue-deeper)" }}>
                Today · {formatDate(todayISO())}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Invoices", val: String(walkInDash.todayInvoices), color: "var(--gray-900)" },
                  { label: "Sales (billed)", val: formatCurrency(walkInDash.todaySales), color: "var(--gray-900)" },
                  { label: "Received", val: formatCurrency(walkInDash.todayReceived), color: "var(--green)" },
                  { label: "Pending", val: formatCurrency(walkInDash.todayPending), color: "var(--red)" },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-[10px] border border-[var(--gray-100)] bg-white px-3 py-2.5"
                    style={{ boxShadow: "var(--shadow-xs)" }}
                  >
                    <div className="text-[9px] font-bold tracking-wider uppercase mb-0.5" style={{ color: "var(--gray-600)" }}>{c.label}</div>
                    <div className="text-[14px] font-extrabold font-mono leading-tight" style={{ color: c.color }}>{c.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      <div className="flex items-center gap-2.5 mb-3">
        <Clock size={14} style={{ color: "var(--gray-700)" }} />
        <span className="text-[10px] font-bold tracking-[2px] uppercase" style={{ color: "var(--gray-700)" }}>
          Previous Invoices
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--gray-200)" }} />
        <span className="text-[11px] font-semibold" style={{ color: "var(--gray-700)" }}>{savedInvoices.length} records</span>
      </div>

      {savedInvoices.length === 0 ? (
        <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden py-14 text-center" style={{ boxShadow: "var(--shadow-sm)" }}>
          <p className="text-[13px] m-0 px-4" style={{ color: "var(--gray-700)" }}>
            No invoices yet — use <strong>New Invoice</strong> to add one
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="px-4 py-3 border-b border-[var(--gray-100)] bg-[var(--gray-50)] flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-[14px] font-extrabold m-0" style={{ color: "var(--gray-900)" }}>Invoice history</h2>
                <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--gray-600)" }}>
                  Walk-in customers only. Party invoices are managed in the Accounts section.
                </p>
              </div>
            </div>
            {filteredInvoices.length === 0 ? (
              <p className="text-[13px] text-center py-8 m-0 px-4" style={{ color: "var(--gray-600)" }}>No walk-in invoices yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={`${DT.table} min-w-[640px]`}>
                  <thead>
                    <tr>
                      {["Invoice", "Customer", "Created By", "Total", "Received", "Due", "Status", "Actions"].map((h) => (
                        <th
                          key={h}
                          className={`${DT.th} ${h === "Actions" ? "text-center min-w-[220px]" : h === "Received" || h === "Due" || h === "Total" ? "text-right" : "text-left"}`}
                          style={DT.thStyle}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((inv) => {
                        const s = STATUS[inv.payment_status] ?? STATUS.unpaid;
                        const due = Number(inv.balance_due);
                        const busy =
                          generatingPdfFor !== null ||
                          printingPdfFor !== null ||
                          draftPdfBusy ||
                          deletingId !== null ||
                          paySaving;
                        return (
                          <tr key={inv.id} className={DT.row}>
                            <td className={DT.td}>
                              <span
                                className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded"
                                style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}
                              >
                                {inv.invoice_number}
                              </span>
                              <div className="text-[10px] mt-1" style={{ color: "var(--gray-600)" }}>
                                {formatDate(inv.invoice_date)}
                              </div>
                            </td>
                            <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>
                              <div>{inv.client_name}</div>
                            </td>
                            <td className={DT.td} style={{ color: "var(--gray-800)" }}>
                              <div className="text-[12px] font-semibold">{inv.created_by_name || "—"}</div>
                              {inv.created_by_email && (
                                <div className="text-[10px]" style={{ color: "var(--gray-600)" }}>{inv.created_by_email}</div>
                              )}
                            </td>
                            <td className={`${DT.td} font-mono font-bold text-[14px] text-right`} style={{ color: "var(--blue-deeper)" }}>
                              {formatCurrency(Number(inv.grand_total))}
                            </td>
                            <td className={`${DT.td} font-mono text-[13px] text-right font-semibold`} style={{ color: "var(--green)" }}>
                              {formatCurrency(Number(inv.amount_received))}
                            </td>
                            <td
                              className={`${DT.td} font-mono text-[13px] text-right font-bold`}
                              style={{ color: due > 0 ? "var(--red)" : "var(--green)" }}
                            >
                              {formatCurrency(due)}
                            </td>
                            <td className={DT.td}>
                              <span className={`${DT.badge} capitalize`} style={{ background: s.bg, color: s.color }}>
                                {inv.payment_status}
                              </span>
                            </td>
                            <td className={`${DT.td} text-center px-1 py-2`}>
                              <div className="inline-flex items-center justify-center gap-0.5 flex-wrap">
                                {due > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => openPayModal(inv)}
                                    disabled={busy}
                                    title="Pay remaining balance — updates invoice, cashbook, and party account when linked"
                                    className="inline-flex items-center justify-center gap-0.5 px-1.5 h-8 rounded-[8px] border-none cursor-pointer text-[10px] font-bold disabled:opacity-45 disabled:cursor-not-allowed"
                                    style={{ background: "var(--blue-light)", color: "var(--blue)" }}
                                  >
                                    <Wallet size={12} /> Pay
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void sendSavedInvoiceWhatsApp(inv)}
                                  disabled={busy}
                                  title="WhatsApp — to saved number if set, else you pick the contact"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer transition-all hover:bg-[var(--gray-50)] disabled:opacity-45 disabled:cursor-not-allowed"
                                  style={{ borderColor: "var(--gray-200)", color: "#0277b5" }}
                                >
                                  <WhatsAppGlyph size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void reopenInvoice(inv)}
                                  disabled={busy}
                                  title="Reopen and edit invoice"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer transition-all hover:bg-[var(--gray-50)] disabled:opacity-45 disabled:cursor-not-allowed"
                                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                                >
                                  <FileText size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => requestPrint(() => printSavedInvoicePdf(inv))}
                                  disabled={busy}
                                  title="Print invoice"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer transition-all hover:bg-[var(--gray-50)] disabled:opacity-45 disabled:cursor-not-allowed"
                                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                                >
                                  {printingPdfFor === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void downloadInvoicePdf(inv)}
                                  disabled={busy}
                                  title="Download invoice PDF"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer transition-all hover:bg-[var(--gray-50)] disabled:opacity-45 disabled:cursor-not-allowed"
                                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                                >
                                  {generatingPdfFor === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                </button>
                                {userProfile?.isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => void deleteSavedInvoice(inv)}
                                    disabled={busy}
                                    title="Delete invoice"
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] border-[1.5px] cursor-pointer transition-all hover:bg-[var(--red-light)] disabled:opacity-45 disabled:cursor-not-allowed"
                                    style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}
                                  >
                                    {deletingId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
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
        </div>
      )}

      {payInvoice ? (
        <div className="fixed inset-0 z-[850] flex items-center justify-center p-4" style={{ background: "rgba(10,30,50,.45)" }}>
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default border-none"
            style={{ background: "transparent" }}
            onClick={() => { if (!paySaving) setPayInvoice(null); }}
          />
          <div
            className="relative z-10 w-full max-w-[400px] rounded-[14px] border border-[var(--gray-100)] bg-white overflow-hidden"
            style={{ boxShadow: "var(--shadow-lg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-[var(--gray-100)]" style={{ background: "var(--gray-50)" }}>
              <div>
                <h3 className="text-[14px] font-extrabold m-0" style={{ color: "var(--gray-900)" }}>Pay balance</h3>
                <p className="text-[11px] m-0 mt-0.5 font-mono font-bold" style={{ color: "var(--blue-deeper)" }}>{payInvoice.invoice_number}</p>
                <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--gray-600)" }}>{payInvoice.client_name}</p>
              </div>
              <button
                type="button"
                disabled={paySaving}
                onClick={() => setPayInvoice(null)}
                className="shrink-0 w-8 h-8 rounded-[8px] border-none cursor-pointer flex items-center justify-center"
                style={{ background: "var(--gray-100)", color: "var(--gray-700)" }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <p className="text-[12px] m-0" style={{ color: "var(--gray-700)" }}>
                Balance due:{" "}
                <span className="font-mono font-extrabold" style={{ color: "var(--red)" }}>{formatCurrency(payInvoice.balance_due)}</span>
              </p>
              <div>
                <label className="block text-[9.5px] font-bold tracking-wider uppercase mb-1" style={{ color: "var(--gray-700)" }}>Amount</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="w-full border-[1.5px] rounded-[8px] px-2.5 py-2 text-[13px] font-mono font-bold outline-none"
                  style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
                />
              </div>
              <div>
                <label className="block text-[9.5px] font-bold tracking-wider uppercase mb-1" style={{ color: "var(--gray-700)" }}>Date</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full border-[1.5px] rounded-[8px] px-2.5 py-2 text-[12.5px] outline-none"
                  style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
                />
              </div>
              <div>
                <label className="block text-[9.5px] font-bold tracking-wider uppercase mb-1" style={{ color: "var(--gray-700)" }}>Method</label>
                <div className="flex flex-wrap border-[1.5px] rounded-[8px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                  {paymentMethods.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPayMethod(m.name)}
                      className="flex-1 min-w-[80px] py-2 text-[11px] font-semibold border-none cursor-pointer"
                      style={{
                        background: payMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                        color: payMethod === m.name ? "#fff" : "var(--gray-500)",
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] m-0" style={{ color: "var(--gray-600)" }}>
                Cashbook only — walk-in payments do not affect party account balances.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--gray-100)]">
              <button
                type="button"
                disabled={paySaving}
                onClick={() => setPayInvoice(null)}
                className="px-3 py-2 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer"
                style={{ borderColor: "var(--gray-200)", color: "var(--gray-800)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={paySaving}
                onClick={() => void confirmPayBalance()}
                className="px-3 py-2 rounded-[8px] text-[12px] font-semibold border-none text-white cursor-pointer disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}
              >
                {paySaving ? "Saving…" : "Save payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>

      {/* ── A4 print template — hidden on screen, shown when printing (A4) ── */}
      <div ref={invoicePdfRef} className="a4-print-only thermal-invoice" style={{ width: "80mm", maxWidth: "100%", boxSizing: "border-box", padding: "3mm", background: "#fff", fontFamily: "Arial, Helvetica, sans-serif", color: "#000", fontSize: 11, lineHeight: 1.4 }}>
        {invoicePdfData ? (
          <>
            <PrintHeader variant="thermal" />
            <div style={{ textAlign: "center", fontWeight: 700, marginBottom: 8 }}>WALK-IN INVOICE</div>
            <div style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
              <div><strong>Invoice:</strong> {invoicePdfData.invoice.invoice_number}</div>
              <div><strong>Date:</strong> {formatDate(invoicePdfData.invoice.invoice_date)}</div>
              <div><strong>Customer:</strong> {invoicePdfData.invoice.client_name}</div>
              {invoicePdfData.invoice.client_phone && <div>{invoicePdfData.invoice.client_phone}</div>}
              {invoicePdfData.invoice.description && <div style={{ whiteSpace: "pre-wrap" }}>{invoicePdfData.invoice.description}</div>}
            </div>
            <div style={{ borderTop: "1px dashed #000", borderBottom: "1px dashed #000", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontWeight: 700 }}><span>Product / Qty / Rate</span><span>Amount</span></div>
              {invoicePdfData.items.map((it, idx) => (
                <div key={idx} style={{ padding: "6px 0", borderTop: "1px dotted #000", breakInside: "avoid", overflowWrap: "anywhere" }}>
                  <div style={{ fontWeight: 700 }}>{it.category}</div>
                  {it.description && <div style={{ whiteSpace: "pre-wrap" }}>{it.description}</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontVariantNumeric: "tabular-nums" }}>
                    <span>{it.qty} x {formatCurrency(invoiceUnitRate(it))}</span><strong>{formatCurrency(it.amount)}</strong>
                  </div>
                  <InvoiceLineDiscount line={it} />
                </div>
              ))}
            </div>

            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "0", marginBottom: 16 }}>
              <div style={{ width: "100%" }}>
                <InvoiceDiscountSummary invoice={invoicePdfData.invoice} items={invoicePdfData.items} />                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #e5e7eb" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#111" }}>Previous Balance</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#111" }}>{formatCurrency(invoicePdfData.invoice.previous_balance)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "2px solid #111" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>New Bill</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 14, color: "#111" }}>{formatCurrency(invoicePdfData.invoice.grand_total)}</span>
                </div>
                {invoicePdfData.invoice.gst_amount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #e5e7eb" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#111" }}>GST ({invoicePdfData.invoice.gst_pct}%)</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#111" }}>+ {formatCurrency(invoicePdfData.invoice.gst_amount)}</span>
                  </div>
                )}
                {invoicePdfData.invoice.stax_amount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #e5e7eb" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#111" }}>Sales Tax ({invoicePdfData.invoice.stax_pct}%)</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#111" }}>+ {formatCurrency(invoicePdfData.invoice.stax_amount)}</span>
                  </div>
                )}
                {invoicePdfData.invoice.bra_amount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #e5e7eb" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#111" }}>BRA ({invoicePdfData.invoice.bra_pct}%)</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#111" }}>+ {formatCurrency(invoicePdfData.invoice.bra_amount)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #e5e7eb" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#111" }}>Received</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#111" }}>{formatCurrency(invoicePdfData.invoice.amount_received)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "2px solid #111" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Total Balance</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 14, color: "#111" }}>{formatCurrency(invoicePdfData.invoice.grand_total + invoicePdfData.invoice.previous_balance - invoicePdfData.invoice.amount_received)}</span>
                </div>
              </div>
            </div>

            <div style={{ textAlign: "center", borderTop: "1px dashed #000", paddingTop: 8 }}>Thank you for your business.</div>
            <div style={{ textAlign: "center", marginTop: 8, fontSize: 10, breakInside: "avoid" }}>Software developed by addsmint</div>
          </>
        ) : null}
      </div>

      {draft && (
        <WalkInInvoiceModal
          draft={draft}
          setDraft={setDraft}
          products={products}
          paymentMethods={paymentMethods}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
          draftPdfBusy={draftPdfBusy}
          onPrintDraft={() => requestPrint(() => printDraftInvoice())}
          onDownloadDraft={() => void downloadDraftInvoice()}
          onRequestCreateProduct={(idx, q) => setProductCreate({ idx, initialName: q })}
        />
      )}

      {productCreate && (
        <ProductCreateModal
          initialName={productCreate.initialName}
          existingProducts={products}
          onClose={() => setProductCreate(null)}
          onCreated={handleProductCreated}
        />
      )}

    </>
  );
}

function WalkInInvoiceModal({
  draft,
  setDraft,
  products,
  paymentMethods,
  onClose,
  onSave,
  saving,
  draftPdfBusy,
  onPrintDraft,
  onDownloadDraft,
  onRequestCreateProduct,
}: {
  draft: WalkInDraft;
  setDraft: React.Dispatch<React.SetStateAction<WalkInDraft | null>>;
  products: InvoiceProduct[];
  paymentMethods: { id: string; name: string }[];
  onClose: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  draftPdfBusy: boolean;
  onPrintDraft: () => void;
  onDownloadDraft: () => void;
  onRequestCreateProduct: (idx: number, query: string) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const setClientName = (name: string) => {
    setDraft((d) => (d ? { ...d, clientName: name } : null));
  };

  const setClientPhone = (phone: string) => {
    setDraft((d) => (d ? { ...d, clientPhone: phone } : null));
  };

  const updateItem = (idx: number, field: keyof Item, value: string | number) => {
    setDraft((d) => {
      if (!d) return null;
      const items = [...d.items];
      let item = { ...items[idx], [field]: value };
      if (field === "productId") {
        const dbProd = products.find((p) => p.id === value);
        item = { ...item, productId: dbProd?.id ?? null, product: dbProd?.name ?? "", description: dbProd?.description?.trim() ?? "", rate: dbProd ? Number(dbProd.sale_price) || 0 : 0 };
        if (dbProd) {
          const isStandalone = dbProd.pricing_type === "standalone";
          item = { ...item, productId: dbProd.id, rate: dbProd.sale_price, pricingType: "standalone" };
          if (isStandalone) item = { ...item, width: 0, height: 0, sqft: 0 };
          if (!item.description.trim() && dbProd.description?.trim()) {
            item = { ...item, description: dbProd.description.trim() };
          }
        }
      }
      if (field === "lineType" && value === "labor") {
        item = { ...item, product: "", width: 0, height: 0, sqft: 1, pricingType: "standalone" };
      }
      items[idx] = calcItem(item);
      return { ...d, items };
    });
  };

  const addItem = () => {
    setDraft((d) => (d ? { ...d, items: [...d.items, blankItem()] } : null));
  };

  const deleteItem = (idx: number) => {
    setDraft((d) => {
      if (!d || d.items.length <= 1) return d;
      return { ...d, items: d.items.filter((_, i) => i !== idx) };
    });
  };

  const subtotal = draft.items.reduce((s, it) => s + it.total, 0);
  const discountRaw = parseFloat(String(draft.discountValue).replace(/,/g, "")) || 0;
  const discountAmount =
    draft.discountType === "pct"
      ? Math.min(Math.max(0, discountRaw), 100) * (subtotal / 100)
      : Math.min(Math.max(0, discountRaw), subtotal);
  const grandTotal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const lastItemIdx = draft.items.length - 1;
  const { amountReceived: paidPreview, balanceDue: balanceDuePreview } = computeWalkInPayment(draft);

  const sm =
    "border border-[var(--gray-200)] rounded-[6px] px-2 py-1.5 text-[12px] outline-none bg-white focus:border-[var(--blue)] focus:ring-1 focus:ring-[var(--blue-light)] w-full transition-all";
  const lg =
    "border-2 border-[var(--gray-200)] rounded-[8px] px-2 py-2.5 text-[17px] font-bold outline-none bg-white focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-light)] w-full transition-all text-[#0C2433]";

  return (
    <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-6 sm:pt-10 px-3 pb-8 overflow-y-auto no-print">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/35 no-print cursor-default border-none"
        onClick={() => { if (!saving) onClose(); }}
      />
      <div
        className="relative z-10 w-full max-w-[1100px] bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--gray-100)] no-print"
          style={{ background: "var(--blue-deeper)" }}
        >
          <div>
            <h2 className="text-[15px] font-extrabold text-white tracking-tight">
              {draft.editingInvoiceId ? "Edit invoice" : "New walk-in invoice"}
            </h2>
            <p className="text-[11px] text-white/75 mt-0.5 font-mono font-bold">{draft.invoiceNumber}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onPrintDraft}
              disabled={saving || draftPdfBusy}
              title="Print preview"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border-[1.5px] text-[11px] font-bold cursor-pointer text-white hover:bg-white/10 transition-all disabled:opacity-40"
              style={{ borderColor: "rgba(255,255,255,0.35)" }}
            >
              {draftPdfBusy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              Print
            </button>
            <button
              type="button"
              onClick={onDownloadDraft}
              disabled={saving || draftPdfBusy}
              title="Download PDF"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border-[1.5px] text-[11px] font-bold cursor-pointer text-white hover:bg-white/10 transition-all disabled:opacity-40"
              style={{ borderColor: "rgba(255,255,255,0.35)" }}
            >
              {draftPdfBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              PDF
            </button>
            <button
              type="button"
              onClick={() => { if (!saving) onClose(); }}
              disabled={saving}
              className="w-9 h-9 rounded-[8px] flex items-center justify-center border-none cursor-pointer text-white hover:bg-white/10 transition-all disabled:opacity-40"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-4 border-b border-[var(--gray-100)] bg-[var(--gray-50)] no-print grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold tracking-[1px] uppercase mb-1.5" style={{ color: "var(--gray-700)" }}>
              Name (optional)
            </label>
            <input
              value={draft.clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={sm}
              placeholder="Walk-in (optional)"
              style={{ color: "#0C2433" }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-[1px] uppercase mb-1.5" style={{ color: "var(--gray-700)" }}>
              WhatsApp / mobile (optional)
            </label>
            <input
              value={draft.clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className={sm}
              placeholder="03001234567 — opens chat to this number when set"
              inputMode="tel"
              style={{ color: "#0C2433" }}
            />
          </div>
        </div>

        <div className="overflow-x-auto px-2 sm:px-4 py-4">
          <table className={`${DT.table}`} style={{ minWidth: 900 }}>
            <thead>
              <tr>
                {["Product", "Description", "Qty", "Rate", "Discount %", "Total", "Actions"].map((h) => {
                  const num = h === "Qty" || h === "Rate" || h === "Discount %" || h === "Total";
                  const align = h === "Total" ? "text-right" : h === "Actions" || num ? "text-center" : "text-left";
                  return (
                    <th key={h} className={`${DT.thDense} ${align}`} style={DT.thStyle}>
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item, idx) => (
                <tr key={idx} className="transition-colors hover:bg-[var(--blue-pale)] [&>td]:align-top">
                  <td className="px-2 py-3 border-b border-[var(--gray-100)]" style={{ minWidth: 150 }}>
                    <SearchableSelect
                      value={item.productId ?? products.find((p) => p.name === item.product)?.id ?? ""}
                      onChange={(v) => updateItem(idx, "productId", v)}
                      options={products.map((p) => ({ value: p.id, searchText: `${p.name} ${p.code ?? ""}`, label: p.name }))}
                      maxResults={10}
                      placeholder="— Product —"
                      inputClassName={sm}
                      inputStyle={{ color: "#0C2433" }}
                      onCreate={(q) => onRequestCreateProduct(idx, q)}
                      createLabel="+ Add new product"
                    />
                  </td>
                  <td className="px-2 py-3 border-b border-[var(--gray-100)]" style={{ minWidth: 200 }}>
                    <textarea
                      value={item.description}
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                      placeholder="Description (optional)"
                      rows={2}
                      className={`${sm} resize-y min-h-[48px] py-1.5`}
                      style={{ color: "#0C2433" }}
                    />
                  </td>

                  <td className="px-2 py-3 border-b border-[var(--gray-100)]" style={{ width: 80 }}>
                    <input
                      type="number"
                      min="0.01" step="0.01"
                      value={item.qty}
                      onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className={`${lg} text-center`}
                      style={item.qty <= 0 ? { borderColor: "var(--red)", color: "var(--red)" } : undefined}
                      aria-invalid={item.qty <= 0}
                      title={item.qty <= 0 ? "Quantity must be greater than zero" : undefined}
                    />
                  </td>

                  <td className="px-2 py-3 border-b border-[var(--gray-100)]" style={{ width: 110 }}>
                    <input
                      type="number" min="0" step="0.01"
                      value={item.rate || ""}
                      onChange={(e) => updateItem(idx, "rate", parseFloat(e.target.value) || 0)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className={`${lg} text-right`}
                      placeholder="0"
                    />
                  </td>
                  <td className="px-2 py-3 border-b border-[var(--gray-100)]" style={{ width: 100 }}>
                    <input type="number" min="0" max="100" step="0.01" value={item.discountPct ?? 0}
                      aria-label={`Discount percentage for product ${idx + 1}`}
                      onChange={e => updateItem(idx, "discountPct", Math.round(Math.min(100, Math.max(0, Number(e.target.value) || 0)) * 100) / 100)}
                      className={`${lg} text-center`} onWheel={e => e.currentTarget.blur()} />
                  </td>
                  <td
                    className="px-2.5 py-3 border-b border-[var(--gray-100)] text-right font-mono font-extrabold whitespace-nowrap"
                    style={{ color: "var(--blue-deeper)", width: 120, fontSize: 16 }}
                  >
                    {item.total > 0 ? formatCurrency(item.total) : "—"}
                  </td>
                  <td className="px-2 py-3 border-b border-[var(--gray-100)]" style={{ width: 130 }}>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end no-print">
                      {draft.items.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => deleteItem(idx)}
                          className="w-7 h-7 rounded-[6px] flex items-center justify-center border-none cursor-pointer shrink-0"
                          style={{ background: "var(--red-light)", color: "var(--red)" }}
                          aria-label="Remove line"
                        >
                          <Trash2 size={11} />
                        </button>
                      ) : null}
                      {idx === lastItemIdx ? (
                        <>
                          <ModalActionBtn onClick={addItem} bg="var(--green-light)" color="var(--green)" border="rgba(14,173,106,.2)">
                            <Plus size={10} /> Add
                          </ModalActionBtn>
                          {draft.items.length > 1 ? (
                            <span className="text-[11px] font-bold font-mono w-full mt-0.5 text-right" style={{ color: "var(--blue-deeper)" }}>
                              = {formatCurrency(grandTotal)}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 sm:px-5 py-4 border-t border-[var(--gray-100)] bg-[var(--gray-50)] no-print">
          <label className="block text-[10px] font-bold tracking-[1px] uppercase mb-1.5" style={{ color: "var(--gray-700)" }}>
            Invoice description (optional)
          </label>
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, description: e.target.value } : null))
            }
            className={`${sm} min-h-[52px] resize-y py-2`}
            placeholder="e.g. Shop front flex, delivery address, job notes…"
            rows={2}
            style={{ color: "#0C2433" }}
          />
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-[var(--gray-100)] no-print bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>
                Paid now <span className="font-normal normal-case opacity-80">(optional)</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.amountPaid}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, amountPaid: e.target.value } : null))
                }
                onWheel={(e) => e.currentTarget.blur()}
                placeholder="0"
                className={sm}
                style={{ color: "#0C2433" }}
              />
              <p className="text-[10px] m-0" style={{ color: "var(--gray-600)" }}>
                Amount collected now is saved on the invoice; see total, payment, and remaining below.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>
                How paid
              </label>
              <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDraft((d) => (d ? { ...d, payMethod: m.name } : null))}
                    className="flex-1 min-w-[80px] py-2 text-[11px] font-semibold border-none cursor-pointer transition-all"
                    style={{
                      background: draft.payMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                      color: draft.payMethod === m.name ? "#fff" : "var(--gray-500)",
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>
                Discount
              </label>
              <div className="flex gap-2">
                <select
                  value={draft.discountType}
                  onChange={(e) => setDraft((d) => (d ? { ...d, discountType: e.target.value as "pct" | "flat" } : null))}
                  className={sm}
                >
                  <option value="pct">%</option>
                  <option value="flat">Fixed</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draft.discountValue}
                  onChange={(e) => setDraft((d) => (d ? { ...d, discountValue: e.target.value } : null))}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder={draft.discountType === "pct" ? "0-100" : "Amount"}
                  className={sm}
                  style={{ color: "#0C2433" }}
                />
              </div>
            </div>
          </div>

          {/* Optional — flag this invoice as an expense; details are filled in the Expense module */}
          <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none rounded-[10px] border border-[var(--gray-200)] bg-[var(--gray-50)] px-4 py-3">
            <input
              type="checkbox"
              checked={draft.addToExpense}
              onChange={(e) => setDraft((d) => (d ? { ...d, addToExpense: e.target.checked } : null))}
              className="w-4 h-4 cursor-pointer accent-[var(--blue-deeper)]"
            />
            <span className="text-[12px] font-bold" style={{ color: "var(--gray-800)" }}>
              Add expense for this invoice
            </span>
            <span className="text-[10px] font-normal" style={{ color: "var(--gray-600)" }}>
              opens the Expense module after saving so you can enter the amount
            </span>
          </label>
        </div>

        <div
          className="flex flex-wrap items-end justify-between gap-4 px-5 py-4 border-t border-[var(--gray-100)] no-print"
          style={{ background: "var(--gray-50)" }}
        >
          <div
            className="rounded-[10px] border border-[var(--gray-200)] bg-white px-4 py-3 min-w-[min(100%,240px)]"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="text-[9px] font-bold tracking-[1px] uppercase mb-2" style={{ color: "var(--gray-600)" }}>
              Summary
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-[13px]">
              <div className="flex justify-between gap-8">
                <span style={{ color: "var(--gray-700)" }}>New Bill</span>
                <span className="font-extrabold" style={{ color: "var(--blue-deeper)" }}>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span style={{ color: "var(--gray-700)" }}>Discount</span>
                <span className="font-extrabold" style={{ color: "var(--orange)" }}>{formatCurrency(discountAmount)}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span style={{ color: "var(--gray-700)" }}>Total</span>
                <span className="font-extrabold" style={{ color: "var(--blue-deeper)" }}>{formatCurrency(grandTotal)}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span style={{ color: "var(--gray-700)" }}>Payment</span>
                <span className="font-extrabold" style={{ color: "var(--green)" }}>{formatCurrency(paidPreview)}</span>
              </div>
              <div
                className="flex justify-between gap-8 pt-1.5 border-t border-[var(--gray-100)]"
                style={{ marginTop: 2 }}
              >
                <span className="font-bold" style={{ color: "var(--gray-800)" }}>Remaining</span>
                <span
                  className="font-extrabold"
                  style={{ color: balanceDuePreview > 0 ? "var(--red)" : "var(--green)" }}
                >
                  {formatCurrency(balanceDuePreview)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2.5 rounded-[9px] text-[12.5px] font-semibold cursor-pointer border-[1.5px] bg-white transition-all disabled:opacity-50"
              style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}
            >
              <FileText size={14} />
              {saving ? "Saving…" : draft.editingInvoiceId ? "Update invoice" : "Save invoice"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WhatsAppGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function ModalActionBtn({ children, onClick, bg, color, border }: { children: React.ReactNode; onClick: () => void; bg: string; color: string; border: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[10.5px] font-semibold cursor-pointer border-[1.5px] whitespace-nowrap"
      style={{ background: bg, color, borderColor: border }}
    >
      {children}
    </button>
  );
}
