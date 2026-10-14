"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { db } from "@/lib/db";
import { formatCurrency, todayISO, formatDate } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";
import {
  TrendingUp,
  Banknote,
  Clock,
  FileStack,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
} from "lucide-react";
import type { Invoice, CashbookEntry } from "@/lib/database.types";
import { computeMethodBalances, isLedgerOnlyEntry, usePaymentMethods } from "@/lib/paymentMethods";

type PeriodPreset = "week" | "month" | "all";

function periodRange(preset: PeriodPreset): { from: string | null; to: string; badge: string } {
  const to = todayISO();
  if (preset === "all") {
    return { from: null, to, badge: "All time" };
  }
  if (preset === "week") {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const from = start.toISOString().slice(0, 10);
    return {
      from,
      to,
      badge: `${formatDate(from)} – ${formatDate(to)}`,
    };
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  return {
    from,
    to,
    badge: now.toLocaleDateString("en-PK", { month: "long", year: "numeric" }),
  };
}

function dateInRange(dateStr: string, from: string | null, to: string): boolean {
  if (!from) return true;
  return dateStr >= from && dateStr <= to;
}

export default function DashboardPage() {
  const { methods: paymentMethods } = usePaymentMethods();
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [cashRows, setCashRows] = useState<CashbookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayReceived, setTodayReceived] = useState(0);
  const [todayPending, setTodayPending] = useState(0);
  const [recentInvoices, setRecentInvoices] = useState<
    { id: string; invoice_number: string; client_name: string; invoice_date: string; grand_total: number; payment_status: string }[]
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    const today = todayISO();
    const [{ data: invData }, { data: cbData }] = await Promise.all([
      db.from("invoices").select("*").order("created_at", { ascending: false }),
      db.from("cashbook").select("*"),
    ]);

    if (invData) {
      setInvoices(invData as Invoice[]);
      const invToday = (invData as Invoice[]).filter((i) => i.invoice_date === today);
      setTodayRevenue(invToday.reduce((s, i) => s + Number(i.grand_total), 0));
      setTodayPending(invToday.reduce((s, i) => s + Number(i.balance_due), 0));
      setRecentInvoices(
        (invData as Invoice[]).slice(0, 5).map((i) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          client_name: i.client_name,
          invoice_date: i.invoice_date,
          grand_total: Number(i.grand_total),
          payment_status: i.payment_status,
        }))
      );
    }
    if (cbData) {
      setCashRows(cbData as CashbookEntry[]);
      const cashInToday = (cbData as CashbookEntry[]).filter((c) => c.date === today && c.type === "in" && !isLedgerOnlyEntry(c));
      setTodayReceived(cashInToday.reduce((s, c) => s + Number(c.amount), 0));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initialLoad);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const { from, to, badge } = periodRange(period);

  const filtered = useMemo(() => {
    const invFiltered = invoices.filter((i) => dateInRange(i.invoice_date, from, to));
    const cbFiltered = cashRows.filter((c) => dateInRange(c.date, from, to));
    const cbCash = cbFiltered.filter((c) => !isLedgerOnlyEntry(c));
    const totalBilled = invFiltered.reduce((s, i) => s + Number(i.grand_total), 0);
    const received = cbCash.filter((c) => c.type === "in").reduce((s, c) => s + Number(c.amount), 0);
    const spending = cbCash.filter((c) => c.type === "out").reduce((s, c) => s + Number(c.amount), 0);
    const netCash = received - spending;
    const methodNet = computeMethodBalances(cbCash, paymentMethods);
    return { totalBilled, received, spending, netCash, invoiceCount: invFiltered.length, methodNet };
  }, [invoices, cashRows, from, to, paymentMethods]);

  const totalInvoiceCount = invoices.length;
  const todayLabel = formatDate(todayISO());

  const periodButtons: { key: PeriodPreset; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "all", label: "All time" },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>S.S. Diagnostics — Overview</p>
        </div>

        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-800)" }}>
            Cash &amp; invoiced totals
          </span>
          <div className="flex rounded-[10px] border-[1.5px] overflow-hidden p-0.5" style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)" }}>
            {periodButtons.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className="px-3.5 py-2 text-[12px] font-bold border-none cursor-pointer transition-all rounded-[8px] min-w-[76px]"
                style={{
                  background: period === key ? "var(--blue)" : "transparent",
                  color: period === key ? "#fff" : "var(--gray-800)",
                  boxShadow: period === key ? "0 2px 8px rgba(0,80,120,0.2)" : undefined,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] font-semibold text-right" style={{ color: "var(--gray-800)" }}>
            {loading ? "…" : badge}
            {period === "week" && <span className="font-normal opacity-80"> (last 7 days)</span>}
            {period === "month" && <span className="font-normal opacity-80"> (month to date)</span>}
          </span>
        </div>
      </div>

      {/* Filtered: invoiced (credit on books), received, spending, net */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <StatCard
          icon={<FileStack size={18} />}
          iconCls="si-blue"
          label="Total invoiced"
          value={loading ? "…" : formatCurrency(filtered.totalBilled)}
          badge={badge}
          hint="Invoice totals in period (billed / credit sales)"
        />
        <StatCard
          icon={<ArrowDownLeft size={18} />}
          iconCls="si-green"
          label="Cash received"
          value={loading ? "…" : formatCurrency(filtered.received)}
          badge={badge}
          hint="Cashbook — money in"
        />
        <StatCard
          icon={<ArrowUpRight size={18} />}
          iconCls="si-red"
          label="Cash spent"
          value={loading ? "…" : formatCurrency(filtered.spending)}
          badge={badge}
          hint="Cashbook — money out"
        />
        <StatCard
          icon={<Scale size={18} />}
          iconCls="si-orange"
          label="Net cash"
          value={loading ? "…" : formatCurrency(filtered.netCash)}
          badge={badge}
          hint="Received minus spent"
        />
      </div>

      <div
        className="mb-5 rounded-[14px] border border-[var(--gray-100)] px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center justify-between"
        style={{ boxShadow: "var(--shadow-sm)", background: "var(--gray-50)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--gray-800)" }}>
          Net by method ({badge})
        </span>
        <div className="flex flex-wrap gap-4 text-[12px] font-mono font-bold" style={{ color: "var(--gray-900)" }}>
          {paymentMethods.length === 0 && !loading ? (
            <span className="text-[11px] font-normal" style={{ color: "var(--gray-700)" }}>No payment methods configured.</span>
          ) : (
            paymentMethods.map((m) => (
              <span key={m.id}>
                {m.name} <span style={{ color: "var(--green)" }}>{loading ? "…" : formatCurrency(filtered.methodNet[m.name] ?? 0)}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Today snapshot + all-time count */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <StatCard icon={<TrendingUp size={18} />} iconCls="si-blue" label="Today Revenue" value={formatCurrency(todayRevenue)} badge={todayLabel} />
        <StatCard icon={<Banknote size={18} />} iconCls="si-green" label="Today Received" value={formatCurrency(todayReceived)} badge={todayLabel} />
        <StatCard icon={<Clock size={18} />} iconCls="si-orange" label="Today Pending" value={formatCurrency(todayPending)} badge={todayLabel} />
        <StatCard
          icon={<FileStack size={18} />}
          iconCls="si-red"
          label="Total invoices"
          value={String(totalInvoiceCount)}
          badge="All time"
          valueIsCount
          hint={`${filtered.invoiceCount} in selected period`}
        />
      </div>

      {/* Recent Invoices */}
      <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
          <span className="text-lg sm:text-xl font-extrabold tracking-tight" style={{ color: "var(--gray-900)" }}>Recent Invoices</span>
        </div>
        <div className="overflow-x-auto">
          <table className={`${DT.table} min-w-[520px]`}>
            <thead>
              <tr>
                {["Inv #", "Client", "Date", "Amount", "Status"].map((h) => (
                  <th key={h} className={`${DT.th} text-left`} style={DT.thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentInvoices.length === 0 ? (
                <tr><td colSpan={5} className={DT.empty} style={DT.emptyStyle}>No invoices yet</td></tr>
              ) : (
                recentInvoices.map((inv) => (
                  <tr key={inv.id} className={DT.row}>
                    <td className={DT.td}>
                      <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}>{inv.invoice_number}</span>
                    </td>
                    <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>{inv.client_name}</td>
                    <td className={`${DT.td} ${DT.cellBody}`} style={{ color: "var(--gray-800)" }}>{formatDate(inv.invoice_date)}</td>
                    <td className={`${DT.td} font-mono font-bold text-[15px]`} style={{ color: "var(--blue-deeper)" }}>{formatCurrency(Number(inv.grand_total))}</td>
                    <td className={DT.td}>
                      <span className={`${DT.badge} capitalize`} style={{
                        background: inv.payment_status === "paid" ? "var(--green-light)" : inv.payment_status === "partial" ? "var(--orange-light)" : "var(--red-light)",
                        color: inv.payment_status === "paid" ? "var(--green)" : inv.payment_status === "partial" ? "#B45309" : "var(--red)",
                      }}>{inv.payment_status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-7 pt-4 border-t border-[var(--gray-100)] flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-bold" style={{ color: "var(--gray-900)" }}>S.S. Diagnostics</div>
        <div className="text-[11px]" style={{ color: "var(--gray-800)" }}>v1.0</div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  iconCls,
  label,
  value,
  badge,
  valueIsCount,
  hint,
}: {
  icon: React.ReactNode;
  iconCls: string;
  label: string;
  value: string;
  badge: string;
  valueIsCount?: boolean;
  hint?: string;
}) {
  const bgMap: Record<string, string> = { "si-blue": "var(--blue-light)", "si-green": "var(--green-light)", "si-orange": "var(--orange-light)", "si-red": "var(--red-light)" };
  const colorMap: Record<string, string> = { "si-blue": "var(--blue-deeper)", "si-green": "var(--green)", "si-orange": "#B45309", "si-red": "var(--red)" };
  return (
    <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 transition-all hover:shadow-[var(--shadow)] hover:border-[var(--blue-light)] hover:-translate-y-0.5 cursor-default"
      style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start justify-between mb-3.5 gap-2">
        <div className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0" style={{ background: bgMap[iconCls], color: colorMap[iconCls] }}>{icon}</div>
        <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap max-w-[140px] truncate text-right" style={{ background: "var(--gray-100)", color: "var(--gray-700)" }} title={badge}>{badge}</span>
      </div>
      <div className={`font-extrabold font-mono leading-none ${valueIsCount ? "text-[1.65rem]" : "text-2xl"}`} style={{ color: "var(--gray-900)" }}>{value}</div>
      <div className="text-[11.5px] mt-1" style={{ color: "var(--gray-800)" }}>{label}</div>
      {hint ? (
        <div className="text-[10px] mt-1.5 leading-snug" style={{ color: "var(--gray-800)", opacity: 0.85 }}>{hint}</div>
      ) : null}
    </div>
  );
}
