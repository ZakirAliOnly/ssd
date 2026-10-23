"use client";

import { hasWhatsAppAutomation } from "@/lib/whatsappAutomation";
import { InvoiceUnitSelect } from "@/components/InvoiceUnitSelect";
import { productUnits, unitSalePrice, unitLabel, type Packaging } from "@/lib/productUnits";
import { invoiceUnitRate, invoiceLineTotal } from "@/lib/invoicePricing";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { db, saveInvoice } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import { Plus, Search, Download, Edit, Trash2, X, Banknote, TrendingUp, Users, Layers, FileText, ChevronDown, BookOpen, Printer, Eye, ArrowLeft, Loader2, ClipboardList } from "lucide-react";
import type { Account, HeadAccount, Invoice, CashbookEntry, InvoiceItem } from "@/lib/database.types";
import { usePaymentMethods, type PaymentMethod } from "@/lib/paymentMethods";
import { LedgerLineItems } from "@/components/LedgerLineItems";
import { ledgerRowsForDateRange, openingBalanceBeforeDate } from "@/lib/ledger";
import { buildLedgerRows, computePartySignedBalance } from "@/lib/partyBalance";
import { fetchPartySignedBalance, syncCachedAccountBalance, recomputeCachedBalance } from "@/lib/partyBalanceLive";
import { DT } from "@/lib/dataTableStyles";
import { PrintFooter } from "@/components/PrintFooter";
import { SalesInvoiceDocument } from "@/components/InvoiceDocument";
import { prepareInvoiceDocument, saveInvoicePdf } from "@/lib/invoicePrint";
import { PrintHeader } from "@/components/PrintHeader";
import {
  openWhatsAppNewTab,
  openWhatsAppMessageOnlyNewTab,
  buildPaymentReceivedWhatsAppMessage,
  buildLastTransactionWhatsAppMessage,
  buildInvoiceShareWhatsAppMessage,
} from "@/lib/whatsappWaMe";
import { useUser } from "@/lib/UserContext";
import { SearchableSelect } from "@/components/SearchableSelect";
import { invoiceProductOption } from "@/lib/productOptions";
import { confirmDialog } from "@/components/ConfirmModal";
import { logActivity } from "@/lib/activityLog";
import { ProductCreateModal } from "@/components/ProductCreateModal";
import { createExpense } from "@/lib/expenses";
import { useSaving } from "@/lib/useSaving";

function WhatsAppIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

