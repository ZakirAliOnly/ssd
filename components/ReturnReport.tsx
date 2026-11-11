import type { ReturnReportRow } from "@/lib/returnReport";
import { DT } from "@/lib/dataTableStyles";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { unitLabel } from "@/lib/productUnits";

export function ReturnReport({ rows }: { rows: ReturnReportRow[] }) {
  const credit = rows.filter(row => !row.reversedAt).reduce((sum, row) => sum + row.amount, 0);
  const quantity = (value: number | null, unit: string | null) => value == null ? "—" : `${value}${unit ? ` ${unit}` : ""}`;
  return <div>
    <p className="text-xs mb-3" style={{ color: "var(--gray-800)" }}>
      Customer invoice returns. Invoice remaining quantities use the sold unit; stock quantities use the saved stock unit.
      Before and after values describe the moment the return was saved, even when backdated. Older returns without stock snapshots show —.
      Reversed returns remain visible for history and are excluded from the credit total.
    </p>
    {!rows.length ? <p className="py-10 text-center text-sm">No returns found for this search and period.</p> : <div className="overflow-x-auto">
      <table className={`${DT.table} min-w-[1100px] print:min-w-0 print:text-[9px]`}>
        <thead><tr>{["Return date", "Invoice number", "Customer", "Product / reason", "Original qty", "Invoice remaining before", "Returned qty", "Invoice remaining after", "Stock before", "Stock after", "Credit", "Status"].map((label, i) =>
          <th key={label} scope="col" className={`${DT.thDense} ${i >= 4 && i <= 9 ? "text-center" : i === 10 ? "text-right" : "text-left"}`} style={{ ...DT.thStyle, whiteSpace: "normal" }}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={DT.row}>
          <td className={DT.tdDense}>{formatDate(row.date)}</td>
          <td className={DT.tdDense}>{row.invoiceNumber}</td>
          <td className={DT.tdDense}>{row.customer}</td>
          <td className={`${DT.tdDense} whitespace-pre-wrap break-words`}><span className="font-semibold">{row.product}</span>{row.description && <small className="block">{row.description}</small>}{row.reason && <small className="block">Reason: {row.reason}</small>}</td>
          {[quantity(row.originalQty, unitLabel(row.unit, row.stockUnit ?? "Piece")), quantity(row.invoiceBefore, unitLabel(row.unit, row.stockUnit ?? "Piece")), quantity(row.returnedQty, unitLabel(row.unit, row.stockUnit ?? "Piece")), quantity(row.invoiceAfter, unitLabel(row.unit, row.stockUnit ?? "Piece")), quantity(row.stockBefore, row.stockUnit), quantity(row.stockAfter, row.stockUnit)].map((value, i) =>
            <td key={i} className={`${DT.tdDense} ${DT.cellMono} text-center`}>{value}</td>)}
          <td className={`${DT.tdDense} ${DT.cellMono} text-right`}>{formatCurrency(row.amount)}</td>
          <td className={DT.tdDense}>{row.reversedAt ? <>Reversed<small className="block">{formatDate(row.reversedAt)}</small></> : "Active"}</td>
        </tr>)}</tbody>
        <tfoot><tr className="font-bold bg-[var(--gray-50)]"><td colSpan={10} className={DT.tdDense}>Total active return credit</td><td className={`${DT.tdDense} ${DT.cellMono} text-right`}>{formatCurrency(credit)}</td><td /></tr></tfoot>
      </table>
    </div>}
  </div>;
}
