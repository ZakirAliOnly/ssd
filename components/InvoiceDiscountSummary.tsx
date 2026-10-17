import { formatCurrency } from "@/lib/helpers";
import { invoiceLineTotal } from "@/lib/invoicePricing";

type DiscountLine = { rate: number; qty: number; amount: number; discount_pct?: number };
type DiscountInvoice = { subtotal?: number; discount_amount?: number; discount_type?: string; discount_value?: number };

/** The stored line amounts already include product discounts; do not deduct them again. */
export function InvoiceDiscountSummary({ invoice, items }: { invoice: DiscountInvoice; items: DiscountLine[] }) {
  const productDiscount = Math.round(items.reduce((sum, line) => sum + (Number(line.discount_pct) > 0
    ? Math.max(0, invoiceLineTotal(Number(line.rate), Number(line.qty)) - Number(line.amount)) : 0), 0) * 100) / 100;
  const invoiceDiscount = Math.max(0, Number(invoice.discount_amount) || 0);
  if (productDiscount + invoiceDiscount <= 0) return null;
  const subtotal = items.length ? items.reduce((sum, line) => sum + Number(line.amount), 0) : Number(invoice.subtotal) || 0;
  const row = { display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontSize: 12, color: "#111" };
  return <div style={{ borderTop: "1px solid #111", borderBottom: "1px solid #111", padding: "4px 0", marginBottom: 6, breakInside: "avoid" }}>
    <div style={row}><span>Subtotal before discounts</span><span>{formatCurrency(Math.round((subtotal + productDiscount) * 100) / 100)}</span></div>
    {productDiscount > 0 && <div style={row}><span>Product discounts</span><strong>− {formatCurrency(productDiscount)}</strong></div>}
    {invoiceDiscount > 0 && <div style={row}><span>Invoice discount{invoice.discount_type === "pct" && Number(invoice.discount_value) > 0 ? ` (${Number(invoice.discount_value)}%)` : ""}</span><strong>− {formatCurrency(invoiceDiscount)}</strong></div>}
  </div>;
}
