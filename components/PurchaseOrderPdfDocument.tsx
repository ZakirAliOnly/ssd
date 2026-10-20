"use client";

import { formatCurrency, formatDate } from "@/lib/helpers";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintHeader } from "@/components/PrintHeader";

export interface PurchaseOrderPdfPayload {
  po: {
    po_number: string;
    supplier_name: string;
    supplier_phone: string;
    order_date: string;
    payment_status: string;
    grand_total: number;
    amount_paid: number;
    balance_due: number;
    payment_method: string;
    notes: string;
  };
  items: Array<{ description: string; expiry_date: string | null; unit?: string; qty: number; rate: number; amount: number }>;
}

const STATUS_COLOR: Record<string, string> = {
  paid: "#16a34a",
  partial: "#ea580c",
  unpaid: "#dc2626",
};

/** PO print/PDF layout — full-width header and itemized table. */
export function PurchaseOrderPdfDocument({ data }: { data: PurchaseOrderPdfPayload }) {
  const { po, items } = data;
  const statusColor = STATUS_COLOR[po.payment_status] ?? "#dc2626";

  return (
    <div style={{ fontFamily: "Arial, Helvetica, sans-serif", color: "#111", fontSize: 11 }}>

      <PrintHeader />

      {/* ── Document title bar ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 12px",
          background: "#0369a1",
          color: "#fff",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase" }}>
          Purchase Invoice
        </span>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13 }}>{po.po_number}</span>
      </div>

      {/* ── Supplier + meta grid ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          padding: "0 12px",
          marginBottom: 12,
        }}
      >
        {/* Left — supplier */}
        <div>
          <div style={{ fontSize: 8, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
            Supplier
          </div>
          <div style={{ fontWeight: 900, color: "#0369a1", fontSize: 16, lineHeight: 1.2 }}>
            {po.supplier_name}
          </div>
          {po.supplier_phone ? (
            <div style={{ fontSize: 11, color: "#333", marginTop: 3 }}>{po.supplier_phone}</div>
          ) : null}
          {po.notes ? (
            <div style={{ fontSize: 10, color: "#444", marginTop: 6, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Notes: </span>{po.notes}
            </div>
          ) : null}
        </div>

        {/* Right — meta */}
        <div style={{ textAlign: "right", minWidth: 130 }}>
          <div style={{ marginBottom: 5 }}>
            <div style={{ fontSize: 8, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Date</div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{formatDate(po.order_date)}</div>
          </div>
          <div style={{ marginBottom: 5 }}>
            <div style={{ fontSize: 8, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Payment</div>
            <div style={{ fontWeight: 700, fontSize: 11 }}>{po.payment_method}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Status</div>
            <div
              style={{
                display: "inline-block",
                marginTop: 2,
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 800,
                textTransform: "capitalize",
                background: statusColor + "1a",
                color: statusColor,
                border: `1px solid ${statusColor}40`,
              }}
            >
              {po.payment_status}
            </div>
          </div>
        </div>
      </div>

      {/* ── Items table ── */}
      <div style={{ padding: "0 12px", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
          <thead>
            <tr>
              {["#", "Product", "Expiry", "Qty", "Rate", "Amount"].map((h) => {
                const align = h === "Product" ? "left" : h === "Rate" || h === "Amount" ? "right" : "center";
                return (
                  <th
                    key={h}
                    style={{
                      background: "#0369a1",
                      color: "#fff",
                      fontWeight: 700,
                      textAlign: align as "left" | "right" | "center",
                      padding: "7px 8px",
                      fontSize: 9,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    {h}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: 16, textAlign: "center", color: "#666", border: "1px solid #e5e7eb" }}
                >
                  No line items
                </td>
              </tr>
            ) : (
              items.map((it, idx) => (
                <tr
                  key={idx}
                  style={{
                    background: idx % 2 === 0 ? "#fff" : "#f8fafc",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <td style={{ padding: "6px 8px", textAlign: "center", color: "#666", borderLeft: "1px solid #e5e7eb" }}>
                    {idx + 1}
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 600, color: "#111", borderLeft: "1px solid #e5e7eb" }}>
                    {it.description || "—"}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", borderLeft: "1px solid #e5e7eb" }}>
                    {it.expiry_date ? formatDate(it.expiry_date) : "Non-expiry"}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", fontWeight: 700, borderLeft: "1px solid #e5e7eb" }}>
                    {it.qty} {it.unit}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, borderLeft: "1px solid #e5e7eb" }}>
                    {formatCurrency(it.rate)}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: "#0369a1", borderLeft: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb" }}>
                    {formatCurrency(it.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Totals ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px", marginBottom: 16 }}>
        <div style={{ width: 220 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "6px 10px",
              background: "#f8fafc",
              borderTop: "2px solid #0369a1",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Grand Total</span>
            <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 14, color: "#0369a1" }}>
              {formatCurrency(po.grand_total)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderTop: "1px solid #e5e7eb" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#555" }}>Amount Paid</span>
            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#16a34a" }}>
              {formatCurrency(po.amount_paid)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "5px 10px",
              borderTop: "1px solid #e5e7eb",
              borderBottom: "2px solid #0369a1",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: "#555" }}>Remaining</span>
            <span
              style={{
                fontFamily: "monospace",
                fontWeight: 700,
                color: po.balance_due > 0 ? "#dc2626" : "#16a34a",
              }}
            >
              {formatCurrency(po.balance_due)}
            </span>
          </div>
        </div>
      </div>

      <PrintFooter />
    </div>
  );
}
