import { formatCurrency } from "@/lib/helpers";
import { invoiceLineTotal } from "@/lib/invoicePricing";

export function InvoiceLineDiscount({ line }: { line: { discount_pct?: number; rate: number; qty: number; amount: number } }) {
  if (!(Number(line.discount_pct) > 0)) return null;
  const discount = Math.max(0, Math.round((invoiceLineTotal(Number(line.rate), Number(line.qty)) - Number(line.amount)) * 100) / 100);
  if (discount <= 0) return null;
  return <div style={{ fontSize: 11, fontWeight: 600, color: "#111", marginTop: 3 }}>
    Discount: {Number(line.discount_pct)}% (− {formatCurrency(discount)})
  </div>;
}
