"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";
import { isLedgerOnlyEntry } from "@/lib/paymentMethods";
import {
  FileText, TrendingUp, TrendingDown,
  Users, Truck, FileSignature, RefreshCw, Activity, Trash2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type EventType =
  | "invoice"
  | "invoice_return"
  | "payment_in"
  | "payment_out"
  | "salary"
  | "purchase_order"
  | "quote"
  | "deletion";

interface ActivityEntry {
  id: string;
  eventType: EventType;
  title: string;
  subtitle: string;
  amount?: number;
  timestamp: string;
  badge?: string;
  userEmail?: string;
  userName?: string;
}

// ─── Config maps ─────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<EventType, { bg: string; color: string; border: string }> = {
  invoice_return: { bg: "var(--blue-pale)", color: "var(--blue-deeper)", border: "var(--gray-200)" },
  invoice:        { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" },
  payment_in:     { bg: "#F0F9FF", color: "#15803D", border: "#BBF7D0" },
  payment_out:    { bg: "#FEF2F2", color: "#B91C1C", border: "#FECACA" },
  salary:         { bg: "#F5F3FF", color: "#7C3AED", border: "#DDD6FE" },
  purchase_order: { bg: "#F8FAFC", color: "#475569", border: "#E2E8F0" },
  quote:          { bg: "#FEFCE8", color: "#A16207", border: "#FEF08A" },
  deletion:       { bg: "#FEF2F2", color: "#991B1B", border: "#FECACA" },
};

const EVENT_ICONS: Record<EventType, React.ElementType> = {
  invoice_return: RefreshCw,
  invoice:        FileText,
  payment_in:     TrendingUp,
  payment_out:    TrendingDown,
  salary:         Users,
  purchase_order: Truck,
  quote:          FileSignature,
  deletion:       Trash2,
};

const EVENT_LABELS: Record<EventType, string> = {
  invoice_return: "Return",
  invoice:        "Invoice",
  payment_in:     "Payment In",
  payment_out:    "Payment Out",
  salary:         "Salary",
  purchase_order: "Purchase Order",
  quote:          "Quotation",
  deletion:       "Deletion",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function periodStart(period: string): string {
  if (period === "all") return "";
  const d = new Date();
  if (period === "today") d.setHours(0, 0, 0, 0);
  else if (period === "7d")  d.setDate(d.getDate() - 7);
  else if (period === "30d") d.setDate(d.getDate() - 30);
  else if (period === "90d") d.setDate(d.getDate() - 90);
  return d.toISOString();
}

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  paid:    { bg: "#F0F9FF", color: "#15803D" },
  partial: { bg: "#FFFBEB", color: "#D97706" },
  unpaid:  { bg: "#FEF2F2", color: "#B91C1C" },
  pending: { bg: "#FFFBEB", color: "#D97706" },
};

function Badge({ text }: { text: string }) {
  const c = BADGE_COLORS[text?.toLowerCase()] ?? { bg: "#F8FAFC", color: "#475569" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 9px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 700,
      textTransform: "capitalize",
      background: c.bg,
      color: c.color,
      whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

function formatTimestamp(ts: string): { date: string; time: string } {
  if (!ts) return { date: "—", time: "" };
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ActivityLogPage() {
  const [entries, setEntries]           = useState<ActivityEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [period, setPeriod]             = useState("30d");
  const [typeFilter, setTypeFilter]     = useState<EventType | "all">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const start = periodStart(period);

    // Build a query with an optional date filter applied consistently
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function dated(q: any) {
      return start ? q.gte("created_at", start) : q;
    }

    const [
      { data: invoices },
      { data: cashbook },
      { data: workerPays },
      { data: pos },
      { data: quotes },
      { data: logRows },
    ] = await Promise.all([
      dated(db
        .from("invoices")
        .select("id, invoice_number, client_name, grand_total, payment_status, created_by_email, created_by_name, created_at")
        .order("created_at", { ascending: false })
        .limit(500)),

      dated(db
        .from("cashbook")
        .select("id, type, description, amount, method, account_name, created_by_email, created_by_name, created_at")
        .order("created_at", { ascending: false })
        .limit(500)),

dated(db
        .from("worker_payments")
        .select("id, month, net_paid, created_by_email, created_by_name, created_at, workers(name)")
        .order("created_at", { ascending: false })
        .limit(500)),

      dated(db
        .from("purchase_orders")
        .select("id, po_number, supplier_name, grand_total, payment_status, created_by_email, created_by_name, created_at")
        .order("created_at", { ascending: false })
        .limit(500)),

      dated(db
        .from("quotations")
        .select("id, quote_number, party_name, grand_total, created_by_email, created_by_name, created_at")
        .order("created_at", { ascending: false })
        .limit(500)),

      dated(db
        .from("activity_log")
        .select("id, action, entity_type, title, subtitle, amount, user_email, user_name, created_at")
        .order("created_at", { ascending: false })
        .limit(500)),
    ]);

    const all: ActivityEntry[] = [];

    // Invoices
    for (const inv of invoices ?? []) {
      all.push({
        id: `inv-${inv.id}`,
        eventType: "invoice",
        title: "Invoice Created",
        subtitle: `${inv.invoice_number} — ${inv.client_name}`,
        amount: inv.grand_total,
        timestamp: inv.created_at,
        badge: inv.payment_status,
        userEmail: inv.created_by_email,
        userName: inv.created_by_name,
      });
    }

    // Cashbook
    for (const cb of cashbook ?? []) {
      if (isLedgerOnlyEntry(cb)) continue;
      all.push({
        id: `cb-${cb.id}`,
        eventType: cb.type === "in" ? "payment_in" : "payment_out",
        title: cb.type === "in" ? "Payment Received" : "Payment Made",
        subtitle: cb.description || cb.account_name || "—",
        amount: cb.amount,
        timestamp: cb.created_at,
        badge: cb.method,
        userEmail: cb.created_by_email,
        userName: cb.created_by_name,
      });
    }

    // Worker salary payments
    for (const wp of workerPays ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (wp as any).workers as { name?: string } | null;
      all.push({
        id: `wp-${wp.id}`,
        eventType: "salary",
        title: "Salary Paid",
        subtitle: `${w?.name ?? "Worker"} — ${wp.month}`,
        amount: wp.net_paid,
        timestamp: wp.created_at,
        badge: "Paid",
        userEmail: wp.created_by_email,
        userName: wp.created_by_name,
      });
    }

    // Purchase orders
    for (const po of pos ?? []) {
      all.push({
        id: `po-${po.id}`,
        eventType: "purchase_order",
        title: "Purchase Order",
        subtitle: `${po.po_number} — ${po.supplier_name}`,
        amount: po.grand_total,
        timestamp: po.created_at,
        badge: po.payment_status,
        userEmail: po.created_by_email,
        userName: po.created_by_name,
      });
    }

    // Quotations
    for (const q of quotes ?? []) {
      all.push({
        id: `q-${q.id}`,
        eventType: "quote",
        title: "Quotation Created",
        subtitle: `${q.quote_number} — ${q.party_name}`,
        amount: q.grand_total,
        timestamp: q.created_at,
        userEmail: q.created_by_email,
        userName: q.created_by_name,
      });
    }

    // Activity log entries (deletions, etc.)
    for (const row of logRows ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      const action = String(r.action ?? "");
      if (action === "create" && ["invoice_return", "supplier_return"].includes(r.entity_type)) {
        all.push({ id: `return-${r.id}`, eventType: "invoice_return", title: r.title || "Invoice Return",
          subtitle: r.subtitle || "", amount: Number(r.amount), timestamp: r.created_at,
          badge: "Credit", userEmail: r.user_email, userName: r.user_name });
        continue;
      }
      // For now we only render deletion rows here — the other rows are
      // already represented by the create-time queries above.
      if (action !== "delete" || ["laborer", "labor_task", "labor_advance"].includes(r.entity_type)) continue;
      all.push({
        id: `log-${r.id}`,
        eventType: "deletion",
        title: r.title || "Record Deleted",
        subtitle: r.subtitle || r.entity_type || "—",
        amount: r.amount != null ? Number(r.amount) : undefined,
        timestamp: r.created_at,
        badge: r.entity_type ? String(r.entity_type).replace(/_/g, " ") : "deleted",
        userEmail: r.user_email,
        userName: r.user_name,
      });
    }

    all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    setEntries(all);
    setLoading(false);
  }, [period]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void fetchData(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [fetchData]);

  // Client-side filters
  const filtered = entries.filter((e) => {
    if (typeFilter !== "all" && e.eventType !== typeFilter) return false;
    return true;
  });

  // Summary stats
  const countInvoices   = filtered.filter(e => e.eventType === "invoice").length;
  const totalInvoiced   = filtered.filter(e => e.eventType === "invoice").reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalIn         = filtered.filter(e => e.eventType === "payment_in").reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalOut        = filtered.filter(e => e.eventType === "payment_out").reduce((s, e) => s + (e.amount ?? 0), 0);
  const countDeletions  = filtered.filter(e => e.eventType === "deletion").length;

  const stats = [
    { label: "Total Events",   value: String(filtered.length),     color: "var(--blue-deeper)" },
    { label: "Invoices",       value: `${countInvoices} — ${formatCurrency(totalInvoiced)}`, color: "#1D4ED8" },
    { label: "Cash In",        value: formatCurrency(totalIn),     color: "#15803D" },
    { label: "Cash Out",       value: formatCurrency(totalOut),    color: "#B91C1C" },
    { label: "Deletions",      value: String(countDeletions),      color: "#991B1B" },
  ];

  const colSpan = 6;

  return (
    <div className="min-h-screen" style={{ background: "var(--gray-50)" }}>
      <div className="max-w-[1500px] mx-auto px-4 py-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5 gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "var(--blue-deeper)" }}
              >
                <Activity size={18} color="white" />
              </div>
              <h1 className="text-[22px] font-extrabold" style={{ color: "var(--blue-deeper)" }}>
                Activity Log
              </h1>
            </div>
            <p className="text-[13px] mt-1 ml-0.5" style={{ color: "var(--gray-600)" }}>
              All application activity — invoices, payments, salaries, and more
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold border cursor-pointer shrink-0"
            style={{ borderColor: "var(--gray-200)", background: "white", color: "var(--blue-deeper)" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* ── Stats ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-4 border"
              style={{ background: "white", borderColor: "var(--gray-200)" }}
            >
              <div
                className="text-[10.5px] font-bold uppercase tracking-wide mb-1"
                style={{ color: "var(--gray-500)" }}
              >
                {s.label}
              </div>
              <div
                className="text-[16px] font-extrabold leading-tight"
                style={{ color: s.color }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Period pills */}
          {(["today", "7d", "30d", "90d", "all"] as const).map((v) => {
            const labels = { today: "Today", "7d": "7 Days", "30d": "30 Days", "90d": "3 Months", all: "All Time" };
            const active = period === v;
            return (
              <button
                key={v}
                onClick={() => setPeriod(v)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border cursor-pointer transition-all"
                style={{
                  background:   active ? "var(--blue-deeper)" : "white",
                  color:        active ? "white" : "var(--blue-deeper)",
                  borderColor:  active ? "var(--blue-deeper)" : "var(--gray-200)",
                }}
              >
                {labels[v]}
              </button>
            );
          })}

          <div className="w-px self-stretch mx-1" style={{ background: "var(--gray-200)" }} />

          {/* Event type */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as EventType | "all")}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border cursor-pointer"
            style={{ borderColor: "var(--gray-200)", background: "white", color: "var(--blue-deeper)" }}
          >
            <option value="all">All Types</option>
            {(Object.keys(EVENT_LABELS) as EventType[]).map((k) => (
              <option key={k} value={k}>{EVENT_LABELS[k]}</option>
            ))}
          </select>

        </div>

        {/* ── Table ───────────────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: "var(--gray-200)", background: "white" }}
        >
          <div className="overflow-x-auto">
            <table className={DT.table}>
              <thead>
                <tr>
                  {[
                    "Date & Time",
                    "Type",
                    "Description",
                    "User",
                    "Amount",
                    "Status / Method",
                  ].map((h) => (
                    <th key={h} className={DT.th} style={DT.thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={colSpan} className={DT.empty} style={DT.emptyStyle}>
                      Loading activity…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className={DT.empty} style={DT.emptyStyle}>
                      No activity found for this period
                    </td>
                  </tr>
                ) : (
                  filtered.map((entry) => {
                    const colors = EVENT_COLORS[entry.eventType];
                    const Icon   = EVENT_ICONS[entry.eventType];
                    const { date, time } = formatTimestamp(entry.timestamp);
                    const isOut  = entry.eventType === "payment_out";
                    const isIn   = entry.eventType === "payment_in";

                    return (
                      <tr key={entry.id} className={DT.row}>
                        {/* Date / Time */}
                        <td className={DT.td} style={{ whiteSpace: "nowrap", minWidth: 150 }}>
                          <div className="text-[13px] font-semibold" style={{ color: "var(--gray-800)" }}>
                            {date}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: "var(--gray-500)" }}>
                            {time}
                          </div>
                        </td>

                        {/* Type badge */}
                        <td className={DT.td}>
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            background: colors.bg,
                            color: colors.color,
                            border: `1px solid ${colors.border}`,
                            whiteSpace: "nowrap",
                          }}>
                            <Icon size={11} />
                            {entry.title}
                          </span>
                        </td>

                        {/* Description */}
                        <td className={DT.td}>
                          <span className={DT.cellBody}>{entry.subtitle}</span>
                        </td>

                        {/* User */}
                        <td className={DT.td} style={{ whiteSpace: "nowrap", minWidth: 140 }}>
                          {entry.userName || entry.userEmail ? (
                            <>
                              <div className="text-[12.5px] font-semibold" style={{ color: "var(--gray-800)" }}>
                                {entry.userName || entry.userEmail}
                              </div>
                              {entry.userName && entry.userEmail && entry.userName !== entry.userEmail && (
                                <div className="text-[10.5px] mt-0.5" style={{ color: "var(--gray-500)" }}>
                                  {entry.userEmail}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ color: "var(--gray-400)", fontSize: 12 }}>—</span>
                          )}
                        </td>

                        {/* Amount */}
                        <td className={DT.td} style={{ whiteSpace: "nowrap" }}>
                          {entry.amount != null ? (
                            <span
                              className={DT.cellMono}
                              style={{
                                color: isOut ? "#B91C1C" : isIn ? "#15803D" : "inherit",
                              }}
                            >
                              {isOut ? "−" : ""}{formatCurrency(entry.amount)}
                            </span>
                          ) : "—"}
                        </td>

                        {/* Badge */}
                        <td className={DT.td}>
                          {entry.badge ? <Badge text={entry.badge} /> : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer count */}
          {!loading && filtered.length > 0 && (
            <div
              className="px-4 py-2.5 text-[11px] font-semibold border-t"
              style={{ color: "var(--gray-500)", borderColor: "var(--gray-100)" }}
            >
              {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
              {typeFilter !== "all" ? ` · ${EVENT_LABELS[typeFilter as EventType]}` : ""}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
