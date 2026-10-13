import type { StockReportRow } from "@/lib/stockReport";
import { formatCurrency } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";

export function StockReport({ rows }: { rows: StockReportRow[] }) {
  const totals = rows.reduce((t, r) => ({ received: t.received + r.received, sold: t.sold + r.sold,
    revenue: t.revenue + r.revenue, cost: t.cost + r.cost, profit: t.profit + r.profit }), { received: 0, sold: 0, revenue: 0, cost: 0, profit: 0 });
  return <div>
    <p className="text-xs mb-3" style={{ color: "var(--gray-800)" }}>Available stock is the balance at the end of the selected period. Revenue includes invoice discounts and excludes taxes; it is sales billed, not cash collected. Estimated gross profit uses recorded purchase costs where available, otherwise the current product cost, and excludes business expenses.</p>
    {rows.some(r => r.warning) && <p role="status" className="text-xs mb-3" style={{ color: "var(--red)" }}>Some historical balances cannot be reconstructed from the saved records and are shown as —. Manual stock reductions and legacy sales have incomplete movement history.</p>}
    {rows.length === 0 ? <p className="py-10 text-center text-sm">No products found for this category and period.</p> : <div className="overflow-x-auto">
      <table className={`${DT.table} min-w-[1100px] print:min-w-0 print:text-[9px]`}>
        <thead><tr>{["Code", "Product", "Category", "Opening qty", "Stock in qty", "Sold qty", "Available qty", "Current cost / unit", "Sales revenue", "Cost of sold stock", "Est. gross profit"].map((h, i) => <th key={h} scope="col" className={`${DT.thDense} ${i < 3 ? "text-left" : i < 7 ? "text-center" : "text-right"}`} style={DT.thStyle}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className={DT.row}>
          <td className={DT.tdDense}>{r.code}</td><td className={DT.tdDense}>{r.name}{r.warning && <span className="block text-[10px]" style={{ color: "var(--red)" }}>{r.warning}</span>}</td><td className={DT.tdDense}>{r.category}</td>
          {[r.opening ?? "—", r.received, r.sold, r.available ?? "—", formatCurrency(r.costPrice), formatCurrency(r.revenue), formatCurrency(r.cost), formatCurrency(r.profit)].map((v, i) => <td key={i} className={`${DT.tdDense} ${DT.cellMono} ${i < 4 ? "text-center" : "text-right"}`}>{v}</td>)}
        </tr>)}</tbody>
        <tfoot><tr className="font-bold bg-[var(--gray-50)]"><td colSpan={4} className={DT.tdDense}>Total</td><td className={`${DT.tdDense} ${DT.cellMono} text-center`}>{totals.received}</td><td className={`${DT.tdDense} ${DT.cellMono} text-center`}>{totals.sold}</td><td colSpan={2} />{[totals.revenue, totals.cost, totals.profit].map((v, i) => <td key={i} className={`${DT.tdDense} ${DT.cellMono} text-right`}>{formatCurrency(v)}</td>)}</tr></tfoot>
      </table>
    </div>}
  </div>;
}
