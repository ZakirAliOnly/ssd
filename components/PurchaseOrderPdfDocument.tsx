"use client";

import { InvoiceDocument } from "@/components/InvoiceDocument";

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

export function PurchaseOrderPdfDocument({ data }: { data: PurchaseOrderPdfPayload }) {
  const { po, items } = data;
  return <InvoiceDocument data={{ title: "Purchase invoice", purchase: true, number: po.po_number,
    date: po.order_date, party: po.supplier_name, phone: po.supplier_phone, notes: po.notes, paymentMethod: po.payment_method, paymentStatus: po.payment_status,
    lines: items.map(item => ({ product: item.description, expiry: item.expiry_date, qty: item.qty, unit: item.unit, rate: item.rate, amount: item.amount })),
    totals: [{ label: "Grand total (PKR)", value: po.grand_total, strong: true },
      { label: "Amount paid", value: po.amount_paid }, { label: "Remaining", value: po.balance_due, strong: true }] }} />;
}
