"use client";

import { formatDate } from "@/lib/helpers";
import { invoiceLineTotal, invoiceUnitRate } from "@/lib/invoicePricing";
import { partyInvoiceBalances } from "@/lib/partyOverview";
import { unitLabel } from "@/lib/productUnits";

export type DocumentLine = {
  product: string; description?: string; qty: number; unit?: string;
  rate?: number; amount: number; discount_pct?: number; expiry?: string | null;
};
export type DocumentTotal = { label: string; value: number; strong?: boolean };
export type InvoiceDocumentData = {
  title: string; number: string; date: string; party: string; phone?: string;
  reference?: string; notes?: string; processedBy?: string; returnDocument?: boolean;
  purchase?: boolean; paymentMethod?: string; paymentStatus?: string; lines: DocumentLine[]; totals: DocumentTotal[];
};
export const documentNumber = (value: number) => Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });

/** A measurement source and a separate page host. prepareInvoiceDocument fills
 * the host before printing/exporting; React continues to own the source. */
export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const columns = data.purchase ? [4, 34, 18, 10, 15, 19] : data.returnDocument ? [4, 26, 38, 11, 21] : [4, 24, 30, 9, 12, 7, 14];
  const headings = data.purchase ? ["SN", "Product", "Expiry", "Qty", "Rate", "Amount"]
    : data.returnDocument ? ["SN", "Product", "Description", "Qty", "Credit amount"] : ["SN", "Product", "Description", "Qty", "Rate", "Disc. %", "Amount"];
  return <div className="invoice-document">
    <div className="invoice-source" aria-hidden="true">
      <header className="invoice-page-header">
        <div className="invoice-letterhead">
          <svg viewBox="0 0 100 90" aria-label="S.S. Diagnostics logo"><path d="M50 3 97 86H3Z" fill="white" stroke="black" strokeWidth="3" /><text x="50" y="52" textAnchor="middle" fontFamily="Arial" fontSize="25" fontWeight="bold">S.S.</text><text x="50" y="69" textAnchor="middle" fontFamily="Arial" fontSize="8">DIAGNOSTICS</text></svg>
          <div><strong>S.S. DIAGNOSTICS</strong><div>Dawn Medical Centre, Room No. 1, 1st Floor · Jinnah Road, Quetta, Pakistan</div><div>Tel: +92-81-2836967 · Mob: 0333-7808836, 03342427408, 0345-8346536</div></div>
        </div>
        <div className="invoice-document-title"><strong>{data.title}</strong><strong>{data.number}</strong></div>
        <div className="invoice-party-meta"><div><span>{data.purchase || data.title === "Supplier return" ? "Supplier" : "Bill to"}: </span><strong>{data.party}</strong>{data.phone && <span> · {data.phone}</span>}</div><div><strong>Date:</strong> {formatDate(data.date)}</div></div>
        {(data.paymentMethod || data.paymentStatus) && <div className="invoice-reference">Payment method: {data.paymentMethod || "—"} · Status: {data.paymentStatus || "—"}</div>}
        {data.reference && <div className="invoice-reference">Original invoice / PO: {data.reference}</div>}
      </header>
      <table className="invoice-items-table">
        <colgroup>{columns.map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
        <thead><tr>{headings.map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.lines.map((line, i) => <tr key={i} data-line={i + 1}>
          <td>{i + 1}</td><td data-fragment-text>{line.product}</td>
          <td data-fragment-text>{data.purchase ? line.expiry ? formatDate(line.expiry) : "Non-expiry" : line.description || "—"}</td>
          <td className="invoice-quantity"><span>{documentNumber(line.qty)}</span><small>{unitLabel(line.unit)}</small></td>
          {!data.returnDocument && <td className="invoice-number">{documentNumber(Number(line.rate ?? 0))}</td>}
          {!data.purchase && !data.returnDocument && <td className="invoice-number">{Number(line.discount_pct) || 0}%</td>}
          <td className="invoice-number">{documentNumber(line.amount)}</td>
        </tr>)}
          {data.notes && <tr className="invoice-note"><td colSpan={headings.length} data-fragment-text>Notes: {data.notes}</td></tr>}
        </tbody>
      </table>
      <div className="invoice-totals">{data.totals.map((total, i) => <div key={i} className={total.strong ? "invoice-total-strong" : ""}><span>{total.label}</span><span>{documentNumber(total.value)}</span></div>)}
        {data.returnDocument && <p>Credit recorded. No cash refund recorded.</p>}
        {data.processedBy && <p>Processed by: {data.processedBy}</p>}
      </div>
      <footer className="invoice-page-footer"><span>{data.number} · {formatDate(data.date)}</span><span>Software developed by AddsMint.com</span><span data-page-number>Page 1 of 1</span></footer>
    </div>
    <div className="invoice-pages" />
  </div>;
}

type SalesHeader = { invoice_number: string; invoice_date: string; client_name: string; client_phone?: string;
  previous_balance?: number; grand_total: number; amount_received: number; discount_amount?: number;
  gst_pct?: number; gst_amount?: number; stax_pct?: number; stax_amount?: number; bra_pct?: number; bra_amount?: number;
  job_notes?: string; job_name?: string; description?: string };
type SalesLine = { category: string; description?: string; qty: number; unit?: string; rate: number; amount: number; discount_pct?: number };

export function SalesInvoiceDocument({ invoice, items, walkIn = false, partyBalance }: { invoice: SalesHeader; items: SalesLine[]; walkIn?: boolean; partyBalance?: { closing: number; asOf: string } }) {
  const productDiscount = Math.round(items.reduce((sum, item) => sum + (Number(item.discount_pct) > 0
    ? Math.max(0, invoiceLineTotal(Number(item.rate), Number(item.qty)) - Number(item.amount)) : 0), 0) * 100) / 100;
  const totals: DocumentTotal[] = [];
  if (productDiscount || Number(invoice.discount_amount)) {
    totals.push({ label: "Subtotal before discounts", value: items.reduce((sum, line) => sum + Number(line.amount), 0) + productDiscount });
    if (productDiscount) totals.push({ label: "Product discounts", value: -productDiscount });
    if (Number(invoice.discount_amount)) totals.push({ label: "Invoice discount", value: -Number(invoice.discount_amount) });
  }
  for (const [label, pct, amount] of [["GST", invoice.gst_pct, invoice.gst_amount], ["Sales tax", invoice.stax_pct, invoice.stax_amount], ["BRA", invoice.bra_pct, invoice.bra_amount]] as const) {
    if (Number(amount)) totals.push({ label: `${label} (${Number(pct)}%)`, value: Number(amount) });
  }
  const balances = partyInvoiceBalances(invoice, walkIn ? undefined : partyBalance?.closing);
  totals.push({ label: "New bill (PKR)", value: Number(invoice.grand_total), strong: true },
    { label: "Received amount", value: Number(invoice.amount_received) },
    { label: partyBalance && !walkIn ? "Previous / other balance" : "Previous balance", value: balances.previous },
    { label: "Total balance", value: balances.total, strong: true });
  return <InvoiceDocument data={{ title: walkIn ? "Walk-in invoice" : "Invoice", number: invoice.invoice_number,
    date: invoice.invoice_date, party: invoice.client_name, phone: invoice.client_phone,
    notes: invoice.description || invoice.job_notes || invoice.job_name,
    lines: items.map(item => ({ product: item.category || item.description || "—", description: item.category ? item.description : "", qty: Number(item.qty), unit: item.unit,
      rate: invoiceUnitRate(item), amount: Number(item.amount), discount_pct: Number(item.discount_pct) || 0 })), totals }} />;
}