interface InvItem {
  lineType: "product" | "labor";
  product: string;
  productId?: string | null;
  sourceItemId?: string;
  unit?: string;
  unitFactor?: number;
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

function blankInvItem(): InvItem {
  return { lineType: "product", product: "", laborType: "", description: "", width: 0, height: 0, sqft: 0, rate: 0, qty: 1, total: 0, pricingType: "standalone" };
}

function calcInvItem(item: InvItem): InvItem {
  return { ...item, width: 0, height: 0, sqft: 0, pricingType: "standalone", total: invoiceLineTotal(item.rate, item.qty, item.discountPct ?? 0) };
}

export default function AccountsPage() {
  const userProfile = useUser();
  const router = useRouter();
  const { methods: paymentMethods } = usePaymentMethods();
  const { saving, run } = useSaving();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [heads, setHeads] = useState<HeadAccount[]>([]);
  const [search, setSearch] = useState("");
  const [selectedHead, setSelectedHead] = useState("");
  const [partyPage, setPartyPage] = useState(1);
  const [partyPageSize, setPartyPageSize] = useState(25);

  // Party Invoices modal state
  const [showPartyInvoicesModal, setShowPartyInvoicesModal] = useState(false);
  const [partyInvoicesAccount, setPartyInvoicesAccount] = useState<Account | null>(null);
  const [partyInvoicesList, setPartyInvoicesList] = useState<Invoice[]>([]);
  const [partyInvoicesLoading, setPartyInvoicesLoading] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [viewingInvoiceItems, setViewingInvoiceItems] = useState<InvoiceItem[]>([]);
  const [viewingInvoiceItemsLoading, setViewingInvoiceItemsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalBal, setEditingOriginalBal] = useState(0);
  const [editingOriginalBalType, setEditingOriginalBalType] = useState<"debit" | "credit">("debit");

  // Form state — ordered: Head Account, Name*, WhatsApp*, Address, Balance, Bal Type
  const [fHead, setFHead] = useState("");
  const [fName, setFName] = useState("");
  const [fWa, setFWa] = useState("");
  const [fAddr, setFAddr] = useState("");
  const [fBal, setFBal] = useState("0");
  const [fBalType, setFBalType] = useState<"debit" | "credit">("debit");

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Receive Payment modal state
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveAccount, setReceiveAccount] = useState<Account | null>(null);
  const [rDate, setRDate] = useState(todayISO());
  const [rDesc, setRDesc] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rMethod, setRMethod] = useState<PaymentMethod>("Cash");
  const [receivingSaving, setReceivingSaving] = useState(false);

  // Invoice modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceAccount, setInvoiceAccount] = useState<Account | null>(null);
  const [invItems, setInvItems] = useState<InvItem[]>([blankInvItem()]);
  const [invProducts, setInvProducts] = useState<(Packaging & { id: string; code: string | null; name: string; sale_price: number; description: string | null; pricing_type?: string | null; expiry_date?: string | null; quantity?: number; product_categories?: { name: string } | null })[]>([]);
  const [invNextNum, setInvNextNum] = useState("");
  const [invSaving, setInvSaving] = useState(false);
  const [invAmountPaid, setInvAmountPaid] = useState("");
  const [invPayMethod, setInvPayMethod] = useState<PaymentMethod>("Cash");
  const [invDiscountType, setInvDiscountType] = useState<"pct" | "flat">("pct");
  const [invDiscountValue, setInvDiscountValue] = useState("");
  const [invDescription, setInvDescription] = useState("");
  const [invAddToExpense, setInvAddToExpense] = useState(false);
  const [invGstPct, setInvGstPct] = useState("");      // GST (was EST)
  const [invSalesTaxPct, setInvSalesTaxPct] = useState(""); // Sales Tax (was BRA/stax)
  const [invBraPct, setInvBraPct] = useState("");      // BRA (new)
  const [showHeadsDropdown, setShowHeadsDropdown] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingInvoiceOldBalanceDue, setEditingInvoiceOldBalanceDue] = useState(0);
  const [editingInvoiceOldAmountReceived, setEditingInvoiceOldAmountReceived] = useState(0);

  // Inline product-create modal state (triggered from product picker rows)
  const [productCreate, setProductCreate] = useState<{ idx: number; initialName: string } | null>(null);
  // Tracks products inserted via the inline modal during this invoice session.
  // Deleted if the user cancels the invoice; cleared (kept) on successful save.
  const pendingProductIdsRef = useRef<string[]>([]);
  const invoiceSaveRef = useRef(false);

  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [ledgerAccount, setLedgerAccount] = useState<Account | null>(null);
  const [ledgerInvoices, setLedgerInvoices] = useState<Invoice[]>([]);
  const [ledgerCashbook, setLedgerCashbook] = useState<CashbookEntry[]>([]);
  // Line items for each invoice in the ledger, keyed by invoice id — lets the
  // ledger show the products that make up each invoice row.
  const [ledgerItemsByInvoice, setLedgerItemsByInvoice] = useState<Record<string, InvoiceItem[]>>({});
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerMonth, setLedgerMonth] = useState("");
  const [ledgerDownloading, setLedgerDownloading] = useState(false);
  const ledgerPdfRef = useRef<HTMLDivElement | null>(null);

  // Invoice print state
  const [invPrinting, setInvPrinting] = useState(false);

  const [partyInvoices, setPartyInvoices] = useState<Invoice[]>([]);
  const [partyCashbook, setPartyCashbook] = useState<CashbookEntry[]>([]);

  const ledgerAllRows = useMemo(() => {
    if (!ledgerAccount) return [];
    return buildLedgerRows(ledgerAccount.name, ledgerInvoices, ledgerCashbook);
  }, [ledgerAccount, ledgerInvoices, ledgerCashbook]);

  const ledgerDisplayWithBal = useMemo(
    () => ledgerRowsForDateRange(ledgerAllRows, ledgerDateFrom, ledgerDateTo),
    [ledgerAllRows, ledgerDateFrom, ledgerDateTo]
  );

  const ledgerOpeningBefore = useMemo(
    () => openingBalanceBeforeDate(ledgerAllRows, ledgerDateFrom),
    [ledgerAllRows, ledgerDateFrom]
  );

  // Credit column is derived from the ledger (invoices + cashbook), NOT from the
  // cached `accounts.balance` column. The cached column has historically drifted
  // from the ledger because some write paths updated one side but not the other,
  // and rate × sqft fractional totals (e.g. 4,102.50 displayed as Rs 4,103) leave
  // hidden sub-rupee residuals. Computing from the ledger here makes the Credit
  // column and the ledger modal's closing balance always agree.
  const effectivePartySigned = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of accounts) {
      map.set(a.id, computePartySignedBalance(a.name, partyInvoices, partyCashbook));
    }
    return map;
  }, [accounts, partyInvoices, partyCashbook]);

  const fetchData = useCallback(async () => {
    const [{ data: acctData }, { data: headData }, { data: invData }, { data: cbData }] = await Promise.all([
      db.from("accounts").select("*, head_accounts(*)").order("name"),
      db.from("head_accounts").select("*").order("code"),
      db.from("invoices").select("*").order("invoice_date", { ascending: true }).order("created_at", { ascending: true }),
      db.from("cashbook").select("*").order("date", { ascending: true }).order("created_at", { ascending: true }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (acctData) setAccounts(acctData as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (headData) setHeads(headData as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (invData) setPartyInvoices(invData as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (cbData) setPartyCashbook(cbData as any);
  }, []);

  // One-shot background sweep: when the accounts page loads, walk the in-memory
  // accounts/invoices/cashbook and silently repair any cached `accounts.balance`
  // rows that disagree with the ledger by more than a rupee. New write paths
  // already keep the cache in lock-step with the ledger, so this only matters
  // for historical drift that landed before this fix shipped.
  useEffect(() => {
    if (accounts.length === 0 || partyInvoices.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const a of accounts) {
        if (cancelled) return;
        const ledgerSigned = computePartySignedBalance(a.name, partyInvoices, partyCashbook);
        const cachedSigned = a.bal_type === "credit" ? Number(a.balance) : -Number(a.balance);
        if (Math.abs(ledgerSigned - cachedSigned) > 0.5) {
          console.warn(
            `[accounts] historical drift for ${a.name}: ledger=${ledgerSigned} cached=${cachedSigned} — repairing`
          );
          try { await syncCachedAccountBalance(a.name, ledgerSigned); } catch (e) { console.error(e); }
        }
      }
    })();
    return () => { cancelled = true; };
    // Run once when the data first arrives. Subsequent writes are kept consistent
    // by recomputeCachedBalance in the affected mutation paths.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, partyInvoices.length, partyCashbook.length]);

  const fetchInvProducts = useCallback(async () => {
    const { data } = await db.from("products").select("id, code, name, sale_price, description, pricing_type, expiry_date, quantity, packaging_enabled, base_unit, pieces_per_packet, packets_per_box, packet_sale_price, box_sale_price, product_categories(name)");
    if (!data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = data as any[];
    arr.sort((a, b) => {
      const an = parseInt(String(a.code ?? ""), 10);
      const bn = parseInt(String(b.code ?? ""), 10);
      if (Number.isNaN(an) && Number.isNaN(bn)) return String(a.code ?? "").localeCompare(String(b.code ?? ""));
      if (Number.isNaN(an)) return 1;
      if (Number.isNaN(bn)) return -1;
      return an - bn;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setInvProducts(arr as any);
  }, []);

  useEffect(() => {
    fetchData();
    void fetchInvProducts();
  }, [fetchData, fetchInvProducts]);

  const filtered = accounts.filter((a) => {
    const matchesSearch = a.name.toLowerCase().includes(search.toLowerCase());
    const matchesHead = !selectedHead || (a as Account & { head_id?: string }).head_id === selectedHead;
    return matchesSearch && matchesHead;
  });
  const partyPageCount = Math.max(1, Math.ceil(filtered.length / partyPageSize));
  const currentPartyPage = Math.min(partyPage, partyPageCount);
  const partyPageStart = (currentPartyPage - 1) * partyPageSize;
  const visibleParties = filtered.slice(partyPageStart, partyPageStart + partyPageSize);

  // WhatsApp number: only numbers, exactly 11 digits
  function validatePhone(val: string): string {
    const digits = val.replace(/\D/g, "");
    return digits.slice(0, 11);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!fName.trim()) errs.name = "Account name is required";
    if (!fWa || fWa.length !== 11) errs.wa = "WhatsApp must be 11 digits";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;

    const payload = {
      name: fName.trim(),
      type: "Client",
      head_id: fHead || null,
      phone: fWa,
      whatsapp: fWa,
      address: fAddr,
      balance: parseFloat(fBal) || 0,
      bal_type: fBalType,
      status: "Active",
    };

    if (editingId) {
      const { error } = await db.from("accounts").update(payload).eq("id", editingId);
      if (error) { showToast(error.message, "err"); return; }

      // Cashbook ledger sync — best-effort, must never block the primary save
      try {
        const newAmt = parseFloat(fBal) || 0;
        const newName = fName.trim();
        // Compute signed delta (credit = +, debit = -). If non-zero, log a
        // ledger-only "Balance adjustment" entry — excluded from Cash in Hand.
        const oldSigned = (editingOriginalBalType === "credit" ? 1 : -1) * editingOriginalBal;
        const newSigned = (fBalType === "credit" ? 1 : -1) * newAmt;
        const delta = newSigned - oldSigned;
        if (delta !== 0) {
          await db.from("cashbook").insert({
            type: delta > 0 ? "in" : "out",
            description: `Balance adjustment — ${newName} (was ${editingOriginalBalType === "credit" ? "Cr" : "Dr"} ${formatCurrency(editingOriginalBal)}, now ${fBalType === "credit" ? "Cr" : "Dr"} ${formatCurrency(newAmt)})`,
            amount: Math.abs(delta),
            date: todayISO(),
            account_name: newName,
            method: "Adjustment",
            reference: "",
          });
        }
      } catch (e) {
        console.error("Cashbook sync failed (non-fatal):", e);
      }

      // Recompute the cached column from the ledger so the form-entered balance,
      // the adjustment cashbook row, and the cached column all settle to the
      // same whole-rupee value.
      try { await recomputeCachedBalance(fName.trim()); } catch (e) { console.error("recompute failed (non-fatal):", e); }

      showToast("Account updated", "ok");
    } else {
      const { error } = await db.from("accounts").insert(payload);
      if (error) { showToast(error.message, "err"); return; }

      // Create a cashbook entry for the opening balance so it appears in the
      // ledger, in Cash in Hand totals, and is not lost when transactions start.
      const openingAmt = parseFloat(fBal) || 0;
      if (openingAmt > 0) {
        await db.from("cashbook").insert({
          // credit opening (party owes us) = money "in"; debit (we owe them) = money "out"
          type: fBalType === "credit" ? "in" : "out",
          description: `Opening balance — ${fName.trim()}`,
          amount: openingAmt,
          date: todayISO(),
          account_name: fName.trim(),
          method: "Cash",
          reference: "",
        });
      }

      // Reseed the cached balance from the ledger (the opening-balance row).
      try { await recomputeCachedBalance(fName.trim()); } catch (e) { console.error("recompute failed (non-fatal):", e); }

      showToast("Account saved", "ok");
    }
    setShowModal(false);
    resetForm();
    fetchData();
  }

  function openEdit(a: Account) {
    setEditingId(a.id);
    setEditingOriginalBal(Number(a.balance ?? 0) || 0);
    setEditingOriginalBalType(a.bal_type as "debit" | "credit");
    setFHead((a as Account & { head_id?: string }).head_id || "");
    setFName(a.name);
    setFWa(a.whatsapp || a.phone || "");
    setFAddr((a as Account & { address?: string }).address || "");
    setFBal(String(a.balance ?? 0));
    setFBalType(a.bal_type as "debit" | "credit");
    setErrors({});
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    const account = accounts.find((a) => a.id === id);
    if (!account) return;

    // Pre-count linked records so the confirmation lists what will be removed.
    const [
      { data: invList },
      { data: cbList },
      { data: quoteList },
      { data: qInvList },
    ] = await Promise.all([
      db.from("invoices").select("id, invoice_number, grand_total").eq("client_name", account.name),
      db.from("cashbook").select("id, amount, type").eq("account_name", account.name),
      db.from("quotations").select("id, quote_number, grand_total").eq("party_name", account.name),
      db.from("quick_invoices").select("id, invoice_number, grand_total").eq("client_name", account.name),
    ]);
    const invCount = invList?.length ?? 0;
    const cbCount = cbList?.length ?? 0;
    const quoteCount = quoteList?.length ?? 0;
    const qInvCount = qInvList?.length ?? 0;
    const totalLinked = invCount + cbCount + quoteCount + qInvCount;

    const detailLines: string[] = [];
    if (invCount)   detailLines.push(`• ${invCount} invoice${invCount === 1 ? "" : "s"} (and their items)`);
    if (qInvCount)  detailLines.push(`• ${qInvCount} walk-in invoice${qInvCount === 1 ? "" : "s"} (and their items)`);
    if (cbCount)    detailLines.push(`• ${cbCount} cashbook entr${cbCount === 1 ? "y" : "ies"}`);
    if (quoteCount) detailLines.push(`• ${quoteCount} quotation${quoteCount === 1 ? "" : "s"} (and their items)`);

    const ok = await confirmDialog({
      title: "Delete account?",
      message: totalLinked > 0
        ? `This will permanently delete "${account.name}" and every record linked to this party. This cannot be undone.`
        : `Delete "${account.name}"? This cannot be undone.`,
      details: detailLines.length ? `Linked records that will also be deleted:\n${detailLines.join("\n")}` : undefined,
      confirmText: totalLinked > 0 ? "Delete everything" : "Delete account",
      tone: "danger",
    });
    if (!ok) return;

    // Cascade — invoices/cashbook/quotations/quick_invoices don't have FK to
    // account, so we delete them by client_name / account_name / party_name
    // match. Without this, recreating a same-named account inherits old
    // ledger rows from before the delete.
    const invoiceIds = ((invList ?? []) as { id: string }[]).map((r) => r.id);
    if (invoiceIds.length) {
      await db.from("invoice_items").delete().in("invoice_id", invoiceIds);
      await db.from("invoices").delete().in("id", invoiceIds);
    }
    const qInvoiceIds = ((qInvList ?? []) as { id: string }[]).map((r) => r.id);
    if (qInvoiceIds.length) {
      await db.from("quick_invoice_items").delete().in("quick_invoice_id", qInvoiceIds);
      await db.from("quick_invoices").delete().in("id", qInvoiceIds);
    }
    const quoteIds = ((quoteList ?? []) as { id: string }[]).map((r) => r.id);
    if (quoteIds.length) {
      await db.from("quotation_items").delete().in("quotation_id", quoteIds);
      await db.from("quotations").delete().in("id", quoteIds);
    }
    if (cbCount) {
      await db.from("cashbook").delete().eq("account_name", account.name);
    }

    const { error } = await db.from("accounts").delete().eq("id", id);
    if (error) { showToast(error.message, "err"); return; }

    await logActivity({
      action: "delete",
      entityType: "account",
      entityId: id,
      title: "Account Deleted",
      subtitle: account.name,
      amount: Number(account.balance ?? 0) || null,
      metadata: {
        head_id: (account as Account & { head_id?: string }).head_id,
        type: account.type,
        cascaded: { invoices: invCount, cashbook: cbCount, quotations: quoteCount },
      },
    });

    const summary = totalLinked > 0
      ? `Account deleted along with ${totalLinked} linked record${totalLinked === 1 ? "" : "s"}`
      : "Account deleted";
    showToast(summary, "ok");
    fetchData();
  }

  function openInvoiceModal(account: Account) {
    void fetchInvProducts();
    setInvoiceAccount(account);
    setInvItems([blankInvItem()]);
    setInvAmountPaid("");
    setInvPayMethod("Cash");
    setInvDiscountType("pct");
    setInvDiscountValue("");
    setInvDescription("");
    setInvAddToExpense(false);
    setInvGstPct("");
    setInvSalesTaxPct("");
    setInvBraPct("");
    setEditingInvoiceId(null);
    setInvNextNum("");
    setEditingInvoiceOldBalanceDue(0);
    setEditingInvoiceOldAmountReceived(0);
    setShowInvoiceModal(true);
  }

  async function openEditInvoiceModal(inv: Invoice) {
    void fetchInvProducts();
    const account = accounts.find((a) => a.name === inv.client_name);
    if (!account) { showToast("Party account not found", "err"); return; }

    const { data: itemRows, error } = await db
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("id", { ascending: true });
    if (error) { showToast(error.message, "err"); return; }

    const mappedItems: InvItem[] = ((itemRows ?? []) as Record<string, unknown>[]).map((it) => {
      const productName = String(it.category || "");
      const dbProd = invProducts.find((p) => it.product_id ? p.id === String(it.product_id) : p.name === productName);
      const pricingType = "standalone" as const;
      return calcInvItem({
        lineType: "product",
        product: productName, sourceItemId: String(it.id), unit: String(it.unit || "unit"), unitFactor: Number(it.unit_factor || 1),
        productId: it.product_id ? String(it.product_id) : dbProd?.id ?? null,
        laborType: "",
        description: String(it.description ?? ""),
        width: 0,
        height: 0,
        sqft: 0,
        rate: invoiceUnitRate(it),
        discountPct: Number(it.discount_pct ?? 0),
        qty: Number(it.qty),
        total: Number(it.amount),
        pricingType,
      });
    });

    // Close the party invoices modal first so the edit modal opens on top
    closePartyInvoicesModal();

    setInvoiceAccount(account);
    setInvItems(mappedItems.length > 0 ? mappedItems : [blankInvItem()]);
    setInvAmountPaid(inv.amount_received > 0 ? String(inv.amount_received) : "");
    setInvPayMethod((inv.payment_method as PaymentMethod) || "Cash");
    setInvDiscountType(inv.discount_type ?? "pct");
    setInvDiscountValue(inv.discount_value > 0 ? String(inv.discount_value) : "");
    setInvDescription(inv.job_notes || "");
    setInvAddToExpense(false);
    setInvGstPct(inv.gst_pct > 0 ? String(inv.gst_pct) : "");
    setInvSalesTaxPct(inv.stax_pct > 0 ? String(inv.stax_pct) : "");
    setInvBraPct(inv.bra_pct > 0 ? String(inv.bra_pct) : "");
    setInvNextNum(inv.invoice_number);
    setEditingInvoiceId(inv.id);
    setEditingInvoiceOldBalanceDue(inv.balance_due);
    setEditingInvoiceOldAmountReceived(inv.amount_received);
    setShowInvoiceModal(true);
  }

  function applyLedgerMonth(ym: string) {
    if (!ym) {
      setLedgerDateFrom("");
      setLedgerDateTo("");
      return;
    }
    const [y, m] = ym.split("-");
    const yi = parseInt(y, 10);
    const mi = parseInt(m, 10);
    const from = `${y}-${m}-01`;
    const lastD = new Date(yi, mi, 0).getDate();
    const to = `${y}-${m}-${String(lastD).padStart(2, "0")}`;
    setLedgerDateFrom(from);
    setLedgerDateTo(to);
  }

  async function openLedgerModal(account: Account) {
    setLedgerAccount(account);
    setShowLedgerModal(true);
    setLedgerLoading(true);
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerMonth("");
    setLedgerInvoices([]);
    setLedgerCashbook([]);
    setLedgerItemsByInvoice({});
    const [{ data: invData, error: invErr }, { data: cbData, error: cbErr }] = await Promise.all([
      db.from("invoices").select("*").eq("client_name", account.name).eq("is_walk_in", false).order("invoice_date", { ascending: true }).order("created_at", { ascending: true }),
      db.from("cashbook").select("*").ilike("account_name", account.name).order("date", { ascending: true }).order("created_at", { ascending: true }),
    ]);
    if (invErr) showToast(invErr.message, "err");
    if (cbErr) showToast(cbErr.message, "err");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (invData) setLedgerInvoices(invData as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (cbData) setLedgerCashbook(cbData as any);
    // Fetch the line items for every invoice in one query, then group by
    // invoice id so each ledger invoice row can list its products.
    const invoiceIds = ((invData ?? []) as Invoice[]).map((i) => i.id);
    if (invoiceIds.length) {
      const { data: itemData, error: itemErr } = await db
        .from("invoice_items")
        .select("*")
        .in("invoice_id", invoiceIds)
        .order("id", { ascending: true });
      if (itemErr) showToast(itemErr.message, "err");
      if (itemData) {
        const grouped: Record<string, InvoiceItem[]> = {};
        for (const it of itemData as InvoiceItem[]) {
          (grouped[it.invoice_id] ||= []).push(it);
        }
        setLedgerItemsByInvoice(grouped);
      }
    }
    setLedgerLoading(false);
  }

  function closeLedgerModal() {
    setShowLedgerModal(false);
    setLedgerAccount(null);
    setLedgerInvoices([]);
    setLedgerCashbook([]);
    setLedgerItemsByInvoice({});
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerMonth("");
  }

  async function openPartyInvoicesModal(a: Account) {
    setPartyInvoicesAccount(a);
    setShowPartyInvoicesModal(true);
    setPartyInvoicesLoading(true);
    setPartyInvoicesList([]);
    setViewingInvoice(null);
    setViewingInvoiceItems([]);
    try {
      const response = await fetch("/api/accounts/settle-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: a.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not refresh invoice statuses.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not refresh invoice statuses.", "err");
      setPartyInvoicesLoading(false);
      return;
    }
    const { data, error } = await db
      .from("invoices")
      .select("*")
      .eq("client_name", a.name)
      .eq("is_walk_in", false)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) showToast(error.message, "err");
    if (data) setPartyInvoicesList(data as Invoice[]);
    setPartyInvoicesLoading(false);
  }

  function closePartyInvoicesModal() {
    setShowPartyInvoicesModal(false);
    setPartyInvoicesAccount(null);
    setPartyInvoicesList([]);
    setViewingInvoice(null);
    setViewingInvoiceItems([]);
  }

  async function openInvoiceDetail(inv: Invoice) {
    setViewingInvoice(inv);
    setViewingInvoiceItemsLoading(true);
    setViewingInvoiceItems([]);
    const { data, error } = await db
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("id", { ascending: true });
    if (error) showToast(error.message, "err");
    if (data) setViewingInvoiceItems(data as InvoiceItem[]);
    setViewingInvoiceItemsLoading(false);
  }

  // ── Invoice print helpers ──────────────────────────────────────────────────
  function scheduleAfterInvPrint(cleanup: () => void) {
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      window.removeEventListener("afterprint", run);
      cleanup();
    };
    window.addEventListener("afterprint", run);
    window.setTimeout(run, 3500);
  }

  async function applyInvPrintMode() {
    const root = document.querySelector<HTMLElement>(".inv-a4-print-only");
    if (!root) throw new Error("Invoice template not found.");
    await prepareInvoiceDocument(root);
    root.style.setProperty("display", "block", "important");
  }

  function restoreInvPrintMode() {
    document.querySelector<HTMLElement>(".inv-a4-print-only")?.style.removeProperty("display");
  }

  async function deletePartyInvoice(inv: Invoice) {
    if (!userProfile?.isAdmin || deletingInvoiceId) return;
    if (!await confirmDialog({ title: "Delete invoice?", message: `Delete ${inv.invoice_number}? Stock will be restored and deletion recorded in the activity log.`, tone: "danger" })) return;
    setDeletingInvoiceId(inv.id);
    try {
      const { error } = await db.from("invoices").delete().eq("id", inv.id);
      if (error) { showToast(error.message, "err"); return; }
      setPartyInvoicesList(rows => rows.filter(row => row.id !== inv.id));
      if (viewingInvoice?.id === inv.id) { setViewingInvoice(null); setViewingInvoiceItems([]); }
      await fetchData();
      showToast("Invoice deleted", "ok");
    } finally { setDeletingInvoiceId(null); }
  }

  async function printViewingInvoice() {
    if (!viewingInvoice || invPrinting) return;
    setInvPrinting(true);
    try {
      await applyInvPrintMode();
      scheduleAfterInvPrint(() => {
        restoreInvPrintMode();
        setInvPrinting(false);
      });
      window.print();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Print failed", "err");
      restoreInvPrintMode();
      setInvPrinting(false);
    }
  }

  async function downloadInvoicePdf() {
    if (!viewingInvoice || invPrinting) return;
    setInvPrinting(true);
    try {
      const root = document.querySelector<HTMLElement>(".inv-a4-print-only");
      if (!root) throw new Error("Invoice template not found.");
      const clientName = viewingInvoice.client_name.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const date = formatDate(viewingInvoice.invoice_date).replace(/\s+/g, "-");
      await saveInvoicePdf(root, `${clientName} ${viewingInvoice.invoice_number} ${date}.pdf`);
    } catch (e) {
      showToast("PDF download failed", "err");
      console.error(e);
    } finally {
      setInvPrinting(false);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const handleProductCreated = useCallback(async (newProduct: Packaging & { id: string; name: string; sale_price: number; description?: string | null; pricing_type?: string | null; expiry_date?: string | null; quantity?: number }) => {
    pendingProductIdsRef.current.push(newProduct.id);
    await fetchInvProducts();
    const idx = productCreate?.idx;
    setProductCreate(null);
    if (typeof idx !== "number") return;
    setInvItems((prev) => {
      const items = [...prev];
      const cur = items[idx];
      if (!cur) return prev;
      const isStandalone = newProduct.pricing_type === "standalone";
      let item: InvItem = {
        ...cur,
        product: newProduct.name,
        productId: newProduct.id, unit: productUnits(newProduct)[0].value, unitFactor: 1, sourceItemId: undefined,
        rate: Number(newProduct.sale_price) || 0,
        pricingType: "standalone",
      };
      if (isStandalone) item = { ...item, width: 0, height: 0, sqft: 0 };
      if (!item.description.trim() && newProduct.description?.trim()) {
        item = { ...item, description: newProduct.description.trim() };
      }
      items[idx] = calcInvItem(item);
      return items;
    });
  }, [fetchInvProducts, productCreate]);

  function updateInvItem(idx: number, field: keyof InvItem, value: string | number) {
    setInvItems((prev) => {
      const items = [...prev];
      let item = { ...items[idx], [field]: value };
      if (field === "productId") {
        const dbProd = invProducts.find((p) => p.id === value);
        item = { ...item, unit: productUnits(dbProd)[0].value, unitFactor: 1, sourceItemId: undefined, productId: dbProd?.id ?? null, product: dbProd?.name ?? "", description: dbProd?.description?.trim() ?? "", rate: dbProd ? Number(dbProd.sale_price) || 0 : 0 };
        if (dbProd) {
          const isStandalone = dbProd.pricing_type === "standalone";
          item = { ...item, productId: dbProd.id, rate: dbProd.sale_price, pricingType: "standalone" };
          if (isStandalone) item = { ...item, width: 0, height: 0, sqft: 0 };
          if (!item.description.trim() && dbProd.description?.trim()) {
            item = { ...item, description: dbProd.description.trim() };
          }
        }
      }
      if (field === "unit") {
        const product = invProducts.find(p => p.id === item.productId);
        if (product) item = { ...item, sourceItemId: undefined, unitFactor: productUnits(product).find(u => u.value === value)?.factor ?? 1, rate: unitSalePrice(product, String(value)) };
      }
      if (field === "lineType" && value === "labor") {
        item = { ...item, product: "", width: 0, height: 0, sqft: 1, pricingType: "standalone" };
      }
      items[idx] = calcInvItem(item);
      return items;
    });
  }

  async function closeInvoiceModal() {
    const pending = pendingProductIdsRef.current;
    if (pending.length > 0) {
      pendingProductIdsRef.current = [];
      await db.from("products").delete().in("id", pending);
      void fetchInvProducts();
    }
    setShowInvoiceModal(false);
    setInvoiceAccount(null);
    setInvAmountPaid("");
    setInvPayMethod("Cash");
    setInvDiscountType("pct");
    setInvDiscountValue("");
    setInvDescription("");
    setInvAddToExpense(false);
    setInvGstPct("");
    setInvSalesTaxPct("");
    setInvBraPct("");
    setEditingInvoiceId(null);
    setEditingInvoiceOldBalanceDue(0);
    setEditingInvoiceOldAmountReceived(0);
  }

  async function handleSaveInvoice(printType?: "a4" | "challan") {
    if (invoiceSaveRef.current) return;
    invoiceSaveRef.current = true;
    try {
      if (!invoiceAccount) return;
      const subtotal = invItems.reduce((s, it) => s + it.total, 0);
      const rawDiscount = parseFloat(String(invDiscountValue).replace(/,/g, "")) || 0;
      const discountAmount =
        invDiscountType === "pct"
          ? Math.min(Math.max(0, rawDiscount), 100) * (subtotal / 100)
          : Math.min(Math.max(0, rawDiscount), subtotal);
      const afterDiscount = Math.max(0, subtotal - discountAmount);
      const gstPct = Math.max(0, parseFloat(invGstPct) || 0);
      const salesTaxPct = Math.max(0, parseFloat(invSalesTaxPct) || 0);
      const braPct = Math.max(0, parseFloat(invBraPct) || 0);
      const gstAmount = Math.round(afterDiscount * gstPct / 100 * 100) / 100;
      const salesTaxAmount = Math.round(afterDiscount * salesTaxPct / 100 * 100) / 100;
      const braAmount = Math.round(afterDiscount * braPct / 100 * 100) / 100;
      const grandTotal = Math.max(0, Math.round((afterDiscount + gstAmount + salesTaxAmount + braAmount) * 100) / 100);
      if (invItems.some((it) => Number(it.qty) < 1)) {
        showToast("Each item must have a quantity of at least 1", "err");
        return;
      }
      if (grandTotal <= 0) { showToast("Add at least one item with a total", "err"); return; }

      const stockItems = invItems.map(it => ({
        product_id: it.lineType === "product" ? (it.productId ?? invProducts.find(p => p.name === it.product)?.id ?? null) : null,
        category: it.lineType === "labor" ? "Labor" : it.product,
        description: it.lineType === "labor" ? it.laborType : it.description.trim(),
        source_item_id: it.sourceItemId, unit: it.unit, unit_factor: it.unitFactor, width: it.width, height: it.height, sqft: it.sqft, rate: it.rate, qty: it.qty, amount: it.total, discount_pct: it.discountPct ?? 0,
      }));

      setInvSaving(true);

      // ── EDIT MODE ──────────────────────────────────────────────────────────────
      if (editingInvoiceId) {
        const amountReceived = editingInvoiceOldAmountReceived;
        const balanceDue = Math.round((grandTotal - amountReceived) * 100) / 100;
        const paymentStatus: "unpaid" | "partial" | "paid" =
          balanceDue <= 0 ? "paid" : amountReceived > 0 ? "partial" : "unpaid";

        // 1. Update the invoices record
        const { error: invUpdErr } = await saveInvoice({
          subtotal,
          grand_total: grandTotal,
          balance_due: balanceDue,
          payment_status: paymentStatus,
          discount_type: invDiscountType,
          discount_value: parseFloat(invDiscountValue) || 0,
          discount_amount: discountAmount,
          gst_pct: gstPct,
          gst_amount: gstAmount,
          stax_pct: salesTaxPct,
          stax_amount: salesTaxAmount,
          bra_pct: braPct,
          bra_amount: braAmount,
          job_notes: invDescription.trim(),
        }, stockItems, editingInvoiceId);
        if (invUpdErr) { showToast(invUpdErr.message, "err"); setInvSaving(false); return; }

        // Canonical items and stock were saved with the invoice.

        // 3. Sync quick_invoices / quick_invoice_items (best-effort)
        const { data: qiRows } = await db
          .from("quick_invoices")
          .select("id")
          .eq("invoice_number", invNextNum)
          .limit(1);
        const qiRow = Array.isArray(qiRows) ? qiRows[0] : null;
        if (qiRow) {
          await db.from("quick_invoices").update({ grand_total: grandTotal }).eq("id", qiRow.id);
          await db.from("quick_invoice_items").delete().eq("quick_invoice_id", qiRow.id);
          await db.from("quick_invoice_items").insert(
            invItems.map((it) => ({
              quick_invoice_id: qiRow.id,
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

        // 4. Recompute the cached `accounts.balance` from the ledger so it stays
        //    in lock-step with the Credit column (which is also ledger-derived).
        //    Doing this from ground truth — instead of incrementing the cached
        //    column by the balance_due delta — means the cache cannot drift even
        //    if a previous write left it stale.
        await recomputeCachedBalance(invoiceAccount.name);

        showToast(`Invoice ${invNextNum} updated!`, "ok");
        void fetchInvProducts();
        pendingProductIdsRef.current = [];
        closeInvoiceModal();
        setInvSaving(false);
        fetchData();
        return;
      }

      // ── CREATE MODE ────────────────────────────────────────────────────────────
      const previousSigned = effectivePartySigned.get(invoiceAccount.id) ?? 0;
      // Total the party owes including this new bill (previousSigned > 0 = they owe us)
      const totalDueSave = Math.max(0, Math.round((previousSigned + grandTotal) * 100) / 100);
      const paidParsed = parseFloat(String(invAmountPaid).replace(/,/g, "")) || 0;
      // Payment can cover previous balance + new bill, not just the new bill
      const amountReceived = Math.min(Math.max(0, paidParsed), totalDueSave);
      // balance_due = new bill minus payment received (can be negative = extra paid off old balance)
      const balanceDue = Math.round((grandTotal - amountReceived) * 100) / 100;
      const paymentStatus: "unpaid" | "partial" | "paid" =
        totalDueSave - amountReceived <= 0 ? "paid" : amountReceived > 0 ? "partial" : "unpaid";

      const today = todayISO();

      // Save the invoice, canonical items, and stock together — the server assigns invoice_number atomically
      // (with retry on collision, see createInvoiceWithUniqueNumber in
      // app/api/db/route.ts), so this is the single source of truth for the
      // number, assigned only when saving succeeds.
      const { data: invData, error: invErr } = await saveInvoice({
        client_name: invoiceAccount.name,
        invoice_date: today,
        subtotal,
        grand_total: grandTotal,
        previous_balance: Math.max(0, previousSigned),
        amount_received: amountReceived,
        balance_due: balanceDue,
        payment_status: paymentStatus,
        payment_method: invPayMethod,
        discount_type: invDiscountType,
        discount_value: parseFloat(invDiscountValue) || 0,
        discount_amount: discountAmount,
        gst_pct: gstPct,
        gst_amount: gstAmount,
        stax_pct: salesTaxPct,
        stax_amount: salesTaxAmount,
        bra_pct: braPct,
        bra_amount: braAmount,
        job_notes: invDescription.trim(),
      }, stockItems);

      if (invErr) {
        showToast(invErr.message, "err");
        setInvSaving(false);
        return;
      }

      const confirmedNum = invData.invoice_number as string;
      pendingProductIdsRef.current = [];
      setEditingInvoiceId(invData.id);
      setEditingInvoiceOldAmountReceived(amountReceived);
      setInvNextNum(confirmedNum);

      // Mirror into quick_invoices (legacy/parallel storage — no unique
      // constraint here) using the CONFIRMED number so both tables agree.
      const { data: qiData } = await db
        .from("quick_invoices")
        .insert({ invoice_number: confirmedNum, client_name: invoiceAccount.name, grand_total: grandTotal })
        .select().single();

      if (qiData) await db.from("quick_invoice_items").insert(
        invItems.map((it) => ({
          quick_invoice_id: qiData.id,
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

      if (amountReceived > 0) {
        const { error: cbInvErr } = await db.from("cashbook").insert({
          type: "in",
          description: `Payment on invoice ${confirmedNum} — ${invoiceAccount.name}`,
          amount: amountReceived,
          date: today,
          account_name: invoiceAccount.name,
          method: invPayMethod,
          reference: invData.id,
        });
        if (cbInvErr) {
          showToast(cbInvErr.message, "err");
          setInvSaving(false);
          return;
        }
      }

      // Recompute the cached `accounts.balance` from the ledger (invoice +
      // optional cashbook payment row are now in the DB) so it agrees with the
      // ledger-derived Credit column.
      await recomputeCachedBalance(invoiceAccount.name);

      // If flagged, create a PENDING expense (amount 0, no cash entry yet) linked
      // to this invoice so it appears under Expense → Project Expense, then send
      // the user there to fill in the amounts.
      let goToExpense = false;
      if (invAddToExpense) {
        const { error: expErr } = await createExpense({
          category: "",
          description: `${confirmedNum} · ${invoiceAccount.name}`,
          amount: 0,
          method: invPayMethod,
          date: today,
          invoiceId: invData.id,
          invoiceNumber: confirmedNum,
        });
        if (expErr) { showToast(expErr, "err"); setInvSaving(false); return; }
        goToExpense = true;
      }

      void fetchInvProducts();
      showToast(`Invoice ${confirmedNum} saved!`, "ok");

      if (printType === "a4" && invData) {
        // Populate the print template with the saved invoice before closing
        setViewingInvoice(invData as Invoice);
        setViewingInvoiceItems(
          invItems.map((it) => ({
            id: "",
            invoice_id: invData.id,
            category: it.lineType === "labor" ? "Labor" : it.product,
            description: it.lineType === "labor" ? it.laborType : it.description.trim(),
            width: it.width,
            height: it.height,
            sqft: it.sqft,
            rate: it.rate,
            unit: it.unit, qty: it.qty,
            amount: it.total,
        discount_pct: it.discountPct ?? 0,
          }))
        );
        pendingProductIdsRef.current = [];
        closeInvoiceModal();
        setInvSaving(false);
        fetchData();
        // Give React one tick to render the template, then print
        await new Promise((r) => setTimeout(r, 150));
        await printViewingInvoice();
      } else {
        pendingProductIdsRef.current = [];
        closeInvoiceModal();
        setInvSaving(false);
        fetchData();
      }

      if (printType === "challan" && invData) {
        router.push(`/delivery-challan?invoice=${encodeURIComponent(String(invData.id))}`);
      } else if (goToExpense) router.push("/expense");

    } catch {
      showToast("Could not finish invoice save. Reload the invoice list before retrying.", "err");
    } finally {
      invoiceSaveRef.current = false;
      setInvSaving(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setEditingOriginalBal(0);
    setEditingOriginalBalType("debit");
    setFHead(""); setFName(""); setFWa("");
    setFAddr(""); setFBal("0"); setFBalType("debit"); setErrors({});
  }

  function openReceiveModal(account: Account) {
    setReceiveAccount(account);
    setRDate(todayISO());
    setRDesc("");
    setRAmount("");
    setRMethod("Cash");
    setShowReceiveModal(true);
  }

  async function openPartyLastTransactionWhatsApp(account: Account) {
    // Re-query the ledger so the WhatsApp message reflects the DB right now,
    // not whatever stale `partyInvoices`/`partyCashbook` happen to be in memory.
    // Auto-repair the cached `accounts.balance` if it has drifted from the ledger
    // (otherwise the Credit column on this page would still show the stale value).
    const fresh = await fetchPartySignedBalance(account.name);
    if (fresh.drift > 0.5) {
      console.warn(
        `[accounts] cached balance drift for ${account.name}: ledger=${fresh.signed} cached=${fresh.cachedSigned} — repairing`
      );
      await syncCachedAccountBalance(account.name, fresh.signed);
    }

    const rows = buildLedgerRows(account.name, fresh.invoices, fresh.cashbook);
    if (rows.length === 0) {
      showToast("No transactions for this party yet", "err");
      return;
    }
    const last = rows[rows.length - 1];
    const remainingSigned = fresh.signed;

    // If last transaction is an invoice, enrich the message with full invoice details + line items
    let invoiceExtra: import("@/lib/whatsappWaMe").InvoiceExtraForWhatsApp | undefined;
    if (last.debit > 0) {
      const matchedInv = partyInvoices.find((inv) => inv.invoice_number === last.doc && inv.client_name === account.name);
      if (matchedInv) {
        const { data: itemRows } = await db
          .from("invoice_items")
          .select("unit, category, description, width, height, sqft, rate, qty, amount")
          .eq("invoice_id", matchedInv.id)
          .order("id", { ascending: true });
        invoiceExtra = {
          grandTotal: Number(matchedInv.grand_total),
          amountReceived: Number(matchedInv.amount_received),
          paymentStatus: matchedInv.payment_status,
          description: [matchedInv.job_notes, matchedInv.job_name].map((s) => String(s || "").trim()).find(Boolean),
          items: ((itemRows ?? []) as Record<string, unknown>[]).map((r) => ({
            category: String(r.category ?? ""),
            description: String(r.description ?? ""),
            width: 0,
            height: 0,
            sqft: 0,
            rate: Number(r.rate),
            unit: String(r.unit || "unit"), qty: Number(r.qty),
            amount: Number(r.amount),
          })),
        };
      }
    }

    const msg = buildLastTransactionWhatsAppMessage(account.name, last, remainingSigned, invoiceExtra);
    if (!openWhatsAppNewTab(account.whatsapp || account.phone || "", msg)) {
      showToast("Add a valid WhatsApp number for this party", "err");
    }
  }

  function sendViewingInvoiceWhatsApp() {
    if (!viewingInvoice || !partyInvoicesAccount) return;
    const msg = buildInvoiceShareWhatsAppMessage({
      invoiceNumber: viewingInvoice.invoice_number,
      clientName: viewingInvoice.client_name,
      invoiceDate: viewingInvoice.invoice_date,
      grandTotal: viewingInvoice.grand_total,
      amountReceived: viewingInvoice.amount_received,
      balanceDue: viewingInvoice.balance_due,
      paymentStatus: viewingInvoice.payment_status,
      invoiceDescription: viewingInvoice.job_notes || undefined,
      items: viewingInvoiceItems.map((it) => ({
        category: it.category || "",
        description: it.description || undefined,
        width: 0,
        height: 0,
        sqft: 0,
        rate: invoiceUnitRate(it),
        discountPct: Number(it.discount_pct ?? 0),
        unit: it.unit, qty: Number(it.qty) || 1,
        amount: Number(it.amount) || 0,
      })),
    });
    const phone = partyInvoicesAccount.whatsapp || partyInvoicesAccount.phone || "";
    if (openWhatsAppNewTab(phone, msg)) {
      showToast("WhatsApp opened", "ok");
    } else {
      openWhatsAppMessageOnlyNewTab(msg);
      showToast("WhatsApp opened — pick a contact to send", "ok");
    }
  }

  async function handleReceivePayment() {
    const amtRaw = parseFloat(rAmount);
    if (!amtRaw || amtRaw <= 0) { showToast("Enter a valid amount", "err"); return; }
    if (!receiveAccount) return;
    if (!rMethod || !rMethod.trim()) { showToast("Please select a payment method", "err"); return; }
    if (!paymentMethods.some((m) => m.name === rMethod)) { showToast("Select a valid payment method", "err"); return; }

    // Preserve cents at write time so the cashbook row,
    // the recomputed balance, and the WhatsApp message all use the identical
    // integer — no off-by-rupee drift between the Credit column and the ledger.
    const amt = Math.round(amtRaw * 100) / 100;

    setReceivingSaving(true);

    // Re-query the ledger BEFORE we insert the payment. This pinning of the
    // pre-payment balance is what the WhatsApp message will say, and we want
    // it to match the Credit column the user just looked at. Auto-repair the
    // cached `accounts.balance` if it has drifted from the ledger.
    const preFresh = await fetchPartySignedBalance(receiveAccount.name);
    if (preFresh.drift > 0.5) {
      console.warn(
        `[accounts] cached balance drift for ${receiveAccount.name}: ledger=${preFresh.signed} cached=${preFresh.cachedSigned} — repairing`
      );
      await syncCachedAccountBalance(receiveAccount.name, preFresh.signed);
    }

    // Create cashbook entry — type "in" = cash received → increases cash in hand
    // Always guarantee description contains "Payment received from {name}" so
    // the ledger regex /payment/i always classifies this as a credit (balance decreases).
    const receiveDesc = rDesc.trim()
      ? `Payment received from ${receiveAccount.name} — ${rDesc.trim()}`
      : `Payment received from ${receiveAccount.name}`;
    const { error: cbError } = await db.from("cashbook").insert({
      type: "in",
      description: receiveDesc,
      amount: amt,
      date: rDate,
      account_name: receiveAccount.name,
      method: rMethod,
      reference: "",
    });

    if (cbError) { showToast(cbError.message, "err"); setReceivingSaving(false); return; }

    // Re-derive the post-payment balance from the ledger (now that the cashbook
    // row has landed) and write the cached column from the freshly computed value.
    const postSigned = await recomputeCachedBalance(receiveAccount.name);

    const party = receiveAccount;
    const descTrim = rDesc.trim();
    const msg = buildPaymentReceivedWhatsAppMessage({
      partyName: party.name,
      amount: amt,
      dateISO: rDate,
      method: rMethod,
      description: descTrim || undefined,
      remainingBalanceSigned: postSigned,
    });
    if (await hasWhatsAppAutomation("payment_received")) {
      showToast("Payment saved. Automatic WhatsApp receipt added to the queue for delivery checks.", "ok");
    } else if (!openWhatsAppNewTab(party.whatsapp || party.phone || "", msg)) {
      showToast("Payment saved. Add a valid WhatsApp number on the party to open chat.", "err");
    } else {
      showToast("Payment received — WhatsApp opened", "ok");
    }
    setShowReceiveModal(false);
    setReceiveAccount(null);
    setReceivingSaving(false);
    fetchData();
  }

  async function downloadLedgerPdf() {
    if (ledgerDownloading || ledgerLoading || !ledgerAccount) return;
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
      const safe = ledgerAccount.name.replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 80) || "Party";
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

  const inputStyle = {
    borderColor: "var(--gray-200)",
    background: "var(--gray-50)",
    color: "var(--gray-900)",
  };

  const errorInputStyle = {
    borderColor: "var(--red)",
    background: "var(--red-light)",
    color: "var(--gray-900)",
  };

  return (
    <>
    <div className="no-print animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Accounts</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Account ledger management</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold cursor-pointer bg-white border-[1.5px] transition-all"
            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
            <Download size={13} /> Export
          </button>
          {userProfile?.isAdmin && (
            <button onClick={() => { resetForm(); setShowModal(true); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white transition-all"
              style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}>
              <Plus size={14} /> Add Account
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards — admin only */}
      {userProfile?.isAdmin && (() => {
        const totalCredit = accounts.reduce((sum, a) => {
          const s = effectivePartySigned.get(a.id) ?? 0;
          return s > 0 ? sum + s : sum;
        }, 0);
        const totalAccounts = accounts.length;
        const countByHead = heads.map((h) => ({
          name: h.name,
          code: h.code,
          count: accounts.filter((a) => (a as Account & { head_id?: string }).head_id === h.id).length,
        }));
        const unassigned = accounts.filter((a) => !(a as Account & { head_id?: string }).head_id).length;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            {/* Total Credit */}
            <div
              className="rounded-[14px] border-[1.5px] px-5 py-4 flex items-center gap-4 min-h-[100px]"
              style={{
                background: "linear-gradient(145deg, var(--green-light) 0%, #d4f5e8 100%)",
                borderColor: "rgba(14, 173, 106, 0.35)",
                boxShadow: "0 4px 16px rgba(14, 173, 106, 0.12)",
              }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--green)", color: "white", boxShadow: "0 4px 12px rgba(14, 173, 106, 0.35)" }}
              >
                <TrendingUp size={24} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold tracking-[1.2px] uppercase leading-none mb-1.5" style={{ color: "var(--gray-700)" }}>
                  Total Credit
                </p>
                <p className="text-[1.35rem] sm:text-[1.5rem] font-extrabold font-mono leading-tight tracking-tight" style={{ color: "var(--green)" }}>
                  {formatCurrency(totalCredit)}
                </p>
              </div>
            </div>

            {/* Total Accounts */}
            <div
              className="rounded-[14px] border-[1.5px] px-5 py-4 flex items-center gap-4 min-h-[100px]"
              style={{
                background: "linear-gradient(145deg, var(--blue-light) 0%, #fce8e8 100%)",
                borderColor: "rgba(204, 17, 17, 0.22)",
                boxShadow: "0 4px 16px rgba(204, 17, 17, 0.08)",
              }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--blue-deeper)", color: "white", boxShadow: "0 4px 12px rgba(139, 0, 0, 0.28)" }}
              >
                <Users size={24} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold tracking-[1.2px] uppercase leading-none mb-1.5" style={{ color: "var(--gray-700)" }}>
                  Total Accounts
                </p>
                <p className="text-[1.35rem] sm:text-[1.5rem] font-extrabold font-mono leading-tight tracking-tight" style={{ color: "var(--blue-deeper)" }}>
                  {totalAccounts}
                </p>
              </div>
            </div>

            {/* Accounts per Head — dropdown */}
            <div className="relative sm:col-span-2 lg:col-span-1">
              <button
                onClick={() => setShowHeadsDropdown((v) => !v)}
                className="w-full rounded-[14px] border-[1.5px] px-5 py-4 flex items-center gap-4 cursor-pointer transition-all min-h-[100px] text-left"
                style={{
                  background: "linear-gradient(145deg, var(--orange-light) 0%, #ffefd0 100%)",
                  borderColor: showHeadsDropdown ? "var(--orange)" : "rgba(245, 158, 11, 0.4)",
                  boxShadow: showHeadsDropdown ? "0 6px 20px rgba(245, 158, 11, 0.2)" : "0 4px 16px rgba(245, 158, 11, 0.1)",
                }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--orange)", color: "white", boxShadow: "0 4px 12px rgba(245, 158, 11, 0.35)" }}
                >
                  <Layers size={24} strokeWidth={2.25} />
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-[10.5px] font-bold tracking-[1.2px] uppercase leading-none mb-1.5" style={{ color: "var(--gray-700)" }}>
                    Accounts per Head
                  </p>
                  <p className="text-[1.35rem] sm:text-[1.5rem] font-extrabold font-mono leading-tight tracking-tight" style={{ color: "#B45309" }}>
                    {countByHead.filter((h) => h.count > 0).length} heads
                  </p>
                </div>
                <ChevronDown
                  size={22}
                  className="flex-shrink-0"
                  style={{ color: "var(--orange)", transform: showHeadsDropdown ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                />
              </button>

              {showHeadsDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white rounded-[10px] border border-[var(--gray-100)] py-1.5 z-50 min-w-[220px]"
                  style={{ boxShadow: "var(--shadow-lg)" }}>
                  {countByHead.filter(h => h.count > 0).map((h) => (
                    <div key={h.code} className="flex items-center justify-between px-3.5 py-1.5 hover:bg-[var(--gray-50)] transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--orange-light)", color: "var(--orange)" }}>{h.code}</span>
                        <span className="text-[12.5px] font-semibold" style={{ color: "var(--gray-900)" }}>{h.name}</span>
                      </div>
                      <span className="text-[13px] font-extrabold font-mono ml-3" style={{ color: "var(--orange)" }}>{h.count}</span>
                    </div>
                  ))}
                  {unassigned > 0 && (
                    <div className="flex items-center justify-between px-3.5 py-1.5 hover:bg-[var(--gray-50)] transition-colors border-t border-[var(--gray-100)] mt-1">
                      <span className="text-[12.5px] font-semibold" style={{ color: "var(--gray-800)" }}>Unassigned</span>
                      <span className="text-[13px] font-extrabold font-mono ml-3" style={{ color: "var(--gray-800)" }}>{unassigned}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Card */}
      <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)] flex-wrap gap-3">
          <span className="text-lg sm:text-xl font-extrabold tracking-tight" style={{ color: "var(--gray-900)" }}>Account List</span>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedHead}
              onChange={(e) => { setSelectedHead(e.target.value); setPartyPage(1); }}
              className="border-[1.5px] rounded-full py-1.5 px-3 text-[12.5px] outline-none"
              style={{ ...inputStyle, minWidth: 140 }}
            >
              <option value="">All Heads</option>
              {heads.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <div className="relative max-w-[200px]">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--gray-700)" }}>
                <Search size={13} />
              </span>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPartyPage(1); }}
                placeholder="Search accounts..."
                className="w-full border-[1.5px] rounded-full py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
                style={{ ...inputStyle }}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className={`${DT.table} min-w-[1020px]`}>
            <thead>
              <tr>
                {["#", "Name", "WhatsApp", "Credit", "Ledger", "Receive", "Invoice", "View Invoices", "Status", ""].map((h, i) => (
                  <th key={`${h}-${i}`} className={`${DT.th} ${i === 0 ? "text-center w-12" : "text-left"}`} style={DT.thStyle}>
                    {h}
                  </th>
                ))}
                <th
                  className={`${DT.th} text-center w-12 px-2`}
                  style={DT.thStyle}
                  title="WhatsApp — send message about last transaction"
                >
                  <span className="inline-flex justify-center w-full" style={{ color: "white" }}>
                    <WhatsAppIcon size={15} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={userProfile?.isAdmin ? 12 : 11} className={DT.empty} style={DT.emptyStyle}>No accounts found</td></tr>
              ) : (
                visibleParties.map((a, idx) => {
                  const signed = effectivePartySigned.get(a.id) ?? 0;
                  return (
                    <tr key={a.id} className={DT.row}>
                      <td className={`${DT.td} text-center font-mono text-[13px] font-semibold tabular-nums`} style={{ color: "var(--gray-600)" }}>
                        {partyPageStart + idx + 1}
                      </td>
                      <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{a.name}</td>
                      <td className={`${DT.td} ${DT.cellMono}`} style={{ color: "var(--gray-900)" }}>{a.whatsapp || a.phone || "—"}</td>
                      <td
                        className={`${DT.td} font-mono font-bold text-[15px]`}
                        style={{
                          color: signed > 0 ? "var(--green)" : signed < 0 ? "var(--red)" : "var(--gray-500)",
                        }}
                      >
                        {formatCurrency(Math.abs(signed))}
                      </td>
                      <td className={DT.td}>
                        <button
                          type="button"
                          onClick={() => void openLedgerModal(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all hover:bg-[var(--orange-light)]"
                          style={{ borderColor: "var(--orange)", color: "#B45309" }}
                        >
                          <BookOpen size={12} /> See ledger
                        </button>
                      </td>
                      <td className={DT.td}>
                        <button
                          onClick={() => openReceiveModal(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all hover:bg-green-50"
                          style={{ borderColor: "var(--blue)", color: "var(--blue)" }}>
                          <Banknote size={12} /> Receive
                        </button>
                      </td>
                      <td className={DT.td}>
                        <button
                          onClick={() => openInvoiceModal(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all"
                          style={{ borderColor: "var(--blue)", color: "var(--blue-deeper)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--blue-pale)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                        >
                          <FileText size={12} /> Invoice
                        </button>
                      </td>
                      <td className={DT.td}>
                        <button
                          type="button"
                          onClick={() => void openPartyInvoicesModal(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all"
                          style={{ borderColor: "#7C3AED", color: "#7C3AED" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F3FF")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                        >
                          <Eye size={12} /> View Invoices
                        </button>
                      </td>
                      <td className={DT.td}>
                        <span className={DT.badge} style={{ background: "var(--green-light)", color: "var(--green)" }}>
                          {a.status}
                        </span>
                      </td>
                      <td className={DT.td}>
                        <div className="flex items-center gap-1.5">
                          {userProfile?.isAdmin && (
                          <button onClick={() => openEdit(a)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer"
                            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                            <Edit size={12} /> Edit
                          </button>
                          )}
                          {userProfile?.isAdmin && (
                          <button onClick={() => handleDelete(a.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer"
                            style={{ borderColor: "rgba(220,38,38,.2)", color: "var(--red)" }}>
                            <Trash2 size={12} /> Delete
                          </button>
                          )}
                        </div>
                      </td>
                      <td className={`${DT.td} text-center`}>
                        <button
                          type="button"
                          onClick={() => void openPartyLastTransactionWhatsApp(a)}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-[9px] border-[1.5px] bg-white cursor-pointer transition-colors hover:opacity-90"
                          style={{ borderColor: "#25D366", color: "#25D366" }}
                          title="WhatsApp: last transaction"
                          aria-label="WhatsApp last transaction"
                        >
                          <WhatsAppIcon size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <nav aria-label="Party list pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--gray-100)] px-5 py-4 text-sm text-[var(--gray-800)]">
          <span role="status" aria-live="polite">
            Showing {filtered.length ? partyPageStart + 1 : 0}–{Math.min(partyPageStart + partyPageSize, filtered.length)} of {filtered.length} parties
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Rows per page
              <select value={partyPageSize} onChange={(e) => { setPartyPageSize(Number(e.target.value)); setPartyPage(1); }}
                className="rounded-[8px] border border-[var(--gray-200)] bg-white px-2 py-2 focus-visible:outline-2 focus-visible:outline-[var(--blue)]">
                {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <span>Page {currentPartyPage} of {partyPageCount}</span>
            <button type="button" disabled={currentPartyPage <= 1} onClick={() => setPartyPage(currentPartyPage - 1)}
              className="rounded-[8px] border border-[var(--gray-200)] bg-white px-3 py-2 font-semibold hover:bg-[var(--gray-50)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] disabled:cursor-not-allowed disabled:opacity-50">
              Previous
            </button>
            <button type="button" disabled={currentPartyPage >= partyPageCount} onClick={() => setPartyPage(currentPartyPage + 1)}
              className="rounded-[8px] border border-[var(--gray-200)] bg-white px-3 py-2 font-semibold hover:bg-[var(--gray-50)] focus-visible:outline-2 focus-visible:outline-[var(--blue)] disabled:cursor-not-allowed disabled:opacity-50">
              Next
            </button>
          </div>
        </nav>
      </div>

      {/* Ledger Modal */}
      {showLedgerModal && ledgerAccount && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-6 px-4 pb-8 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.35)" }}>
          <div className="bg-white rounded-[20px] w-[min(920px,100%)] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]"
              style={{ background: "linear-gradient(90deg, #B45309, var(--orange))" }}>
              <div>
                <h2 className="text-[15px] font-bold text-white">Account ledger</h2>
                <p className="text-[11px] mt-0.5 text-white/80">{ledgerAccount.name}</p>
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
                Invoices and cashbook lines for this party
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void downloadLedgerPdf()}
                  disabled={ledgerLoading || ledgerDownloading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                >
                  <Download size={14} /> {ledgerDownloading ? "Saving…" : "Download PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={ledgerLoading || ledgerDownloading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                >
                  <Printer size={14} /> Print report
                </button>
              </div>
            </div>

            <div className="px-5 py-3 flex flex-wrap items-end gap-3 border-b border-[var(--gray-100)]"
              style={{ background: "var(--gray-50)" }}>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>Month</label>
                <input
                  type="month"
                  value={ledgerMonth}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLedgerMonth(v);
                    applyLedgerMonth(v);
                  }}
                  className="border-[1.5px] rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none min-w-[150px]"
                  style={inputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>From</label>
                <input
                  type="date"
                  value={ledgerDateFrom}
                  onChange={(e) => {
                    setLedgerDateFrom(e.target.value);
                    setLedgerMonth("");
                  }}
                  className="border-[1.5px] rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none"
                  style={inputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-700)" }}>To</label>
                <input
                  type="date"
                  value={ledgerDateTo}
                  onChange={(e) => {
                    setLedgerDateTo(e.target.value);
                    setLedgerMonth("");
                  }}
                  className="border-[1.5px] rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none"
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setLedgerDateFrom("");
                  setLedgerDateTo("");
                  setLedgerMonth("");
                }}
                className="px-3 py-1.5 rounded-[9px] text-[11.5px] font-semibold border-[1.5px] bg-white cursor-pointer mb-0.5"
                style={{ borderColor: "var(--gray-200)", color: "var(--gray-700)" }}
              >
                All dates
              </button>
            </div>

            <div className="p-5 max-h-[min(60vh,520px)] overflow-auto">
              {ledgerLoading ? (
                <p className="text-[13px] m-0" style={{ color: "var(--gray-600)" }}>Loading…</p>
              ) : ledgerAllRows.length === 0 ? (
                <p className="text-[13px] m-0" style={{ color: "var(--gray-600)" }}>No ledger entries yet for this account.</p>
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
                      {ledgerOpeningBefore > 0 ? " receivable" : ledgerOpeningBefore < 0 ? " payable" : ""}
                    </p>
                  ) : null}
                  <table className={`${DT.table} min-w-[720px]`}>
                  <thead>
                    <tr>
                      {["Date", "Invoice # / Ref", "Description", "Debit", "Credit", "Balance", "Method"].map((h) => (
                        <th key={h} className={`${DT.thDense} text-left`} style={DT.thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerDisplayWithBal.map((r, idx) => {
                      const items = r.invoiceId ? (ledgerItemsByInvoice[r.invoiceId] ?? []) : [];
                      return (
                      <Fragment key={`${r.sortAt}-${idx}`}>
                      <tr className={DT.row}>
                        <td className={`${DT.tdDense} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{formatDate(r.date)}</td>
                        <td className={`${DT.tdDense} font-mono text-[12px]`} style={{ color: "var(--gray-900)" }}>{r.doc}</td>
                        <td className={DT.tdDense} style={{ color: "var(--gray-800)" }}>{r.desc}</td>
                        <td className={`${DT.tdDense} font-mono text-right`} style={{ color: "var(--gray-900)" }}>
                          {r.debit > 0 ? formatCurrency(r.debit) : "—"}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right`} style={{ color: r.credit > 0 ? "var(--green)" : "var(--gray-300)" }}>
                          {r.credit > 0 ? formatCurrency(r.credit) : "—"}
                        </td>
                        <td
                          className={`${DT.tdDense} font-mono font-bold text-right`}
                          style={{
                            color: r.balance > 0 ? "var(--green)" : r.balance < 0 ? "var(--red)" : "var(--gray-600)",
                          }}
                        >
                          {formatCurrency(r.balance)}
                        </td>
                        <td className={DT.tdDense}>
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: "var(--gray-100)", color: "var(--gray-900)" }}>{r.method || "—"}</span>
                        </td>
                      </tr>
                      {items.length > 0 ? (
                        <tr>
                          <td colSpan={7} className="p-0" style={{ background: "var(--gray-50, #f8fafc)" }}>
                            <LedgerLineItems items={items.map(item => ({ ...item, rate: invoiceUnitRate(item) }))} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td
                        colSpan={5}
                        className={`${DT.tdDense} font-bold text-right border-t-2 border-[var(--gray-200)]`}
                        style={{ color: "var(--gray-700)" }}
                      >
                        Closing balance
                        {(ledgerDateFrom.trim() || ledgerDateTo.trim()) ? " (period)" : ""}
                      </td>
                      <td className={`${DT.tdDense} font-mono font-extrabold text-right border-t-2 border-[var(--gray-200)]`}
                        style={{
                          color: (() => {
                            const b = ledgerDisplayWithBal.at(-1)?.balance ?? 0;
                            if (b > 0) return "var(--green)";
                            if (b < 0) return "var(--red)";
                            return "var(--gray-600)";
                          })(),
                        }}
                      >
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

      {/* Invoice Modal */}
      {showInvoiceModal && invoiceAccount && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-8 px-4 pb-8 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.35)" }}>
          <div className="bg-white rounded-[20px] w-[1060px] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]"
              style={{ background: "linear-gradient(90deg, var(--blue-deeper), var(--blue-dark))" }}>
              <div>
                <h2 className="text-[15px] font-bold text-white">{editingInvoiceId ? "Edit Invoice" : "New Invoice"}</h2>
                <p className="text-[11px] mt-0.5 text-white/60">{invoiceAccount.name} — {invNextNum || "Number assigned on save"}</p>
              </div>
              <button onClick={closeInvoiceModal}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "rgba(255,255,255,0.15)", color: "white" }}>
                <X size={12} />
              </button>
            </div>

            {/* Items table */}
            <div className="p-5">
              <div className="rounded-[10px] border border-[var(--gray-100)] overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      {["Product", "Description", "Qty", "Rate", "Discount %", "Total", ""].map((h) => (
                        <th key={h} className={`${DT.thDense} ${h === "Total" ? "text-right" : ["Qty", "Rate", "Discount %"].includes(h) ? "text-center" : "text-left"}`} style={DT.thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-[var(--blue-pale)] transition-colors [&>td]:align-top">
                        {/* Product */}
                        <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ minWidth: 160 }}>
                          <SearchableSelect
                            value={item.productId ?? invProducts.find((p) => p.name === item.product)?.id ?? ""}
                            onChange={(v) => updateInvItem(idx, "productId", v)}
                            maxResults={10}
                            options={invProducts.map(invoiceProductOption)}
                            placeholder="— Product —"
                            inputClassName="border border-[var(--gray-200)] rounded-[6px] px-2 py-1.5 text-[12px] outline-none bg-white focus:border-[var(--blue)] w-full"
                            onCreate={(q) => setProductCreate({ idx, initialName: q })}
                            createLabel="+ Add new product"
                          />
                    <InvoiceUnitSelect selling product={invProducts.find(p => p.id === item.productId)} unit={item.unit} factor={item.unitFactor} onChange={u => updateInvItem(idx, "unit", u)} />
                        </td>
                        <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ minWidth: 200 }}>
                          <textarea
                            value={item.description}
                            onChange={(e) => updateInvItem(idx, "description", e.target.value)}
                            placeholder="Description (optional)"
                            rows={2}
                            className="border border-[var(--gray-200)] rounded-[6px] px-2 py-1.5 text-[12px] outline-none bg-white focus:border-[var(--blue)] w-full resize-y min-h-[44px]"
                          />
                        </td>

                        {/* Qty */}
                        <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 90 }}>
                          <input type="number" min="0.01" step="0.01"
                            value={item.qty}
                            onChange={(e) => updateInvItem(idx, "qty", parseFloat(e.target.value) || 0)}
                            className="border-2 border-[var(--gray-200)] rounded-[7px] px-2 py-2 text-[16px] font-bold outline-none bg-white focus:border-[var(--blue)] w-full text-center"
                            style={item.qty <= 0 ? { borderColor: "var(--red)", color: "var(--red)" } : undefined}
                            aria-invalid={item.qty <= 0}
                            title={item.qty <= 0 ? "Quantity must be greater than zero" : undefined} />
                        </td>

                        {/* Rate */}
                        <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 100 }}>
                          <input type="number" min="0" step="0.01"
                      value={item.rate || ""}
                            onChange={(e) => updateInvItem(idx, "rate", parseFloat(e.target.value) || 0)}
                            className="border-2 border-[var(--gray-200)] rounded-[7px] px-2 py-2 text-[16px] font-bold outline-none bg-white focus:border-[var(--blue)] w-full text-right"
                            placeholder="0" aria-label={`Rate per ${unitLabel(item.unit)} for product ${idx + 1}`} />
                          <p className="mt-1 text-xs" style={{ color: "var(--gray-800)" }}>per {unitLabel(item.unit)}</p>
                        </td>
                        {/* Total */}
                        <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 100 }}>
                          <input type="number" min="0" max="100" step="0.01" value={item.discountPct ?? 0}
                            aria-label={`Discount percentage for product ${idx + 1}`}
                            onChange={e => updateInvItem(idx, "discountPct", Math.round(Math.min(100, Math.max(0, Number(e.target.value) || 0)) * 100) / 100)}
                            className="border-2 border-[var(--gray-200)] rounded-[7px] px-2 py-2 text-[16px] font-bold outline-none bg-white focus:border-[var(--blue)] w-full text-center" />
                        </td>
                        <td className="px-3 py-2 border-b border-[var(--gray-100)] font-mono font-extrabold text-right whitespace-nowrap"
                          style={{ color: "var(--blue-deeper)", fontSize: 15, width: 110 }}>
                          {item.total > 0 ? formatCurrency(item.total) : "—"}
                        </td>
                        {/* Delete */}
                        <td className="px-2 py-2 border-b border-[var(--gray-100)]" style={{ width: 36 }}>
                          {invItems.length > 1 && (
                            <button onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                              className="w-6 h-6 rounded-[5px] flex items-center justify-center border-none cursor-pointer"
                              style={{ background: "var(--red-light)", color: "var(--red)" }}>
                              <Trash2 size={10} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add row + Grand total */}
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => setInvItems((prev) => [...prev, blankInvItem()])}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] font-semibold border-[1.5px] cursor-pointer transition-all"
                  style={{ borderColor: "rgba(14,173,106,.3)", color: "var(--blue)", background: "var(--blue-light)" }}
                >
                  <Plus size={12} /> Add Row
                </button>
                <div className="text-right">
                  <span className="text-[11px] font-semibold mr-2" style={{ color: "var(--gray-800)" }}>Grand Total</span>
                  <span className="text-[20px] font-extrabold font-mono" style={{ color: "var(--blue-deeper)" }}>
                    {(() => {
                      const st = invItems.reduce((s, it) => s + it.total, 0);
                      const rawD = parseFloat(String(invDiscountValue).replace(/,/g, "")) || 0;
                      const dAmt = invDiscountType === "pct" ? Math.min(Math.max(0, rawD), 100) * st / 100 : Math.min(Math.max(0, rawD), st);
                      const aft = Math.max(0, st - dAmt);
                      const gP = Math.max(0, parseFloat(invGstPct) || 0);
                      const sP = Math.max(0, parseFloat(invSalesTaxPct) || 0);
                      const bP = Math.max(0, parseFloat(invBraPct) || 0);
                      return formatCurrency(Math.max(0, Math.round((aft + aft * gP / 100 + aft * sP / 100 + aft * bP / 100) * 100) / 100));
                    })()}
                  </span>
                </div>
              </div>

              {/* Description — placed below products so users fill items first, then describe */}
              <div className="flex flex-col gap-1 mt-4">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                  Description <span className="font-normal normal-case opacity-70">(optional)</span>
                </label>
                <textarea
                  value={invDescription}
                  onChange={(e) => setInvDescription(e.target.value)}
                  placeholder="Order details, special instructions, internal notes…"
                  rows={2}
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none resize-y min-h-[52px] w-full"
                  style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
                />
              </div>

              {/* Optional — flag this invoice as a project expense; details filled in the Expense module */}
              {!editingInvoiceId && (
                <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none rounded-[10px] border border-[var(--gray-200)] bg-[var(--gray-50)] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={invAddToExpense}
                    onChange={(e) => setInvAddToExpense(e.target.checked)}
                    className="w-4 h-4 cursor-pointer accent-[var(--blue-deeper)]"
                  />
                  <span className="text-[12px] font-bold" style={{ color: "var(--gray-800)" }}>
                    Add expense for this invoice
                  </span>
                  <span className="text-[10px] font-normal" style={{ color: "var(--gray-600)" }}>
                    opens Expense → Project Expense after saving so you can enter the amount
                  </span>
                </label>
              )}

              {(() => {
                return (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                        {editingInvoiceId ? "Already received" : "Paid now"} <span className="font-normal normal-case opacity-80">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={invAmountPaid}
                        onChange={(e) => { if (!editingInvoiceId) setInvAmountPaid(e.target.value); }}
                        readOnly={!!editingInvoiceId}
                        placeholder="0"
                        className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                        style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)", background: editingInvoiceId ? "var(--gray-50)" : "white" }}
                      />
                      <p className="text-[10px] m-0" style={{ color: "var(--gray-600)" }}>
                        {editingInvoiceId
                          ? "Amount already received on this invoice — cannot be changed here."
                          : <>Only <strong>remaining</strong> is added to what they owe on the account. Full payment at issue adds nothing extra to the balance.</>}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                        How paid
                      </label>
                      <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                        {paymentMethods.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setInvPayMethod(m.name)}
                            className="flex-1 min-w-[80px] py-2 text-[11px] font-semibold border-none cursor-pointer transition-all"
                            style={{
                              background: invPayMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                              color: invPayMethod === m.name ? "#fff" : "var(--gray-500)",
                            }}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] m-0" style={{ color: "var(--gray-600)" }}>
                        Stored on the invoice for your records (same options as Receive payment).
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                        Discount
                      </label>
                      <div className="flex gap-2">
                        <select
                          value={invDiscountType}
                          onChange={(e) => setInvDiscountType(e.target.value as "pct" | "flat")}
                          className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none bg-white"
                          style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
                        >
                          <option value="pct">%</option>
                          <option value="flat">Fixed</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={invDiscountValue}
                          onChange={(e) => setInvDiscountValue(e.target.value)}
                          placeholder={invDiscountType === "pct" ? "0-100" : "Amount"}
                          className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none bg-white w-full"
                          style={{ borderColor: "var(--gray-200)", color: "var(--gray-900)" }}
                        />
                      </div>
                    </div>
                    {/* GST */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "#B45309" }}>
                        GST % <span className="font-normal normal-case opacity-70">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={invGstPct}
                        onChange={(e) => setInvGstPct(e.target.value)}
                        placeholder="e.g. 5"
                        className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none bg-white"
                        style={{ borderColor: "var(--orange)", color: "var(--gray-900)" }}
                      />
                    </div>
                    {/* Sales Tax */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "#B45309" }}>
                        Sales Tax % <span className="font-normal normal-case opacity-70">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={invSalesTaxPct}
                        onChange={(e) => setInvSalesTaxPct(e.target.value)}
                        placeholder="e.g. 2"
                        className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none bg-white"
                        style={{ borderColor: "var(--orange)", color: "var(--gray-900)" }}
                      />
                    </div>
                    {/* BRA */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "#B45309" }}>
                        BRA % <span className="font-normal normal-case opacity-70">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={invBraPct}
                        onChange={(e) => setInvBraPct(e.target.value)}
                        placeholder="e.g. 2"
                        className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none bg-white"
                        style={{ borderColor: "var(--orange)", color: "var(--gray-900)" }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            {(() => {
              const subtotal = invItems.reduce((s, it) => s + it.total, 0);
              const rawDiscount = parseFloat(String(invDiscountValue).replace(/,/g, "")) || 0;
              const discountAmount =
                invDiscountType === "pct"
                  ? Math.min(Math.max(0, rawDiscount), 100) * (subtotal / 100)
                  : Math.min(Math.max(0, rawDiscount), subtotal);
              const afterDiscount = Math.max(0, subtotal - discountAmount);
              const gP = Math.max(0, parseFloat(invGstPct) || 0);
              const sP = Math.max(0, parseFloat(invSalesTaxPct) || 0);
              const bP = Math.max(0, parseFloat(invBraPct) || 0);
              const gstAmt = Math.round(afterDiscount * gP / 100 * 100) / 100;
              const stAmt = Math.round(afterDiscount * sP / 100 * 100) / 100;
              const braAmt = Math.round(afterDiscount * bP / 100 * 100) / 100;
              const gt = Math.max(0, Math.round((afterDiscount + gstAmt + stAmt + braAmt) * 100) / 100);
              const partySigned = invoiceAccount ? (effectivePartySigned.get(invoiceAccount.id) ?? 0) : 0;
              // partySigned > 0 = party owes us; < 0 = party has credit with us
              // Total the party owes after this new bill
              const totalDue = Math.max(0, Math.round((partySigned + gt) * 100) / 100);
              const paid = Math.min(Math.max(0, parseFloat(String(invAmountPaid).replace(/,/g, "")) || 0), totalDue);
              const due = Math.round((totalDue - paid) * 100) / 100;
              return (
            <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-3.5 border-t border-[var(--gray-100)]">
              <div
                className="rounded-[10px] border border-[var(--gray-200)] bg-[var(--gray-50)] px-4 py-3 min-w-[min(100%,240px)]"
                style={{ boxShadow: "var(--shadow-sm)" }}
              >
                <div className="text-[9px] font-bold tracking-[1px] uppercase mb-2" style={{ color: "var(--gray-600)" }}>
                  Summary
                </div>
                <div className="flex flex-col gap-1.5 font-mono text-[13px]">
                  {/* Previous balance */}
                  {partySigned !== 0 && (
                    <div className="flex justify-between gap-8">
                      <span style={{ color: "var(--gray-600)" }}>Previous Balance</span>
                      <span className="font-extrabold" style={{ color: partySigned > 0 ? "var(--red)" : "var(--green)" }}>
                        {formatCurrency(Math.abs(partySigned))}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8">
                    <span style={{ color: "var(--gray-700)" }}>New Bill</span>
                    <span className="font-extrabold" style={{ color: "var(--blue-deeper)" }}>{formatCurrency(subtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between gap-8">
                      <span style={{ color: "var(--gray-700)" }}>Discount</span>
                      <span className="font-extrabold" style={{ color: "var(--orange)" }}>− {formatCurrency(discountAmount)}</span>
                    </div>
                  )}
                  {gstAmt > 0 && (
                    <div className="flex justify-between gap-8">
                      <span style={{ color: "#B45309" }}>GST ({gP}%)</span>
                      <span className="font-extrabold" style={{ color: "#B45309" }}>+ {formatCurrency(gstAmt)}</span>
                    </div>
                  )}
                  {stAmt > 0 && (
                    <div className="flex justify-between gap-8">
                      <span style={{ color: "#B45309" }}>Sales Tax ({sP}%)</span>
                      <span className="font-extrabold" style={{ color: "#B45309" }}>+ {formatCurrency(stAmt)}</span>
                    </div>
                  )}
                  {braAmt > 0 && (
                    <div className="flex justify-between gap-8">
                      <span style={{ color: "#B45309" }}>BRA ({bP}%)</span>
                      <span className="font-extrabold" style={{ color: "#B45309" }}>+ {formatCurrency(braAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8 pt-1 border-t border-dashed border-[var(--gray-200)]">
                    <span className="font-bold" style={{ color: "var(--gray-800)" }}>Total Due</span>
                    <span className="font-extrabold" style={{ color: "var(--red)" }}>{formatCurrency(totalDue)}</span>
                  </div>
                  <div className="flex justify-between gap-8">
                    <span style={{ color: "var(--gray-700)" }}>Payment</span>
                    <span className="font-extrabold" style={{ color: "var(--green)" }}>− {formatCurrency(paid)}</span>
                  </div>
                  <div className="flex justify-between gap-8 pt-1.5 border-t border-[var(--gray-100)]" style={{ marginTop: 2 }}>
                    <span className="font-bold" style={{ color: "var(--gray-800)" }}>Remaining Balance</span>
                    <span className="font-extrabold" style={{ color: due > 0 ? "var(--red)" : "var(--green)" }}>{formatCurrency(due)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 w-full flex-wrap">
                <button onClick={closeInvoiceModal} disabled={invSaving}
                  className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white disabled:opacity-50"
                  style={{ borderColor: "var(--gray-200)", color: "var(--gray-700)" }}>
                  Cancel
                </button>
                <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => void handleSaveInvoice("challan")} disabled={invSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white disabled:opacity-50"
                  style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
                  title="Save invoice and open delivery challan">
                  {invSaving ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />} Delivery Challan
                </button>
                <button onClick={() => void handleSaveInvoice("a4")} disabled={invSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all disabled:opacity-50"
                  style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--blue-pale)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  title="Save and print A5 landscape">
                  {invSaving ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} A5 Landscape
                </button>

                <button onClick={() => void handleSaveInvoice()} disabled={invSaving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}>
                  <FileText size={13} /> {invSaving ? "Saving…" : editingInvoiceId ? `Update Invoice ${invNextNum}` : "Save Invoice"}
                </button>
                </div>
              </div>
            </div>
              );
            })()}
          </div>
        </div>
      )}

      {productCreate && (
        <ProductCreateModal
          initialName={productCreate.initialName}
          existingProducts={invProducts}
          onClose={() => setProductCreate(null)}
          onCreated={handleProductCreated}
        />
      )}

      {/* Receive Payment Modal */}
      {showReceiveModal && receiveAccount && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.3)" }}>
          <div className="bg-white rounded-[20px] w-[420px] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
              <div>
                <h2 className="text-[15px] font-bold" style={{ color: "var(--gray-900)" }}>Receive Payment</h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--gray-800)" }}>{receiveAccount.name}</p>
              </div>
              <button onClick={() => { setShowReceiveModal(false); setReceiveAccount(null); }}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
                <X size={12} />
              </button>
            </div>

            {/* Current balance — matches ledger (invoices + cashbook), not DB field alone */}
            {(() => {
              const recvSigned = effectivePartySigned.get(receiveAccount.id) ?? 0;
              const bg =
                recvSigned > 0 ? "var(--green-light)" : recvSigned < 0 ? "var(--red-light)" : "var(--gray-100)";
              const fg = recvSigned > 0 ? "var(--green)" : recvSigned < 0 ? "var(--red)" : "var(--gray-600)";
              const label =
                recvSigned > 0 ? "credit" : recvSigned < 0 ? "debit" : "settled";
              return (
            <div className="mx-5 mt-4 px-4 py-3 rounded-[10px] flex flex-col gap-1"
              style={{ background: bg }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold" style={{ color: "var(--gray-800)" }}>Current balance</span>
                <span className="text-[13px] font-extrabold font-mono" style={{ color: fg }}>
                  {formatCurrency(Math.abs(recvSigned))}
                  <span className="text-[10px] font-bold ml-1 uppercase">{label}</span>
                </span>
              </div>
              <p className="text-[9px] font-medium m-0" style={{ color: "var(--gray-600)" }}>
                Same total as the account ledger (invoices and cashbook).
              </p>
            </div>
              );
            })()}

            <div className="p-5">
              <div className="flex flex-col gap-3.5">
                {/* Date */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Date</label>
                  <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={inputStyle} />
                </div>

                {/* Payment Method */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Payment Method</label>
                  <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                    {paymentMethods.map((m) => (
                      <button key={m.id} onClick={() => setRMethod(m.name)}
                        className="flex-1 min-w-[80px] py-2 text-[11.5px] font-semibold border-none cursor-pointer transition-all"
                        style={{
                          background: rMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                          color: rMethod === m.name ? "#fff" : "var(--gray-500)",
                        }}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description (optional) */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                    Description <span style={{ color: "var(--gray-700)" }}>(optional)</span>
                  </label>
                  <input value={rDesc} onChange={(e) => setRDesc(e.target.value)}
                    placeholder={`Payment received from ${receiveAccount.name}`}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={inputStyle} />
                </div>

                {/* Amount */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                    Amount <span style={{ color: "var(--red)" }}>*</span>
                  </label>
                  <input value={rAmount} onChange={(e) => setRAmount(e.target.value)}
                    type="number" min="0.01" step="0.01" placeholder="0"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                    style={inputStyle} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
              <button onClick={() => { setShowReceiveModal(false); setReceiveAccount(null); }}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                Cancel
              </button>
              <button onClick={() => void handleReceivePayment()} disabled={receivingSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60"
                style={{ background: "#25D366", boxShadow: "0 2px 10px rgba(37, 211, 102, 0.35)" }}
                title="Save payment and send its WhatsApp receipt"
              >
                <WhatsAppIcon size={15} /> {receivingSaving ? "Saving…" : "Receive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Party Invoices Modal */}
      {showPartyInvoicesModal && partyInvoicesAccount && (
        <div
          className="no-print fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-6 px-4 pb-8 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.35)" }}
        >
          <div
            className="bg-white rounded-[20px] w-[min(860px,100%)] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            {/* Modal header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]"
              style={{ background: "linear-gradient(90deg, #6D28D9, #7C3AED)" }}
            >
              <div className="flex items-center gap-3">
                {viewingInvoice && (
                  <button
                    type="button"
                    onClick={() => { setViewingInvoice(null); setViewingInvoiceItems([]); }}
                    className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.2)", color: "white" }}
                    title="Back to list"
                  >
                    <ArrowLeft size={13} />
                  </button>
                )}
                <div>
                  <h2 className="text-[15px] font-bold text-white">
                    {viewingInvoice ? `Invoice ${viewingInvoice.invoice_number}` : "Invoices"}
                  </h2>
                  <p className="text-[11px] mt-0.5 text-white/70">{partyInvoicesAccount.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePartyInvoicesModal}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "rgba(255,255,255,0.2)", color: "white" }}
              >
                <X size={12} />
              </button>
            </div>

            {/* Invoice list */}
            {!viewingInvoice && (
              <div className="overflow-x-auto">
                {partyInvoicesLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2" style={{ color: "#7C3AED" }}>
                    <Loader2 size={18} className="animate-spin" /> Loading invoices…
                  </div>
                ) : partyInvoicesList.length === 0 ? (
                  <p className="text-center py-12 text-[13px]" style={{ color: "var(--gray-500)" }}>
                    No invoices found for this party.
                  </p>
                ) : (
                  <table className={`${DT.table} min-w-[600px]`}>
                    <thead>
                      <tr>
                        {["#", "Invoice #", "Date", "Description", "Total", "Received on invoice", "Remaining", "Status", ""].map((h, i) => (
                          <th
                            key={`pi-h-${i}`}
                            className={`${DT.th} ${i === 0 ? "text-center w-10" : "text-left"}`}
                            style={DT.thStyle}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {partyInvoicesList.map((inv, idx) => {
                        const statusColor =
                          inv.payment_status === "paid"
                            ? { bg: "var(--green-light)", color: "var(--green)" }
                            : inv.payment_status === "partial"
                            ? { bg: "#FEF3C7", color: "#B45309" }
                            : { bg: "var(--red-light)", color: "var(--red)" };
                        const desc = [inv.job_notes, inv.job_name].map((s) => String(s || "").trim()).find(Boolean) || "—";
                        return (
                          <tr key={inv.id} className={DT.row}>
                            <td className={`${DT.td} text-center font-mono text-[13px] font-semibold tabular-nums`} style={{ color: "var(--gray-600)" }}>
                              {idx + 1}
                            </td>
                            <td className={`${DT.td} font-mono font-bold text-[13px]`} style={{ color: "#6D28D9" }}>
                              {inv.invoice_number}
                            </td>
                            <td className={`${DT.td} text-[12.5px]`} style={{ color: "var(--gray-800)", whiteSpace: "nowrap" }}>
                              {formatDate(inv.invoice_date)}
                            </td>
                            <td className={`${DT.td} text-[12.5px] max-w-[200px] truncate`} style={{ color: "var(--gray-700)" }} title={desc}>
                              {desc}
                            </td>
                            <td className={`${DT.td} font-mono font-bold text-[14px] text-right`} style={{ color: "var(--gray-900)" }}>
                              {formatCurrency(inv.grand_total)}
                            </td>
                            <td className={`${DT.td} font-mono font-semibold text-[13px] text-right`} style={{ color: "var(--green)" }}>
                              {formatCurrency(inv.amount_received)}
                            </td>
                            <td className={`${DT.td} font-mono text-right`}>{formatCurrency(Math.max(0, inv.balance_due))}</td>
                            <td className={DT.td}>
                              <span className={DT.badge} style={{ background: statusColor.bg, color: statusColor.color }}>
                                {inv.payment_status}
                              </span>
                            </td>
                            <td className={DT.td}>
                              <button
                                type="button"
                                onClick={() => void openInvoiceDetail(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all"
                                style={{ borderColor: "#7C3AED", color: "#7C3AED" }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F3FF")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                              >
                                <Eye size={11} /> View
                              </button>
                              {userProfile?.isAdmin && <button type="button" onClick={() => void deletePartyInvoice(inv)} disabled={deletingInvoiceId !== null}
                                className="inline-flex items-center gap-1 ml-2 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50"
                                style={{ borderColor: "var(--red)", color: "var(--red)" }}>
                                {deletingInvoiceId === inv.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
                              </button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Individual invoice detail */}
            {viewingInvoice && (
              <div className="p-5">
                {/* Invoice meta */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                  {[
                    { label: "Invoice #", value: viewingInvoice.invoice_number },
                    { label: "Date", value: formatDate(viewingInvoice.invoice_date) },
                    { label: "Party", value: viewingInvoice.client_name },
                    { label: "Phone", value: viewingInvoice.client_phone || "—" },
                    { label: "Payment Method", value: viewingInvoice.payment_method || "—" },
                    { label: "Balance Due", value: formatCurrency(viewingInvoice.balance_due) },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-[var(--gray-50)] rounded-[10px] px-3 py-2.5">
                      <div className="text-[10px] font-bold tracking-[1px] uppercase mb-0.5" style={{ color: "#6D28D9" }}>{label}</div>
                      <div className="text-[13px] font-semibold" style={{ color: "var(--gray-900)" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {viewingInvoice.job_notes && (
                  <div className="mb-4 px-3.5 py-2.5 rounded-[10px] border border-[var(--gray-100)] text-[12.5px]" style={{ color: "var(--gray-700)", background: "var(--gray-50)" }}>
                    <span className="font-bold" style={{ color: "#6D28D9" }}>Description: </span>{viewingInvoice.job_notes}
                  </div>
                )}

                {/* Items */}
                {viewingInvoiceItemsLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2" style={{ color: "#7C3AED" }}>
                    <Loader2 size={16} className="animate-spin" /> Loading items…
                  </div>
                ) : viewingInvoiceItems.length > 0 ? (
                  <div className="rounded-[10px] border border-[var(--gray-100)] overflow-hidden mb-5">
                    <table className="w-full border-collapse" style={{ minWidth: 500 }}>
                      <thead>
                        <tr>
                          {["SN", "Description", "Qty", "Rate", "Amount"].map((h, i) => (
                            <th
                              key={`ii-h-${i}`}
                              className={`${DT.thDense} ${i === 0 ? "text-center" : i >= 2 ? "text-right" : "text-left"}`}
                              style={DT.thStyle}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {viewingInvoiceItems.map((item, i) => (
                          <tr key={item.id} className={DT.row}>
                            <td className={`${DT.tdDense} text-center font-mono text-[12px]`} style={{ color: "var(--gray-500)" }}>{i + 1}</td>
                            <td className={`${DT.tdDense} text-[12.5px]`} style={{ color: "var(--gray-900)" }}>
                              <div className="font-semibold">{item.category || item.description || "—"}</div>
                              {item.category && item.description ? (
                                <div className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--gray-500)" }}>{item.description}</div>
                              ) : null}
                            </td>
                            <td className={`${DT.tdDense} font-mono text-right text-[12.5px]`} style={{ color: "var(--gray-700)" }}>{item.qty} {item.unit && unitLabel(item.unit)}</td>

                            <td className={`${DT.tdDense} font-mono text-right text-[12.5px]`} style={{ color: "var(--gray-700)" }}>{formatCurrency(invoiceUnitRate(item))}</td>
                            <td className={`${DT.tdDense} font-mono text-right font-bold text-[13px]`} style={{ color: "var(--gray-900)" }}>{formatCurrency(item.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[12.5px] mb-5 text-center py-4" style={{ color: "var(--gray-500)" }}>No line items recorded for this invoice.</p>
                )}

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-[min(280px,100%)] flex flex-col gap-1.5">
                    {[
                      { label: "New Bill", value: formatCurrency(viewingInvoice.subtotal), bold: false, color: undefined },
                      ...(viewingInvoice.discount_amount > 0
                        ? [{ label: `Discount`, value: `− ${formatCurrency(viewingInvoice.discount_amount)}`, bold: false, color: undefined }]
                        : []),
                      ...(viewingInvoice.gst_amount > 0
                        ? [{ label: `GST (${viewingInvoice.gst_pct}%)`, value: `+ ${formatCurrency(viewingInvoice.gst_amount)}`, bold: false, color: "#B45309" }]
                        : []),
                      ...(viewingInvoice.stax_amount > 0
                        ? [{ label: `Sales Tax (${viewingInvoice.stax_pct}%)`, value: `+ ${formatCurrency(viewingInvoice.stax_amount)}`, bold: false, color: "#B45309" }]
                        : []),
                      ...(viewingInvoice.bra_amount > 0
                        ? [{ label: `BRA (${viewingInvoice.bra_pct}%)`, value: `+ ${formatCurrency(viewingInvoice.bra_amount)}`, bold: false, color: "#B45309" }]
                        : []),
                      { label: "Grand Total", value: formatCurrency(viewingInvoice.grand_total), bold: true, color: undefined },
                      { label: "Amount Received", value: formatCurrency(viewingInvoice.amount_received), bold: false, color: undefined },
                      { label: "Balance Due", value: formatCurrency(viewingInvoice.balance_due), bold: true, color: undefined },
                    ].map(({ label, value, bold, color }) => (
                      <div key={label} className="flex items-center justify-between px-3 py-1.5 rounded-[8px]" style={{ background: bold ? "#F5F3FF" : "transparent" }}>
                        <span className="text-[12px]" style={{ color: color ?? (bold ? "#6D28D9" : "var(--gray-600)"), fontWeight: bold ? 700 : 500 }}>{label}</span>
                        <span className="font-mono text-[13px]" style={{ color: color ?? (bold ? "#6D28D9" : "var(--gray-800)"), fontWeight: bold ? 800 : 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-3.5 border-t border-[var(--gray-100)]">
              {viewingInvoice ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void openEditInvoiceModal(viewingInvoice)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all"
                    style={{ borderColor: "#7C3AED", color: "#7C3AED" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F3FF")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    <Edit size={13} /> Edit Invoice
                  </button>
                  {userProfile?.isAdmin && <button type="button" onClick={() => void deletePartyInvoice(viewingInvoice)} disabled={deletingInvoiceId !== null || invPrinting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50"
                    style={{ borderColor: "var(--red)", color: "var(--red)" }}>
                    {deletingInvoiceId ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete Invoice
                  </button>}
                  <button
                    type="button"
                    disabled={invPrinting || viewingInvoiceItemsLoading}
                    onClick={() => void printViewingInvoice()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all disabled:opacity-50"
                    style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--blue-pale)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    {invPrinting ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                    A5 Landscape
                  </button>

                  <button
                    type="button"
                    disabled={invPrinting || viewingInvoiceItemsLoading}
                    onClick={() => router.push(`/delivery-challan?invoice=${encodeURIComponent(viewingInvoice.id)}`)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-50"
                    style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
                  >
                    <ClipboardList size={13} /> Delivery Challan
                  </button>

                  <button
                    type="button"
                    disabled={invPrinting || viewingInvoiceItemsLoading}
                    onClick={() => void downloadInvoicePdf()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all disabled:opacity-50"
                    style={{ borderColor: "#0277b5", color: "#0277b5" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F9FF")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    {invPrinting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    Download PDF
                  </button>
                  <button
                    type="button"
                    disabled={viewingInvoiceItemsLoading}
                    onClick={sendViewingInvoiceWhatsApp}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer transition-all disabled:opacity-50"
                    style={{ borderColor: "#0277b5", color: "#0277b5" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F9FF")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                    title="Send invoice details to customer on WhatsApp"
                  >
                    <WhatsAppIcon size={13} /> WhatsApp
                  </button>
                </div>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={closePartyInvoicesModal}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.3)" }}
          >
          <div className="bg-white rounded-[20px] w-[500px] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
              <h2 className="text-[15px] font-bold">{editingId ? "Edit Account" : "Add Account"}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer" style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
                <X size={12} />
              </button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-3.5">
                {/* Head Account */}
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Head Account</label>
                  <select value={fHead} onChange={(e) => setFHead(e.target.value)}
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none cursor-pointer" style={inputStyle}>
                    <option value="">— Select Head —</option>
                    {heads.map((h) => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
                  </select>
                </div>

                {/* Account Name * */}
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                    Account Name <span style={{ color: "var(--red)" }}>*</span>
                  </label>
                  <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Paktel Pvt Ltd"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none"
                    style={errors.name ? errorInputStyle : inputStyle} />
                  {errors.name && <span className="text-[10px] font-medium" style={{ color: "var(--red)" }}>{errors.name}</span>}
                </div>

                {/* WhatsApp No * — only numbers, 11 digits */}
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                    WhatsApp No <span style={{ color: "var(--red)" }}>*</span>
                  </label>
                  <input value={fWa} onChange={(e) => setFWa(validatePhone(e.target.value))}
                    placeholder="03001234567" maxLength={11} inputMode="numeric"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                    style={errors.wa ? errorInputStyle : inputStyle} />
                  {errors.wa && <span className="text-[10px] font-medium" style={{ color: "var(--red)" }}>{errors.wa}</span>}
                  {fWa && fWa.length < 11 && !errors.wa && (
                    <span className="text-[10px] font-medium" style={{ color: "var(--orange)" }}>{fWa.length}/11 digits</span>
                  )}
                </div>

                {/* Address */}
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Address</label>
                  <input value={fAddr} onChange={(e) => setFAddr(e.target.value)} placeholder="Full address"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
                </div>

                {/* Opening Balance */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Opening Balance</label>
                  <input value={fBal} onChange={(e) => setFBal(e.target.value)} type="number" placeholder="0"
                    className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
                </div>

                {/* Credit / Debit */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Balance Type</label>
                  <div className="flex border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                    <button
                      onClick={() => setFBalType("credit")}
                      className="flex-1 py-2 text-[12.5px] font-semibold border-none cursor-pointer transition-all"
                      style={{
                        background: fBalType === "credit" ? "var(--blue)" : "var(--gray-50)",
                        color: fBalType === "credit" ? "#fff" : "var(--gray-500)",
                      }}>
                      Credit
                    </button>
                    <button
                      onClick={() => setFBalType("debit")}
                      className="flex-1 py-2 text-[12.5px] font-semibold border-none cursor-pointer transition-all"
                      style={{
                        background: fBalType === "debit" ? "var(--red)" : "var(--gray-50)",
                        color: fBalType === "debit" ? "#fff" : "var(--gray-500)",
                      }}>
                      Debit
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                Cancel
              </button>
              <button onClick={() => run(handleSave)} disabled={saving}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}>
                {saving ? "Saving…" : (editingId ? "Update Account" : "Save Account")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Shared measured A5 landscape invoice pages. */}
    <div className="inv-a4-print-only">
      {viewingInvoice && <SalesInvoiceDocument invoice={viewingInvoice} items={viewingInvoiceItems} />}
    </div>

    {/* Ledger print layout — mirrors the A4 invoice template (same header, colors, borders, footer) */}
    {ledgerAccount && (
      <div ref={ledgerPdfRef} className="ledger-a4-print-only" style={{ background: "#fff", fontFamily: "Arial, Helvetica, sans-serif", color: "#111", fontSize: 13 }}>
        <PrintHeader />

        {/* Title bar — matches A4 invoice */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 12px", background: "#075985", color: "#fff", marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase" }}>Account Ledger</span>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15 }}>
            {(ledgerDateFrom.trim() || ledgerDateTo.trim())
              ? `${ledgerDateFrom.trim() ? formatDate(ledgerDateFrom.trim()) : "Start"} — ${ledgerDateTo.trim() ? formatDate(ledgerDateTo.trim()) : "End"}`
              : "All Transactions"}
          </span>
        </div>

        {/* Statement-for / date block — matches the invoice "Bill To" header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "0 12px", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#111", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Statement For</div>
            <div style={{ fontWeight: 900, color: "#111", fontSize: 16, lineHeight: 1.2 }}>{ledgerAccount.name}</div>
            {ledgerAccount.phone ? <div style={{ fontSize: 13, color: "#111", marginTop: 3 }}>{ledgerAccount.phone}</div> : null}
            {ledgerDateFrom.trim() && ledgerOpeningBefore !== 0 ? (
              <div style={{ fontSize: 12, color: "#111", marginTop: 6, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700 }}>Opening balance (before {formatDate(ledgerDateFrom.trim())}): </span>
                {formatCurrency(Math.abs(ledgerOpeningBefore))}{ledgerOpeningBefore > 0 ? " receivable" : " payable"}
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "right", minWidth: 160 }}>
            <div style={{ marginBottom: 5, display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
              <span style={{ fontSize: 10, color: "#111", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>Printed:</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{formatDate(todayISO())}</span>
            </div>
            <div style={{ marginTop: 4, textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#111" }}>S.S. Diagnostics</div>
            </div>
          </div>
        </div>

        {ledgerAllRows.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <p style={{ padding: "12px 12px", fontSize: 14, color: "#111", margin: 0 }}>No ledger entries for this account.</p>
          </div>
        ) : ledgerDisplayWithBal.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <p style={{ padding: "12px 12px", fontSize: 14, color: "#111", margin: 0 }}>No entries in the selected date range.</p>
          </div>
        ) : (() => {
          // CSS-grid layout (mirrors A4 invoice items table) so column lines extend to the totals.
          const gridCols = "11% 17% 33% 10% 10% 10% 9%";
          const cellPad = "6px 8px";
          return (
            <div style={{ padding: "0 12px", marginBottom: 12, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: 15 }}>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "#075985", color: "#fff" }}>
                {[
                  { label: "Date", align: "left" as const },
                  { label: "Invoice # / Ref", align: "left" as const },
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
                      fontSize: 13,
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

              {/* Item rows */}
              {ledgerDisplayWithBal.map((r, idx) => {
                const items = r.invoiceId ? (ledgerItemsByInvoice[r.invoiceId] ?? []) : [];
                const rowBg = idx % 2 === 0 ? "#fff" : "#f8fafc";
                return (
                <Fragment key={`${r.sortAt}-p-${idx}`}>
                <div
                  style={{ display: "grid", gridTemplateColumns: gridCols, background: rowBg, borderBottom: "1px solid #000" }}
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
                {items.length > 0 ? (
                  <div style={{ border: "1px solid #000", borderTop: 0 }}>
                    <LedgerLineItems items={items.map(item => ({ ...item, rate: invoiceUnitRate(item) }))} />
                  </div>
                ) : null}
                </Fragment>
                );
              })}

              {/* Filler — flex-grows to extend column lines to the totals block */}
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

        {/* Closing balance — mirrors the invoice totals box */}
        {ledgerDisplayWithBal.length > 0 ? (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px", marginBottom: 16 }}>
            <div style={{ width: 260 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 10px", borderTop: "2px solid #111" }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
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
