import { unitLabel } from "@/lib/productUnits";
import { formatCurrency } from "@/lib/helpers";

type Item = {
  id: string; category?: string; description: string; unit?: string;
  qty: number; rate: number; amount: number; discount_pct?: number;
};

/** Informational details only: document totals remain the ledger postings. */
export function LedgerLineItems({ items }: { items: Item[] }) {
  if (!items.length) return null;
  const discount = items.some(item => Number(item.discount_pct) > 0);
  return <table aria-label="Document line items" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11, color: "#222", background: "#f8fafc" }}>
    <thead><tr>{["Product / description", "Qty", "Unit price", ...(discount ? ["Discount"] : []), "Amount"].map((heading, index) =>
      <th key={heading} style={{ padding: "5px", textAlign: index ? "right" : "left", width: index ? undefined : "40%", borderBottom: "1px solid #cbd5e1", color: "#075985" }}>{heading}</th>
    )}</tr></thead>
    <tbody>{items.map(item => <tr key={item.id} style={{ breakInside: "avoid" }}>
      <td style={{ padding: "5px", overflowWrap: "anywhere" }}>
        <strong>{item.category?.trim() || item.description?.trim() || "Item"}</strong>
        {item.category?.trim() && item.description?.trim() && item.category.trim() !== item.description.trim() && <div>{item.description}</div>}
      </td>
      <td style={{ padding: "5px", textAlign: "right" }}>{Number(item.qty)}{item.unit ? ` ${unitLabel(item.unit)}` : ""}</td>
      <td style={{ padding: "5px", textAlign: "right", overflowWrap: "anywhere" }}>{formatCurrency(Number(item.rate))}</td>
      {discount && <td style={{ padding: "5px", textAlign: "right" }}>{Number(item.discount_pct) || 0}%</td>}
      <td style={{ padding: "5px", textAlign: "right", overflowWrap: "anywhere" }}>{formatCurrency(Number(item.amount))}</td>
    </tr>)}</tbody>
  </table>;
}
