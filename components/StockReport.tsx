import { stockDisplay, unitLabel } from "@/lib/productUnits";
import type { StockReportRow } from "@/lib/stockReport";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { DT } from "@/lib/dataTableStyles";

export function StockReport({ rows }: { rows: StockReportRow[] }) {
  const totals = rows.reduce((t, r) => ({ received: t.received + r.received, sold: t.sold + r.sold,
    revenue: t.revenue + r.revenue, cost: t.cost + r.cost, profit: t.profit + r.profit }), { received: 0, sold: 0, revenue: 0, cost: 0, profit: 0 });
  return <div>
    <p className="text-xs mb-3" style={{ color: "var(--gray-800)" }}>Kit/packet quantities are equivalents, including opened packs. Stock value uses current product cost, not selling price or historical FIFO valuation. Available stock includes sales returns and stock returned to suppliers. Stock in quantities are net of supplier returns; sold quantities, revenue and cost are net of sales returns recorded in this period. Revenue includes invoice discounts and excludes taxes; it is sales billed, not cash collected. Estimated gross profit uses recorded purchase costs where available, otherwise the current product cost, and excludes business expenses.</p>
    {rows.some(r => r.warning) && <p role="status" className="text-xs mb-3" style={{ color: "var(--red)" }}>Some historical balances cannot be reconstructed from the saved records and are shown as —. Manual stock reductions and legacy sales have incomplete movement history.</p>}
    {rows.length === 0 ? <p className="py-10 text-center text-sm">No products found for this product and period.</p> : <div className="overflow-x-auto">
      <table className={`${DT.table} min-w-[1100px] print:min-w-0 print:text-[9px]`}>
        <thead><tr>{["Code", "Product", "Description", "Category", "Opening qty", "Stock in qty", "Sold qty", "Available qty", "Current cost / kit or unit", "Stock value (current cost)", "Sales revenue", "Cost of sold stock", "Est. gross profit"].map((h, i) => <th key={h} scope="col" className={`${DT.thDense} ${i < 4 ? "text-left" : i < 8 ? "text-center" : "text-right"}`} style={DT.thStyle}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className={DT.row}>
          <td className={DT.tdDense}>{r.code}</td><td className={DT.tdDense}>{r.name}<small className="block">Loose unit: {r.baseUnit || "Unit"}{r.available != null && r.packaging?.packaging_enabled ? ` · ${stockDisplay(r.available, r.packaging)}` : ""}</small>{r.warning && <span className="block text-[10px]" style={{ color: "var(--red)" }}>{r.warning}</span>}</td><td className={`${DT.tdDense} min-w-[180px] max-w-[320px] whitespace-pre-wrap break-words print:min-w-0`}>{r.description || "—"}</td><td className={DT.tdDense}>{r.category}</td>
          {[r.opening, r.received, r.sold, r.available].map((qty, i) => <td key={i} className={`${DT.tdDense} ${DT.cellMono} text-center`}>{qty == null ? "—" : r.packaging?.packaging_enabled ? stockDisplay(qty, r.packaging) : qty}</td>)}
          <td className={`${DT.tdDense} ${DT.cellMono} text-right`}>{formatCurrency(r.costPrice * (r.packaging?.packaging_enabled ? Number(r.packaging.pieces_per_packet) || 1 : 1))}<small className="block">per {r.packaging?.packaging_enabled ? unitLabel("packet", r.packaging.base_unit) : "unit"}</small></td>
          {[r.available == null ? "—" : formatCurrency(r.available * r.costPrice), formatCurrency(r.revenue), formatCurrency(r.cost), formatCurrency(r.profit)].map((v, i) => <td key={i} className={`${DT.tdDense} ${DT.cellMono} text-right`}>{v}</td>)}
        </tr>)}</tbody>
        <tfoot><tr className="font-bold bg-[var(--gray-50)]"><td colSpan={5} className={DT.tdDense}>Total</td><td className={`${DT.tdDense} text-center`}>—</td><td className={`${DT.tdDense} text-center`}>—</td><td colSpan={2} /><td className={`${DT.tdDense} ${DT.cellMono} text-right`}>{rows.some(r => r.available == null) ? "—" : formatCurrency(rows.reduce((sum, r) => sum + Number(r.available) * r.costPrice, 0))}</td>{[totals.revenue, totals.cost, totals.profit].map((v, i) => <td key={i} className={`${DT.tdDense} ${DT.cellMono} text-right`}>{formatCurrency(v)}</td>)}</tr></tfoot>
      </table>
    </div>}
    {rows.map(product => <section key={product.id} className="mt-6">
      <h3 className="text-sm font-bold mb-2">Sales invoices — {product.name}</h3>
      <p className="text-xs mb-3" style={{ color: "var(--gray-800)" }}>Original sales in the selected period. Unit price is before discounts; line amount includes line discounts. Returns and invoice-wide discounts are reflected in the stock summary above.</p>
      {!product.sales.length ? <p className="text-xs">No sales invoices in this period.</p> : <div className="overflow-x-auto">
        <table className={DT.table}>
          <thead><tr>{["Invoice", "Date", "Customer", "Qty", "Unit price", "Line amount"].map((label, i) => <th key={label} scope="col" className={`${DT.thDense} ${i === 3 ? "text-center" : i > 3 ? "text-right" : "text-left"}`} style={DT.thStyle}>{label}</th>)}</tr></thead>
          <tbody>{product.sales.map((sale, i) => <tr key={sale.lineId ?? i} className={DT.row}>
            <td className={DT.tdDense}>{sale.invoiceNumber || "—"}</td>
            <td className={DT.tdDense}>{formatDate(sale.date)}</td>
            <td className={DT.tdDense}>{sale.customer || "—"}</td>
            <td className={`${DT.tdDense} ${DT.cellMono} text-center`}>{sale.displayQty ?? sale.qty} {sale.unit}</td>
            <td className={`${DT.tdDense} ${DT.cellMono} text-right`}>{sale.unitPrice == null ? "—" : formatCurrency(sale.unitPrice)}</td>
            <td className={`${DT.tdDense} ${DT.cellMono} text-right`}>{sale.amount == null ? "—" : formatCurrency(sale.amount)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>)}
  </div>;
}
