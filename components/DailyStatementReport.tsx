import type { ReactNode } from "react";
import { dailyStatementTotals, type DailyStatementData } from "@/lib/dailyStatement";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";

function StatementTable({ title, headings, rows, numeric = [] }: { title: string; headings: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  return <section className="mt-6">
    <h3 className="text-sm font-bold mb-3">{title} ({rows.length})</h3>
    {!rows.length ? <p className="text-sm text-[var(--gray-800)]">No records for this date.</p> : <div className="overflow-x-auto">
      <table className={`${DT.table} min-w-[640px]`}>
        <thead><tr>{headings.map((h, i) => <th key={h} scope="col" className={`${DT.thDense} ${numeric.includes(i) ? "text-right" : "text-left"}`} style={DT.thStyle}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className={DT.row}>{row.map((cell, j) => <td key={j} className={`${DT.tdDense} align-top whitespace-pre-wrap break-words ${numeric.includes(j) ? "text-right font-mono tabular-nums" : ""}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

export function DailyStatementReport({ data }: { data: DailyStatementData }) {
  const totals = dailyStatementTotals(data);
  const metrics = [
    { label: "Income", value: totals.income, note: "Money received · all payment methods" },
    { label: "Expenses", value: totals.expenses, note: "Expenses recorded, including pending" },
    { label: "Sales returns", value: totals.salesReturns, note: "Customer credits issued" },
    { label: "Supplier returns", value: totals.supplierReturns, note: "Supplier credits received" },
    { label: "Cash out", value: totals.cashOut, note: "All recorded payments and refunds" },
    { label: "Net cash movement", value: totals.netCash, note: "Income minus cash out" },
    { label: "Sales invoiced", value: totals.sales, note: "Party and walk-in invoices before returns" },
    { label: "Purchases invoiced", value: totals.purchases, note: "Supplier invoices before returns" },
  ];
  return <div>
    <h2 className="text-lg font-extrabold mb-1">Daily Statement</h2>
    <p className="text-sm mb-4">{formatDate(data.date)}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4 gap-3">
      {metrics.map(m => <div key={m.label} className="border border-[var(--gray-100)] rounded-[12px] px-4 py-3 break-inside-avoid">
        <div className="text-xs font-semibold text-[var(--gray-800)]">{m.label}</div>
        <div className="text-lg font-extrabold tabular-nums" style={{ color: "var(--blue-deeper)" }}>{formatCurrency(m.value)}</div>
        <p className="text-xs mt-1 text-[var(--gray-800)]">{m.note}</p>
      </div>)}
    </div>
    <p className="text-xs mt-4 text-[var(--gray-800)]">Uses invoice, return, expense and cashbook dates. Returns against earlier invoices are included on their return date. Return credits and balance adjustments do not count as cash. Expenses may already be included in cash out; do not subtract them twice. Net cash movement is not profit or closing cash balance.</p>
    <StatementTable title="Invoices and returns" headings={["Type", "Invoice / Reference", "Party / Supplier", "Details", "Amount / Credit"]} numeric={[4]}
      rows={data.activity.map(a => [a.kind, a.reference, a.party, a.details, formatCurrency(a.amount)])} />
    <StatementTable title="Expense details" headings={["Expense", "Category", "Description", "Status", "Amount"]} numeric={[4]}
      rows={data.expenses.map(e => [e.reference, e.category || "—", e.description || "—", e.completed ? "Completed" : "Pending", formatCurrency(e.amount)])} />
    <StatementTable title="Cash movements" headings={["Description", "Reference", "Payment method", "Income", "Cash out"]} numeric={[3, 4]}
      rows={data.cash.map(e => [e.description, e.reference || "—", e.method, e.type === "in" ? formatCurrency(e.amount) : "—", e.type === "out" ? formatCurrency(e.amount) : "—"])} />
  </div>;
}
