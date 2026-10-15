"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/helpers";
import {
  Printer, FileText, TrendingDown, Users, CalendarDays,
  ChevronRight, Wallet, Package,
} from "lucide-react";
import type { Invoice, CashbookEntry, Account, HeadAccount, Expense } from "@/lib/database.types";
import { DT } from "@/lib/dataTableStyles";
import { PdfPrintBanner } from "@/components/PdfPrintBanner";
import { PrintFooter } from "@/components/PrintFooter";
import { SearchableSelect } from "@/components/SearchableSelect";
import { usePaymentMethods, normalizePaymentMethod, isLedgerOnlyEntry } from "@/lib/paymentMethods";
import { buildSupplierStatements } from "@/lib/supplierStatement";
import { buildPartyStatements } from "@/lib/partyStatement";
import { SupplierStatementReport } from "@/components/SupplierStatementReport";
import { StockReport } from "@/components/StockReport";
import { DailyStatementReport } from "@/components/DailyStatementReport";
import type { DailyStatementData } from "@/lib/dailyStatement";
import type { StockReportRow } from "@/lib/stockReport";
import type { Supplier, PurchaseOrder } from "@/lib/database.types";

type Tab = "dailystatement" | "account" | "cashbook" | "dailyparties" | "paymentmethod" | "expense" | "supplier" | "party" | "stock";

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  paid:    { bg: "var(--green-light)", color: "var(--green)", label: "Paid" },
  partial: { bg: "var(--orange-light)", color: "#B45309", label: "Partial" },
  unpaid:  { bg: "var(--red-light)", color: "var(--red)", label: "Unpaid" },
};

function reportDateISO(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getPresetDates(preset: string): { from: string; to: string } | null {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "thismonth":
      return { from: reportDateISO(new Date(y, m, 1)), to: reportDateISO(new Date(y, m + 1, 0)) };
    case "lastmonth":
      return { from: reportDateISO(new Date(y, m - 1, 1)), to: reportDateISO(new Date(y, m, 0)) };
    case "last3":
      return { from: reportDateISO(new Date(y, m - 2, 1)), to: reportDateISO(today) };
    case "last6":
      return { from: reportDateISO(new Date(y, m - 5, 1)), to: reportDateISO(today) };
    case "thisyear":
      return { from: reportDateISO(new Date(y, 0, 1)), to: reportDateISO(new Date(y, 11, 31)) };
    default:
      return null;
  }
}

// ── Mini KPI card ──────────────────────────────────────────
function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-white rounded-[12px] border border-[var(--gray-100)] px-4 py-3" style={{ boxShadow: "var(--shadow-xs)" }}>
      <div className="text-[9.5px] font-bold tracking-[1.3px] uppercase mb-1" style={{ color: "var(--gray-800)" }}>{label}</div>
      <div className="text-[14px] font-extrabold font-mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: "var(--gray-800)" }}>{sub}</div>}
    </div>
  );
}

const REPORT_CARDS: { id: Tab; title: string; description: string; icon: ReactNode }[] = [
  { id: "dailystatement", title: "Daily Statement", description: "Income, expenses, returns, invoices and cash movements for any selected date.", icon: <CalendarDays size={22} /> },
  { id: "stock", title: "Stock reports", description: "Stock received, sold and available by product and date, with revenue and estimated gross profit.", icon: <Package size={22} /> },
  { id: "party", title: "Party Statement", description: "All party balances. Select a party to view debit and credit details.", icon: <Users size={22} /> },
  { id: "supplier", title: "Supplier Statement", description: "All supplier balances. Select a supplier to view debit and credit details.", icon: <Users size={22} /> },
  { id: "account", title: "Head Account Statement", description: "Select a head account to view debit and credit for all its parties.", icon: <FileText size={22} /> },
  { id: "cashbook", title: "Cashbook", description: "All cash in and out between the selected dates.", icon: <CalendarDays size={22} /> },
  { id: "dailyparties", title: "Daily Parties", description: "Invoices issued on a selected day by party.", icon: <Users size={22} /> },
  { id: "paymentmethod", title: "Payment Method Report", description: "Cashbook transactions filtered by a single payment method.", icon: <Wallet size={22} /> },
  { id: "expense", title: "Expense Report", description: "All business expenses for a period, with category, method, and totals.", icon: <TrendingDown size={22} /> },
];

