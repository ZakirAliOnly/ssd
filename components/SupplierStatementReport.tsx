import type { SupplierStatement } from "@/lib/supplierStatement";
import { formatCurrency, formatDate } from "@/lib/helpers";

export function SupplierStatementReport({ statements, selectedId, onSelect, onBack, print = false, party = false, summaryOnly = false }: {
  statements: SupplierStatement[]; selectedId: string | null;
  onSelect?: (id: string) => void; onBack?: () => void; print?: boolean; party?: boolean; summaryOnly?: boolean;
}) {
  const selected = statements.find(s => s.supplier.id === selectedId);
  const totals = (selected ? [selected] : statements).reduce((sum, s) => ({
    opening: sum.opening + s.opening, debit: sum.debit + s.debit,
    credit: sum.credit + s.credit, closing: sum.closing + s.closing,
  }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  const cell = { padding: print ? "6px 5px" : "12px", borderBottom: "1px solid var(--gray-200)", verticalAlign: "top" as const };
  const amount = { ...cell, textAlign: "right" as const, whiteSpace: "nowrap" as const, fontVariantNumeric: "tabular-nums" as const };
  const headers = selected ? ["Date", "Reference / Description", "Method", "Debit", "Credit", "Balance"]
    : [party ? "Party" : "Supplier", "Opening balance", "Debit", "Credit", "Closing balance"];
  const warnings = selected ? [selected].filter(s => s.warning) : statements.filter(s => s.warning);
  return <section className={print ? "" : "bg-white rounded-xl border border-[var(--gray-100)] p-4"} style={{ color: "var(--gray-900)", fontSize: print ? 10 : 13 }}>
    {!print && selected && <button type="button" onClick={onBack} className="mb-3 text-[var(--blue-deeper)] underline cursor-pointer">← {party ? "All parties" : "All suppliers"}</button>}
    <h2 className="font-bold mb-1">{selected ? selected.supplier.name : party ? "All parties" : "All suppliers"}</h2>
    {selected?.supplier.phone && <p className="mb-2">{selected.supplier.phone}</p>}
    <p className="text-[var(--gray-700)] mb-3">{party ? "Debit increases what the party owes; credit reduces it. A negative balance means we owe the party." : "Debit increases the amount owed; credit records payments. A negative balance is an advance."}</p>
    {warnings.length > 0 && <p role="status" className="mb-3 p-2 border border-[var(--orange)] rounded text-[var(--gray-900)]">
      {selected ? selected.warning : `Payment history needs review for ${warnings.length} ${party ? "party record(s)" : "supplier(s)"}. Open their statements for details.`}
    </p>}
    <div className="overflow-x-auto">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ background: "var(--blue-deeper)", color: "white" }}>{headers.map((h, index) => <th key={h} scope="col" style={{ ...cell, textAlign: index >= (selected ? 3 : 1) ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>
          {selected ? <>
            <tr><td colSpan={5} style={cell}>Opening balance before selected period</td><td style={amount}>{formatCurrency(selected.opening)}</td></tr>
            {selected.rows.map(r => <tr key={r.id}>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>{formatDate(r.date)}</td>
              <td style={cell}><span className="font-semibold">{r.reference}</span><br />{r.description}</td>
              <td style={cell}>{r.method}</td><td style={amount}>{r.debit ? formatCurrency(r.debit) : "—"}</td>
              <td style={amount}>{r.credit ? formatCurrency(r.credit) : "—"}</td><td style={amount}>{formatCurrency(r.balance)}</td>
            </tr>)}
            {!selected.rows.length && <tr><td colSpan={6} style={cell}>No transactions in this date range.</td></tr>}
          </> : statements.map(s => <tr key={s.supplier.id}>
            <td style={cell}>{print || summaryOnly ? s.supplier.name : <button type="button" onClick={() => onSelect?.(s.supplier.id)} className="font-semibold text-[var(--blue-deeper)] underline cursor-pointer">{s.supplier.name}</button>}
              {s.warning && <span className="block text-[11px]">Payment history needs review</span>}</td>
            <td style={amount}>{formatCurrency(s.opening)}</td><td style={amount}>{formatCurrency(s.debit)}</td>
            <td style={amount}>{formatCurrency(s.credit)}</td><td style={amount}>{formatCurrency(s.closing)}</td>
          </tr>)}
          {!selected && !statements.length && <tr><td colSpan={5} style={cell}>{summaryOnly ? "No parties are assigned to this head account." : `No ${party ? "parties" : "suppliers"} added yet.`}</td></tr>}
        </tbody>
        <tfoot><tr className="font-bold" style={{ background: "var(--gray-50)" }}>
          <td colSpan={selected ? 3 : 1} style={cell}>Period totals / Closing balance</td>
          {!selected && <td style={amount}>{formatCurrency(totals.opening)}</td>}
          <td style={amount}>{formatCurrency(totals.debit)}</td><td style={amount}>{formatCurrency(totals.credit)}</td><td style={amount}>{formatCurrency(totals.closing)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>;
}