function ReportTypeCard({
  title, description, icon, active, onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full rounded-[14px] border p-4 transition-all cursor-pointer flex flex-col gap-2 min-h-[128px]"
      style={{
        borderColor: active ? "var(--blue)" : "var(--gray-100)",
        background: active ? "var(--blue-pale)" : "var(--white)",
        boxShadow: active ? "var(--shadow-sm)" : "var(--shadow-xs)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: active ? "var(--blue-light)" : "var(--gray-50)", color: "var(--blue-deeper)" }}
        >
          {icon}
        </div>
        <ChevronRight size={18} className="shrink-0 mt-1" style={{ color: active ? "var(--blue-deeper)" : "var(--gray-300)" }} />
      </div>
      <div>
        <div className="text-[13px] font-extrabold mb-1" style={{ color: "var(--gray-900)" }}>{title}</div>
        <p className="text-[11px] leading-snug m-0" style={{ color: "var(--gray-800)" }}>{description}</p>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════
export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stockProduct, setStockProduct] = useState("all");
  const [stockProducts, setStockProducts] = useState<{ id: string; name: string }[]>([]);
  const [dailyStatement, setDailyStatement] = useState<DailyStatementData | null>(null);
  const [stockRows, setStockRows] = useState<StockReportRow[]>([]);

  // ── Master filter state ───────────────────────────────────
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(1);
    return reportDateISO(d);
  });
  const [toDate, setToDate] = useState(reportDateISO());
  const [preset, setPreset] = useState("thismonth");
  const [headAccountFilter, setHeadAccountFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const { methods: paymentMethods } = usePaymentMethods();
  // ── Daily tab date state ──────────────────────────────────
  const [dailyDate, setDailyDate] = useState(reportDateISO());

  // ── Data ──────────────────────────────────────────────────
  const [cashbook, setCashbook] = useState<CashbookEntry[]>([]);
  const [headAccounts, setHeadAccounts] = useState<HeadAccount[]>([]);
  const [dailyInvoices, setDailyInvoices] = useState<Invoice[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [supplierData, setSupplierData] = useState<{ suppliers: Supplier[]; purchases: PurchaseOrder[]; payments: CashbookEntry[]; customerNames: string[] }>({ suppliers: [], purchases: [], payments: [], customerNames: [] });
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [partyData, setPartyData] = useState<{ accounts: Account[]; invoices: Invoice[] }>({ accounts: [], invoices: [] });
  const supplierStatements = useMemo(() => buildSupplierStatements(supplierData.suppliers, supplierData.purchases, supplierData.payments, fromDate, toDate, supplierData.customerNames), [supplierData, fromDate, toDate]);
  const partyStatements = useMemo(() => buildPartyStatements(partyData.accounts, partyData.invoices, supplierData.payments, supplierData.suppliers, supplierData.purchases, fromDate, toDate), [partyData, supplierData, fromDate, toDate]);

  const selectedHeadAccount = headAccounts.find(head => head.id === headAccountFilter);
  const headAccountStatements = useMemo(() => {
    const partyIds = new Set(partyData.accounts.filter(account => account.head_id === headAccountFilter).map(account => account.id));
    return partyStatements.filter(statement => partyIds.has(statement.supplier.id));
  }, [partyData.accounts, partyStatements, headAccountFilter]);

  async function fetchSupplierData(): Promise<boolean> {
    setLoading(true);
    setReportGenerated(false);
    try {
      // Full history is required for opening balances and payment allocation.
      const [suppliers, purchases, payments, customers, partyInvoices] = await Promise.all([
        db.from("suppliers").select("*").order("name"),
        db.from("purchase_orders").select("*"),
        db.from("cashbook").select("*"),
        db.from("accounts").select("*"),
        db.from("invoices").select("*"),
      ]);
      const failed = [suppliers, purchases, payments, customers, partyInvoices].find(result => result.error);
      if (failed?.error) throw new Error(failed.error.message);
      setSupplierData({ suppliers: suppliers.data ?? [], purchases: purchases.data ?? [], payments: payments.data ?? [], customerNames: (customers.data ?? []).map((a: { name: string }) => a.name) });
      setPartyData({ accounts: customers.data ?? [], invoices: partyInvoices.data ?? [] });
      setSelectedSupplierId(null);
      return true;
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Could not load statements. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  // ── Fetch main data ───────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    const cashbookQuery = db
      .from("cashbook")
      .select("*")
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    const expensesPeriodQuery = db
      .from("expenses")
      .select("*")
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    const [{ data: cbData }, { data: expPeriod }] = await Promise.all([cashbookQuery, expensesPeriodQuery]);
    if (cbData) setCashbook((cbData as CashbookEntry[]).filter(entry => !isLedgerOnlyEntry(entry)));
    setExpenses((expPeriod ?? []) as Expense[]);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => {
    db.from("products").select("id, name").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error) setGenerateError(error.message);
      if (data) setStockProducts(data);
    });
    db.from("head_accounts").select("*").order("code").then(({ data, error }) => {
      if (error) setGenerateError(error.message);
      if (data) setHeadAccounts(data);
    });
  }, []);


  // ── Fetch daily data ──────────────────────────────────────
  const fetchDailyData = useCallback(async () => {
    setDailyLoading(true);
    const dailyInvoiceQuery = db.from("invoices").select("*").eq("invoice_date", dailyDate).order("created_at", { ascending: true });
    const { data: invData } = await dailyInvoiceQuery;
    if (invData) setDailyInvoices(invData);
    setDailyLoading(false);
  }, [dailyDate]);

  async function handleGenerateReport() {
    setGenerateError(null);
    if (!activeTab) {
      setGenerateError("Choose a report type from the cards above.");
      return;
    }
    if (activeTab !== "dailyparties" && activeTab !== "dailystatement" && (!fromDate || !toDate || fromDate > toDate)) {
      setGenerateError("Select a valid date range. From date must be on or before To date.");
      return;
    }
    if (activeTab === "account" && !selectedHeadAccount) {
      setGenerateError("Select a head account to generate its party statement.");
      return;
    }
    if (activeTab === "paymentmethod" && methodFilter === "all") {
      setGenerateError("Select a payment method to generate this report.");
      return;
    }
    if (activeTab === "dailystatement") {
      setLoading(true);
      setReportGenerated(false);
      setDailyStatement(null);
      try {
        const response = await fetch(`/api/reports/daily-statement?${new URLSearchParams({ date: dailyDate })}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load daily statement.");
        setDailyStatement(result);
      } catch (error) {
        setGenerateError(error instanceof Error ? error.message : "Could not load daily statement.");
        return;
      } finally { setLoading(false); }
    } else if (activeTab === "stock") {
      setLoading(true);
      setReportGenerated(false);
      try {
        const response = await fetch(`/api/reports/stock?${new URLSearchParams({ from: fromDate, to: toDate, product: stockProduct })}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load stock report.");
        setStockRows(result.rows);
      } catch (error) {
        setGenerateError(error instanceof Error ? error.message : "Could not load stock report.");
        return;
      } finally { setLoading(false); }
    } else if (activeTab === "supplier" || activeTab === "party" || activeTab === "account") {
      if (!await fetchSupplierData()) return;
    } else if (activeTab === "dailyparties") {
      await fetchDailyData();
    } else {
      await fetchData();
    }
    setReportGenerated(true);
  }

  function selectReport(t: Tab) {
    setReportGenerated(false);
    setActiveTab(t);
    setGenerateError(null);
    setSelectedSupplierId(null);
  }

  // ── Preset handler ────────────────────────────────────────
  function applyPreset(val: string) {
    setReportGenerated(false);
    setPreset(val);
    const dates = getPresetDates(val);
    if (dates) { setFromDate(dates.from); setToDate(dates.to); }
  }

  // ── Derived: expense report ───────────────────────────────
  const expenseTotal = useMemo(() => expenses.reduce((s, e) => s + Number(e.amount), 0), [expenses]);

  // ── Derived: cashbook running balance ────────────────────────────
  const cashbookWithBal = useMemo(() => {
    return cashbook.reduce<Array<CashbookEntry & { runningBal: number }>>((acc, c) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].runningBal : 0;
      const nextBal = prev + (c.type === "in" ? Number(c.amount) : -Number(c.amount));
      acc.push({ ...c, runningBal: nextBal });
      return acc;
    }, []);
  }, [cashbook]);

  // ── Derived: payment-method filtered cashbook ─────────────
  const methodCashbook = useMemo(() => {
    if (methodFilter === "all") return [] as CashbookEntry[];
    return cashbook.filter((c) => normalizePaymentMethod(c.method) === methodFilter);
  }, [cashbook, methodFilter]);

  const methodOpeningBalance = useMemo(() => {
    if (methodFilter === "all") return 0;
    const m = paymentMethods.find((pm) => pm.name === methodFilter);
    return m ? Number(m.opening_balance) : 0;
  }, [paymentMethods, methodFilter]);

  const methodCashbookWithBal = useMemo(() => {
    return methodCashbook.reduce<Array<CashbookEntry & { runningBal: number }>>((acc, c) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].runningBal : methodOpeningBalance;
      const nextBal = prev + (c.type === "in" ? Number(c.amount) : -Number(c.amount));
      acc.push({ ...c, runningBal: nextBal });
      return acc;
    }, []);
  }, [methodCashbook, methodOpeningBalance]);

  const methodCashIn = useMemo(() => methodCashbook.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0), [methodCashbook]);
  const methodCashOut = useMemo(() => methodCashbook.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0), [methodCashbook]);

  // ── Filter label ──────────────────────────────────────────
  const filterLabel = `${formatDate(fromDate)} - ${formatDate(toDate)}${activeTab === "account" && selectedHeadAccount ? ` / ${selectedHeadAccount.name}` : ""}${activeTab === "paymentmethod" && methodFilter !== "all" ? ` / ${methodFilter}` : ""}${activeTab === "stock" ? ` / ${stockProducts.find(c => c.id === stockProduct)?.name ?? "All products"}` : ""}`;

  // ──────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Screen UI ── */}
      <div className="no-print animate-fade-in">

        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Reports</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Pick a report, set filters, then generate — no charts, export-friendly tables.</p>
        </div>

        {/* Report type cards */}
        <div inert={loading || dailyLoading} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {REPORT_CARDS.map((card) => (
            <ReportTypeCard
              key={card.id}
              title={card.title}
              description={card.description}
              icon={card.icon}
              active={activeTab === card.id}
              onClick={() => selectReport(card.id)}
            />
          ))}
        </div>

        {/* Filters for selected report */}
        {activeTab && (
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4 pb-3 border-b border-[var(--gray-100)]">
              <div>
                <div className="text-[9.5px] font-bold tracking-[1.4px] uppercase mb-0.5" style={{ color: "var(--gray-800)" }}>Filters</div>
                <div className="text-[14px] font-extrabold" style={{ color: "var(--gray-900)" }}>
                  {REPORT_CARDS.find((c) => c.id === activeTab)?.title}
                </div>
                {!reportGenerated && (
                  <p className="text-[11px] m-0 mt-1" style={{ color: "var(--gray-800)" }}>Adjust filters and click Generate to load this report.</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={!activeTab || !reportGenerated}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] bg-white cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}
                >
                  <Printer size={14} /> Print / PDF
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateReport()}
                  disabled={loading || dailyLoading}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}
                >
                  {loading || dailyLoading ? "Loading…" : "Generate report"}
                </button>
              </div>
            </div>

            {generateError && (
              <div className="mb-3 px-3 py-2 rounded-[8px] text-[12px] font-medium" style={{ background: "var(--red-light)", color: "var(--red)" }}>
                {generateError}
              </div>
            )}

            <div inert={loading || dailyLoading} className="flex flex-wrap gap-3 items-end">
              {(activeTab === "dailyparties" || activeTab === "dailystatement") ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor="daily-report-date" className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Report date</label>
                  <input
                    id="daily-report-date"
                    type="date"
                    value={dailyDate}
                    onChange={(e) => { setReportGenerated(false); setDailyDate(e.target.value); }}
                    className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none"
                    style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}
                  />
                </div>
              ) : (
                <>
                  {activeTab === "stock" ? (
                    <div className="flex flex-col gap-1 min-w-[200px] flex-1 max-w-[280px]">
                      <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Product</label>
                      <SearchableSelect value={stockProduct} onChange={value => { setReportGenerated(false); setStockProduct(value); }}
                        options={stockProducts.map(p => ({ value: p.id, label: p.name, searchText: p.name }))}
                        maxResults={10} emptyValue="all" placeholder="All products ? search product"
                        inputClassName="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] w-full focus-visible:outline-2 focus-visible:outline-[var(--blue)]"
                        inputStyle={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
                    </div>
                  ) : activeTab === "paymentmethod" ? (
                    <div className="flex flex-col gap-1 min-w-[200px] flex-1 max-w-[280px]">
                      <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                        Payment method *
                      </label>
                      <SearchableSelect
                        value={methodFilter}
                        onChange={(value) => { setReportGenerated(false); setMethodFilter(value); }}
                        options={paymentMethods.map((m) => ({ value: m.name, label: m.name }))}
                        placeholder="— Select payment method —"
                        emptyValue="all"
                        inputClassName="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none w-full"
                        inputStyle={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}
                      />
                    </div>
                  ) : activeTab === "expense" || activeTab === "cashbook" || activeTab === "supplier" || activeTab === "party" ? null : (
                  <div className="flex flex-col gap-1 min-w-[200px] flex-1 max-w-[280px]">
                    <label htmlFor="head-account-filter" className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Head account *</label>
                    <select id="head-account-filter" value={headAccountFilter}
                      onChange={event => { setReportGenerated(false); setHeadAccountFilter(event.target.value); }}
                      className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] w-full focus-visible:outline-2 focus-visible:outline-[var(--blue)]"
                      style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}>
                      <option value="">Select head account</option>
                      {headAccounts.map(head => <option key={head.id} value={head.id}>{head.code} - {head.name}</option>)}
                    </select>
                  </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Date from</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => { setReportGenerated(false); setFromDate(e.target.value); setPreset(""); }}
                      className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none"
                      style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Date to</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => { setReportGenerated(false); setToDate(e.target.value); setPreset(""); }}
                      className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none"
                      style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Period preset</label>
                    <select
                      value={preset}
                      onChange={(e) => applyPreset(e.target.value)}
                      className="border-[1.5px] rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none cursor-pointer"
                      style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }}
                    >
                      <option value="">Custom range</option>
                      <option value="thismonth">This month</option>
                      <option value="lastmonth">Last month</option>
                      <option value="last3">Last 3 months</option>
                      <option value="last6">Last 6 months</option>
                      <option value="thisyear">This year</option>
                    </select>
                  </div>
                </>
              )}
              <div className="ml-auto text-[11px] font-medium px-3 py-1.5 rounded-[7px] border self-end"
                style={{ color: "var(--gray-800)", background: "var(--gray-50)", borderColor: "var(--gray-100)" }}>
                {(activeTab === "dailyparties" || activeTab === "dailystatement")
                  ? formatDate(dailyDate)
                  : filterLabel}
              </div>
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="text-center py-8 px-4 rounded-[14px] border border-dashed mb-4" style={{ borderColor: "var(--gray-200)", color: "var(--gray-800)" }}>
            <p className="text-[13px] m-0">Select a report card above to open its filters.</p>
          </div>
        )}

        {/* ── TAB: ACCOUNT STATEMENT ────────────────────────── */}
        {reportGenerated && activeTab === "dailystatement" && dailyStatement && <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 mb-4"><DailyStatementReport data={dailyStatement} /></div>}
        {reportGenerated && activeTab === "stock" && <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}><h2 className="text-lg font-extrabold mb-1">Stock reports</h2><p className="text-xs mb-4">{formatDate(fromDate)} — {formatDate(toDate)} · {stockProducts.find(c => c.id === stockProduct)?.name ?? "All products"}</p><StockReport rows={stockRows} /></div>}
        {reportGenerated && activeTab === "party" && <SupplierStatementReport statements={partyStatements} selectedId={selectedSupplierId} onSelect={setSelectedSupplierId} onBack={() => setSelectedSupplierId(null)} party />}

        {reportGenerated && activeTab === "supplier" && <SupplierStatementReport statements={supplierStatements} selectedId={selectedSupplierId} onSelect={setSelectedSupplierId} onBack={() => setSelectedSupplierId(null)} />}

        {reportGenerated && activeTab === "account" && (
          <div>
            <h2 className="text-lg font-extrabold mb-1">Head Account Statement / {selectedHeadAccount?.name}</h2>
            <p className="text-xs mb-4" style={{ color: "var(--gray-800)" }}>{formatDate(fromDate)} - {formatDate(toDate)}</p>
            <SupplierStatementReport statements={headAccountStatements} selectedId={null} party summaryOnly />
          </div>
        )}

        {reportGenerated && activeTab === "cashbook" && (
          <div>
            {/* Daily KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <KpiCard
                label="Cash In"
                value={formatCurrency(cashbook.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0))}
                color="var(--green)"
                sub={`${cashbook.filter((c) => c.type === "in").length} entries`}
              />
              <KpiCard
                label="Cash Out"
                value={formatCurrency(cashbook.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0))}
                color="var(--red)"
                sub={`${cashbook.filter((c) => c.type === "out").length} entries`}
              />
              <KpiCard
                label="Net for Day"
                value={formatCurrency(
                  cashbook.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0) -
                  cashbook.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0)
                )}
                color={
                  cashbook.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0) >=
                  cashbook.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0)
                    ? "var(--green)" : "var(--red)"
                }
              />
            </div>

            <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
              {loading ? (
                <div className="text-center py-10 text-[13px]" style={{ color: "var(--gray-800)" }}>Loading...</div>
              ) : cashbookWithBal.length === 0 ? (
                <div className="py-14 text-center">
                  <TrendingDown size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
                  <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No cashbook entries from {formatDate(fromDate)} to {formatDate(toDate)}.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`${DT.table} min-w-[650px]`}>
                    <thead>
                      <tr>
                        {["#", "Description", "Invoice # / Ref", "Method", "Cash In", "Cash Out", "Running Balance"].map((h) => {
                          const right = ["Cash In", "Cash Out", "Running Balance"].includes(h);
                          return (
                            <th key={h} className={`${DT.thDense} ${right ? "text-right" : "text-left"}`} style={DT.thStyle}>
                              {h}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {cashbookWithBal.map((entry, idx) => (
                        <tr key={entry.id} className={DT.row}>
                          <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{idx + 1}</td>
                          <td className={DT.tdDense}>
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: entry.type === "in" ? "var(--green)" : "var(--red)" }} />
                              <span className={DT.cellPrimary} style={{ color: "var(--gray-900)" }}>{entry.description}</span>
                            </div>
                          </td>
                          <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{entry.reference || "—"}</td>
                          <td className={`${DT.tdDense} ${DT.cellBody}`}>
                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: "var(--gray-100)", color: "var(--gray-900)" }}>{entry.method || "—"}</span>
                          </td>
                          <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: entry.type === "in" ? "var(--green)" : "var(--gray-200)" }}>
                            {entry.type === "in" ? formatCurrency(entry.amount) : "—"}
                          </td>
                          <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: entry.type === "out" ? "var(--red)" : "var(--gray-200)" }}>
                            {entry.type === "out" ? formatCurrency(entry.amount) : "—"}
                          </td>
                          <td className={`${DT.tdDense} font-mono text-right font-extrabold text-[15px]`}
                            style={{ color: entry.runningBal >= 0 ? "var(--green)" : "var(--red)" }}>
                            {formatCurrency(Math.abs(entry.runningBal))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "var(--gray-50)" }}>
                        <td colSpan={4} className={`${DT.tdDense} text-[13.5px] font-bold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-700)" }}>
                          Range Total ({cashbookWithBal.length} entries)
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--green)" }}>
                          {formatCurrency(cashbook.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0))}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--red)" }}>
                          {formatCurrency(cashbook.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0))}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`}
                          style={{ color: (cashbookWithBal.at(-1)?.runningBal ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                          {formatCurrency(Math.abs(cashbookWithBal.at(-1)?.runningBal ?? 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: DAILY PARTIES ────────────────────────────── */}
        {reportGenerated && activeTab === "dailyparties" && (
          <div>
            {/* Daily parties KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <KpiCard label="Invoices Today" value={String(dailyInvoices.length)} color="var(--blue-deeper)" />
              <KpiCard label="Total Billed" value={formatCurrency(dailyInvoices.reduce((s, i) => s + Number(i.grand_total), 0))} color="var(--gray-900)" />
              <KpiCard label="Collected" value={formatCurrency(dailyInvoices.reduce((s, i) => s + Number(i.amount_received), 0))} color="var(--green)" />
              <KpiCard label="Balance Due" value={formatCurrency(dailyInvoices.reduce((s, i) => s + Number(i.balance_due), 0))} color="var(--red)" />
            </div>

            <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
              {dailyLoading ? (
                <div className="text-center py-10 text-[13px]" style={{ color: "var(--gray-800)" }}>Loading...</div>
              ) : dailyInvoices.length === 0 ? (
                <div className="py-14 text-center">
                  <Users size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
                  <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No invoices for {formatDate(dailyDate)}.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`${DT.table} min-w-[750px]`}>
                    <thead>
                      <tr>
                        {["#", "Invoice No", "Party Name", "Job / Description", "Invoice Amount", "Received", "Balance", "Status"].map((h) => {
                          const right = ["Invoice Amount", "Received", "Balance"].includes(h);
                          return (
                            <th key={h} className={`${DT.thDense} ${right ? "text-right" : "text-left"}`} style={DT.thStyle}>
                              {h}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {dailyInvoices.map((inv, idx) => {
                        const st = STATUS_STYLES[inv.payment_status] || STATUS_STYLES.unpaid;
                        return (
                          <tr key={inv.id} className={DT.row}>
                            <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{idx + 1}</td>
                            <td className={DT.tdDense}>
                              <span className="font-mono text-[11px] font-extrabold" style={{ color: "var(--blue-deeper)" }}>{inv.invoice_number}</span>
                            </td>
                            <td className={DT.tdDense}>
                              <div className={DT.cellPrimary} style={{ color: "var(--gray-900)" }}>{inv.client_name}</div>
                              {inv.client_phone && <div className={`${DT.cellBody} mt-0.5`} style={{ color: "var(--gray-800)" }}>{inv.client_phone}</div>}
                            </td>
                            <td className={DT.tdDense}>
                              <div className={DT.cellBody} style={{ color: "var(--gray-700)" }}>{inv.job_name || "—"}</div>
                              {inv.job_location && <div className={`${DT.cellBody} mt-0.5`} style={{ color: "var(--gray-800)" }}>{inv.job_location}</div>}
                            </td>
                            <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: "var(--gray-900)" }}>{formatCurrency(inv.grand_total)}</td>
                            <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: "var(--green)" }}>{formatCurrency(inv.amount_received)}</td>
                            <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`}
                              style={{ color: inv.balance_due > 0 ? "var(--red)" : "var(--green)" }}>
                              {formatCurrency(inv.balance_due)}
                            </td>
                            <td className={DT.tdDense}>
                              <span className={DT.badge} style={{ background: st.bg, color: st.color }}>{st.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "var(--gray-50)" }}>
                        <td colSpan={4} className={`${DT.tdDense} text-[13.5px] font-bold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-700)" }}>
                          Day Total ({dailyInvoices.length} invoices)
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-900)" }}>
                          {formatCurrency(dailyInvoices.reduce((s, i) => s + Number(i.grand_total), 0))}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--green)" }}>
                          {formatCurrency(dailyInvoices.reduce((s, i) => s + Number(i.amount_received), 0))}
                        </td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--red)" }}>
                          {formatCurrency(dailyInvoices.reduce((s, i) => s + Number(i.balance_due), 0))}
                        </td>
                        <td className={`${DT.tdDense} border-t-2 border-[var(--gray-200)]`} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: PAYMENT METHOD REPORT ────────────────────── */}
        {reportGenerated && activeTab === "paymentmethod" && (
          <div>
            {methodFilter === "all" ? (
              <div className="bg-white rounded-[14px] border border-[var(--gray-100)] py-16 text-center" style={{ boxShadow: "var(--shadow-sm)" }}>
                <Wallet size={36} className="mx-auto mb-3" style={{ color: "var(--gray-200)" }} />
                <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--gray-900)" }}>Select a Payment Method</p>
                <p className="text-[12px]" style={{ color: "var(--gray-800)" }}>Choose a payment method in the filters panel, then generate the report.</p>
              </div>
            ) : loading ? (
              <div className="text-center py-10 text-[13px]" style={{ color: "var(--gray-800)" }}>Loading...</div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <KpiCard label="Opening Balance" value={formatCurrency(methodOpeningBalance)} color="var(--blue-deeper)" sub="Before this period" />
                  <KpiCard label="Total Cash In" value={formatCurrency(methodCashIn)} color="var(--green)" sub={`${methodCashbook.filter((c) => c.type === "in").length} entries`} />
                  <KpiCard label="Total Cash Out" value={formatCurrency(methodCashOut)} color="var(--red)" sub={`${methodCashbook.filter((c) => c.type === "out").length} entries`} />
                  <KpiCard label="Closing Balance" value={formatCurrency(methodOpeningBalance + methodCashIn - methodCashOut)} color={(methodOpeningBalance + methodCashIn - methodCashOut) >= 0 ? "var(--green)" : "var(--red)"} sub={methodFilter} />
                </div>

                <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
                  {methodCashbookWithBal.length === 0 ? (
                    <div className="py-14 text-center">
                      <Wallet size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
                      <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No transactions for {methodFilter} in this period.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className={`${DT.table} min-w-[750px]`}>
                        <thead>
                          <tr>
                            {["#", "Date", "Description", "Invoice # / Ref", "Method", "Cash In", "Cash Out", "Running Balance"].map((h) => {
                              const right = ["Cash In", "Cash Out", "Running Balance"].includes(h);
                              return (
                                <th key={h} className={`${DT.thDense} ${right ? "text-right" : "text-left"}`} style={DT.thStyle}>{h}</th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {methodCashbookWithBal.map((entry, idx) => (
                            <tr key={entry.id} className={DT.row}>
                              <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{idx + 1}</td>
                              <td className={`${DT.tdDense} ${DT.cellBody} whitespace-nowrap`} style={{ color: "var(--gray-900)" }}>{formatDate(entry.date)}</td>
                              <td className={DT.tdDense}>
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: entry.type === "in" ? "var(--green)" : "var(--red)" }} />
                                  <span className={DT.cellPrimary} style={{ color: "var(--gray-900)" }}>{entry.description}</span>
                                </div>
                              </td>
                              <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{entry.reference || "—"}</td>
                              <td className={`${DT.tdDense} ${DT.cellBody}`}>
                                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: "var(--gray-100)", color: "var(--gray-900)" }}>{normalizePaymentMethod(entry.method)}</span>
                              </td>
                              <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: entry.type === "in" ? "var(--green)" : "var(--gray-200)" }}>
                                {entry.type === "in" ? formatCurrency(entry.amount) : "—"}
                              </td>
                              <td className={`${DT.tdDense} font-mono text-right font-bold text-[15px]`} style={{ color: entry.type === "out" ? "var(--red)" : "var(--gray-200)" }}>
                                {entry.type === "out" ? formatCurrency(entry.amount) : "—"}
                              </td>
                              <td className={`${DT.tdDense} font-mono text-right font-extrabold text-[15px]`}
                                style={{ color: entry.runningBal >= 0 ? "var(--green)" : "var(--red)" }}>
                                {formatCurrency(Math.abs(entry.runningBal))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "var(--gray-50)" }}>
                            <td colSpan={5} className={`${DT.tdDense} text-[13.5px] font-bold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-700)" }}>
                              Total ({methodCashbook.length} entries) — {methodFilter}
                            </td>
                            <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--green)" }}>{formatCurrency(methodCashIn)}</td>
                            <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--red)" }}>{formatCurrency(methodCashOut)}</td>
                            <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`}
                              style={{ color: (methodCashbookWithBal.at(-1)?.runningBal ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                              {formatCurrency(Math.abs(methodCashbookWithBal.at(-1)?.runningBal ?? 0))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: EXPENSE REPORT ───────────────────────────── */}
        {reportGenerated && activeTab === "expense" && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <KpiCard label="Total Expenses" value={formatCurrency(expenseTotal)} color="var(--red)" sub={`${expenses.length} entries`} />
              <KpiCard label="Entries" value={String(expenses.length)} color="var(--blue-deeper)" />
              <KpiCard label="Period" value={`${formatDate(fromDate)} — ${formatDate(toDate)}`} color="var(--gray-900)" />
            </div>
            <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
              {loading ? (
                <div className="text-center py-10 text-[13px]" style={{ color: "var(--gray-800)" }}>Loading...</div>
              ) : expenses.length === 0 ? (
                <div className="py-14 text-center">
                  <TrendingDown size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
                  <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No expenses found for this period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`${DT.table} min-w-[850px]`}>
                    <thead>
                      <tr>
                        {["#", "Expense No", "Date", "Category", "Invoice", "Method", "Amount"].map((h) => {
                          const right = h === "Amount";
                          return <th key={h} className={`${DT.thDense} ${right ? "text-right" : "text-left"} whitespace-nowrap`} style={DT.thStyle}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((e, idx) => (
                        <tr key={e.id} className={DT.row}>
                          <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{idx + 1}</td>
                          <td className={`${DT.tdDense} ${DT.cellBody} font-mono`} style={{ color: "var(--blue-deeper)" }}>{e.expense_number || "—"}</td>
                          <td className={`${DT.tdDense} ${DT.cellBody} whitespace-nowrap`} style={{ color: "var(--gray-900)" }}>{formatDate(e.date)}</td>
                          <td className={`${DT.tdDense} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{e.category || "—"}</td>
                          <td className={`${DT.tdDense} ${DT.cellBody}`} style={{ color: "var(--gray-700)" }}>{e.invoice_number || "—"}</td>
                          <td className={DT.tdDense}><span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: "var(--gray-100)", color: "var(--gray-900)" }}>{e.method}</span></td>
                          <td className={`${DT.tdDense} font-mono text-right font-extrabold text-[15px]`} style={{ color: "var(--red)" }}>{formatCurrency(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "var(--gray-50)" }}>
                        <td colSpan={6} className={`${DT.tdDense} text-[13.5px] font-bold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--gray-700)" }}>Total ({expenses.length} entries)</td>
                        <td className={`${DT.tdDense} font-mono text-right text-[15px] font-extrabold border-t-2 border-[var(--gray-200)]`} style={{ color: "var(--red)" }}>{formatCurrency(expenseTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Print Layout (A4 — flex column pins footer to page bottom) ── */}
      <div className={`ledger-a4-print-only a4-report${activeTab === "stock" ? " a4-report-wide" : ""}`} style={{ background: "#fff", fontFamily: "Arial, sans-serif" }}>
        {reportGenerated && activeTab ? (
          <>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <PdfPrintBanner subtitle="Reports" />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px 8px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#555" }}>
            {(activeTab === "dailyparties" || activeTab === "dailystatement")
              ? `Date: ${formatDate(dailyDate)}`
              : `Period: ${formatDate(fromDate)} — ${formatDate(toDate)}`}
            {activeTab === "account" && selectedHeadAccount && <span style={{ marginLeft: 8, color: "#888" }}> / Head account: {selectedHeadAccount.name}</span>}
            {activeTab === "paymentmethod" && methodFilter !== "all" && <span style={{ marginLeft: 8, color: "#888" }}>· Method: {methodFilter}</span>}
          </div>
          <div style={{ fontWeight: 900, color: "#075985", fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>
            {{ dailystatement: "Daily Statement", stock: "Stock reports", account: "Head Account Statement", cashbook: "Cashbook", dailyparties: "Daily Parties Report", paymentmethod: "Payment Method Report", expense: "Expense Report", supplier: "Supplier Statement", party: "Party Statement" }[activeTab]}
          </div>
        </div>

        {activeTab === "dailystatement" && dailyStatement && <DailyStatementReport data={dailyStatement} />}
        {activeTab === "stock" && <><p className="text-xs mb-3">Product: {stockProducts.find(c => c.id === stockProduct)?.name ?? "All products"}</p><StockReport rows={stockRows} /></>}
        {activeTab === "party" && <SupplierStatementReport statements={partyStatements} selectedId={selectedSupplierId} print party />}

        {activeTab === "supplier" && <SupplierStatementReport statements={supplierStatements} selectedId={selectedSupplierId} print />}

        {/* Print summary */}

        {/* Print table for cashbook (selected range) */}
        {activeTab === "cashbook" && (
          cashbookWithBal.length === 0 ? (
            <p style={{ fontSize: 12, color: "#666", padding: "12px 10px" }}>
              No cashbook entries from {formatDate(fromDate)} to {formatDate(toDate)}.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#075985" }}>
                  {["#", "Description", "Invoice # / Ref", "Method", "Cash In", "Cash Out", "Running Balance"].map((h) => (
                    <th key={h} style={{ color: "#fff", fontWeight: 700, textAlign: "left", padding: "7px 8px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashbookWithBal.map((entry, idx) => (
                  <tr key={entry.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 8px", color: "#999" }}>{idx + 1}</td>
                    <td style={{ padding: "6px 8px" }}>{entry.description}</td>
                    <td style={{ padding: "6px 8px", color: "#666" }}>{entry.reference || "—"}</td>
                    <td style={{ padding: "6px 8px", color: "#666" }}>{entry.method || "—"}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 700, color: entry.type === "in" ? "#16a34a" : "#999" }}>
                      {entry.type === "in" ? formatCurrency(entry.amount) : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 700, color: entry.type === "out" ? "#dc2626" : "#999" }}>
                      {entry.type === "out" ? formatCurrency(entry.amount) : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 800, color: entry.runningBal >= 0 ? "#16a34a" : "#dc2626" }}>
                      {formatCurrency(Math.abs(entry.runningBal))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f3f4f6", borderTop: "2px solid #dc2626" }}>
                  <td colSpan={4} style={{ padding: "8px 8px", fontWeight: 900, fontSize: 12 }}>
                    Range total — {cashbookWithBal.length} {cashbookWithBal.length !== 1 ? "entries" : "entry"}
                  </td>
                  <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", color: "#16a34a", fontSize: 13 }}>
                    {formatCurrency(cashbook.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0))}
                  </td>
                  <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", color: "#dc2626", fontSize: 13 }}>
                    {formatCurrency(cashbook.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0))}
                  </td>
                  <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", fontSize: 13, color: (cashbookWithBal.at(-1)?.runningBal ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                    {formatCurrency(Math.abs(cashbookWithBal.at(-1)?.runningBal ?? 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          )
        )}

        {/* Print: daily parties */}
        {activeTab === "dailyparties" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#075985" }}>
                {["#", "Invoice No", "Party Name", "Job / Description", "Invoice Amount", "Received", "Balance", "Status"].map((h) => (
                  <th key={h} style={{ color: "#fff", fontWeight: 700, textAlign: "left", padding: "7px 8px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dailyInvoices.map((inv, idx) => (
                <tr key={inv.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px", color: "#999" }}>{idx + 1}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 800, color: "#075985", fontFamily: "monospace" }}>{inv.invoice_number}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{inv.client_name}</td>
                  <td style={{ padding: "6px 8px", color: "#666" }}>{inv.job_name || "—"}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 800, fontFamily: "monospace", textAlign: "right" }}>{formatCurrency(inv.grand_total)}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 700, fontFamily: "monospace", textAlign: "right", color: "#16a34a" }}>{formatCurrency(inv.amount_received)}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 800, fontFamily: "monospace", textAlign: "right", color: inv.balance_due > 0 ? "#dc2626" : "#16a34a" }}>{formatCurrency(inv.balance_due)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, textTransform: "uppercase",
                      background: inv.payment_status === "paid" ? "#dcfce7" : inv.payment_status === "partial" ? "#fff7ed" : "#fef2f2",
                      color: inv.payment_status === "paid" ? "#16a34a" : inv.payment_status === "partial" ? "#ea580c" : "#dc2626" }}>
                      {inv.payment_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Print: head account statement */}
        {activeTab === "account" && <SupplierStatementReport statements={headAccountStatements} selectedId={null} print party summaryOnly />}

        {/* Print: payment method report */}
        {activeTab === "paymentmethod" && (
          methodCashbookWithBal.length === 0 ? (
            <p style={{ fontSize: 12, color: "#666", padding: "12px 10px" }}>
              No transactions for {methodFilter} between {formatDate(fromDate)} and {formatDate(toDate)}.
            </p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
                {[
                  { label: "Opening Balance", val: formatCurrency(methodOpeningBalance), color: "#1d4ed8" },
                  { label: "Total Cash In", val: formatCurrency(methodCashIn), color: "#16a34a" },
                  { label: "Total Cash Out", val: formatCurrency(methodCashOut), color: "#dc2626" },
                  { label: "Closing Balance", val: formatCurrency(methodOpeningBalance + methodCashIn - methodCashOut), color: (methodOpeningBalance + methodCashIn - methodCashOut) >= 0 ? "#16a34a" : "#dc2626" },
                ].map((c) => (
                  <div key={c.label} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 }}>{c.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: c.color, fontFamily: "monospace" }}>{c.val}</div>
                  </div>
                ))}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "#075985" }}>
                    {["#", "Date", "Description", "Invoice # / Ref", "Method", "Cash In", "Cash Out", "Running Balance"].map((h) => (
                      <th key={h} style={{ color: "#fff", fontWeight: 700, textAlign: "left", padding: "7px 8px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {methodCashbookWithBal.map((entry, idx) => (
                    <tr key={entry.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "6px 8px", color: "#999" }}>{idx + 1}</td>
                      <td style={{ padding: "6px 8px", color: "#555" }}>{formatDate(entry.date)}</td>
                      <td style={{ padding: "6px 8px" }}>{entry.description}</td>
                      <td style={{ padding: "6px 8px", color: "#666" }}>{entry.reference || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#666" }}>{normalizePaymentMethod(entry.method)}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 700, textAlign: "right", color: entry.type === "in" ? "#16a34a" : "#999" }}>
                        {entry.type === "in" ? formatCurrency(entry.amount) : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 700, textAlign: "right", color: entry.type === "out" ? "#dc2626" : "#999" }}>
                        {entry.type === "out" ? formatCurrency(entry.amount) : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 800, textAlign: "right", color: entry.runningBal >= 0 ? "#16a34a" : "#dc2626" }}>
                        {formatCurrency(Math.abs(entry.runningBal))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#f3f4f6", borderTop: "2px solid #dc2626" }}>
                    <td colSpan={5} style={{ padding: "8px 8px", fontWeight: 900, fontSize: 12 }}>
                      Total — {methodCashbookWithBal.length} {methodCashbookWithBal.length !== 1 ? "entries" : "entry"} · {methodFilter}
                    </td>
                    <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", color: "#16a34a", fontSize: 13, textAlign: "right" }}>{formatCurrency(methodCashIn)}</td>
                    <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", color: "#dc2626", fontSize: 13, textAlign: "right" }}>{formatCurrency(methodCashOut)}</td>
                    <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", fontSize: 13, textAlign: "right", color: (methodCashbookWithBal.at(-1)?.runningBal ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                      {formatCurrency(Math.abs(methodCashbookWithBal.at(-1)?.runningBal ?? 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </>
          )
        )}

        {/* Print: expense report */}
        {activeTab === "expense" && (
          expenses.length === 0 ? (
            <p style={{ fontSize: 12, color: "#666", padding: "12px 10px" }}>
              No expenses between {formatDate(fromDate)} and {formatDate(toDate)}.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#075985" }}>
                  {["#", "Expense No", "Date", "Category", "Invoice", "Method", "Amount"].map((h) => (
                    <th key={h} style={{ color: "#fff", fontWeight: 700, textAlign: h === "Amount" ? "right" : "left", padding: "7px 8px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, idx) => (
                  <tr key={e.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 8px", color: "#999" }}>{idx + 1}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", color: "#075985", fontWeight: 700 }}>{e.expense_number || "—"}</td>
                    <td style={{ padding: "6px 8px", color: "#555" }}>{formatDate(e.date)}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{e.category || "—"}</td>
                    <td style={{ padding: "6px 8px", color: "#666" }}>{e.invoice_number || "—"}</td>
                    <td style={{ padding: "6px 8px", color: "#666" }}>{e.method}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 800, textAlign: "right", color: "#dc2626" }}>{formatCurrency(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f3f4f6", borderTop: "2px solid #dc2626" }}>
                  <td colSpan={6} style={{ padding: "8px 8px", fontWeight: 900, fontSize: 12 }}>TOTAL — {expenses.length} {expenses.length !== 1 ? "entries" : "entry"}</td>
                  <td style={{ padding: "8px 8px", fontWeight: 900, fontFamily: "monospace", color: "#dc2626", fontSize: 13, textAlign: "right" }}>{formatCurrency(expenseTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )
        )}

        </div>
        <PrintFooter />
          </>
        ) : (
          <div style={{ padding: 32, textAlign: "center", color: "#888", fontSize: 12 }}>
            Generate a report on screen, then use Print / PDF.
          </div>
        )}
      </div>
    </>
  );
}
