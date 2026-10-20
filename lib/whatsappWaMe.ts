import { invoiceUnitRate } from "@/lib/invoicePricing";
import { formatCurrency, formatDate } from "@/lib/helpers";

/** Digits for https://wa.me/{digits} (Pakistan mobiles: 03xx → 923xx…). */
export function waMeDigitsFromNumber(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) return `92${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("92")) return d;
  if (d.length === 10) return `92${d}`;
  if (d.length >= 11 && d.startsWith("92")) return d;
  if (d.length >= 10) return `92${d.replace(/^0+/, "")}`;
  return null;
}

/** Signed like ledger: positive = party owes you, negative = credit/advance, zero = settled. */
export function formatRemainingBalanceWhatsApp(signed: number): string {
  if (signed > 0) {
    return `*Remaining balance:* ${formatCurrency(signed)} (amount due)`;
  }
  if (signed < 0) {
    return `*Remaining balance:* ${formatCurrency(Math.abs(signed))} (credit / advance on account)`;
  }
  return `*Remaining balance:* ${formatCurrency(0)} (settled)`;
}

export function openWhatsAppNewTab(rawPhone: string, message: string): boolean {
  if (typeof window === "undefined") return false;
  const to = waMeDigitsFromNumber(rawPhone);
  if (!to) return false;
  const url = `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/** Pre-filled message only — user picks the contact in WhatsApp (no phone in URL). */
export function openWhatsAppMessageOnlyNewTab(message: string): void {
  if (typeof window === "undefined") return;
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function buildPaymentReceivedWhatsAppMessage(input: {
  partyName: string;
  amount: number;
  dateISO: string;
  method: string;
  description?: string;
  /** After this payment: positive = still due, negative = advance, 0 = settled. */
  remainingBalanceSigned: number;
}): string {
  const lines = [
    "*S.S. Diagnostics*",
    "",
    "Assalam-o-Alaikum,",
    "",
    `We confirm *payment received* from *${input.partyName}*.`,
    "",
    `*Amount:* ${formatCurrency(input.amount)}`,
    `*Date:* ${formatDate(input.dateISO)}`,
    `*Method:* ${input.method}`,
  ];
  if (input.description?.trim()) {
    lines.push(`*Note:* ${input.description.trim()}`);
  }
  lines.push("", formatRemainingBalanceWhatsApp(input.remainingBalanceSigned));
  lines.push("", "Thank you for your payment.", "", "S.S. Diagnostics", "", "_Software by AddsMint.com_");
  return lines.join("\n");
}

export type LedgerLineForWhatsApp = {
  date: string;
  doc: string;
  desc: string;
  debit: number;
  credit: number;
};

export type InvoiceShareLineItem = {
  category: string;
  description?: string;
  width: number;
  height: number;
  sqft: number;
  rate: number;
  qty: number;
  unit?: string;
  amount: number;
};

/** Share invoice summary with a customer (walk-in or party). Optional line items list product details. */
export function buildInvoiceShareWhatsAppMessage(input: {
  invoiceNumber: string;
  clientName: string;
  invoiceDate: string;
  grandTotal: number;
  amountReceived: number;
  balanceDue: number;
  paymentStatus: string;
  /** Invoice-level note (e.g. job / scope) */
  invoiceDescription?: string;
  items?: InvoiceShareLineItem[];
}): string {
  const status = input.paymentStatus.replace(/_/g, " ");
  const lines: string[] = [
    "*S.S. Diagnostics*",
    "",
    "Assalam-o-Alaikum,",
    "",
    `Invoice *${input.invoiceNumber}* — *${input.clientName}*`,
    `*Date:* ${formatDate(input.invoiceDate)}`,
    `*Total:* ${formatCurrency(input.grandTotal)}`,
    `*Received:* ${formatCurrency(input.amountReceived)}`,
    `*Balance due:* ${formatCurrency(input.balanceDue)}`,
    `*Status:* ${status}`,
  ];

  if (input.invoiceDescription?.trim()) {
    lines.push(`*Description:* ${input.invoiceDescription.trim()}`);
  }

  if (input.items && input.items.length > 0) {
    lines.push("", "*Products / line items:*");
    input.items.forEach((it, i) => {
      const name = (it.category || "").trim() || "Item";
      const extra = (it.description || "").trim();
      const label = extra ? `${name} (${extra})` : name;
      lines.push(
        `${i + 1}. *${label}* — qty *${it.qty}${it.unit && it.unit !== "unit" ? ` ${it.unit}` : ""}*, rate ${formatCurrency(invoiceUnitRate(it))}, amount *${formatCurrency(it.amount)}*`
      );
    });
  }

  lines.push("", "Thank you.", "", "S.S. Diagnostics", "", "_Software by AddsMint.com_");
  return lines.join("\n");
}

export type InvoiceExtraForWhatsApp = {
  grandTotal: number;
  amountReceived: number;
  paymentStatus: string;
  description?: string;
  items?: InvoiceShareLineItem[];
};

export function buildLastTransactionWhatsAppMessage(
  partyName: string,
  row: LedgerLineForWhatsApp,
  remainingBalanceSigned: number,
  invoiceExtra?: InvoiceExtraForWhatsApp
): string {
  const lines: string[] = [
    "*S.S. Diagnostics*",
    "",
    "Assalam-o-Alaikum,",
    "",
    `Regarding *${partyName}*, your *latest* transaction with us:`,
    "",
  ];

  if (row.debit > 0 && invoiceExtra) {
    // Full invoice detail
    const status = invoiceExtra.paymentStatus.replace(/_/g, " ");
    lines.push(
      `Invoice *${row.doc}* — *${partyName}*`,
      `*Date:* ${formatDate(row.date)}`,
      `*Total:* ${formatCurrency(invoiceExtra.grandTotal)}`,
      `*Received:* ${formatCurrency(invoiceExtra.amountReceived)}`,
      `*Balance due:* ${formatCurrency(Math.max(0, invoiceExtra.grandTotal - invoiceExtra.amountReceived))}`,
      `*Status:* ${status}`,
    );
    if (invoiceExtra.description?.trim()) {
      lines.push(`*Description:* ${invoiceExtra.description.trim()}`);
    }
    if (invoiceExtra.items && invoiceExtra.items.length > 0) {
      lines.push("", "*Products / line items:*");
      invoiceExtra.items.forEach((it, i) => {
        const name = (it.category || "").trim() || "Item";
        const extra = (it.description || "").trim();
        const label = extra ? `${name} (${extra})` : name;
        lines.push(
          `${i + 1}. *${label}* — qty *${it.qty}${it.unit && it.unit !== "unit" ? ` ${it.unit}` : ""}*, rate ${formatCurrency(invoiceUnitRate(it))}, amount *${formatCurrency(it.amount)}*`
        );
      });
    }
  } else if (row.debit > 0) {
    lines.push(`*Invoice / bill:* ${row.doc} — *${formatCurrency(row.debit)}* on *${formatDate(row.date)}*.\n${row.desc}`);
  } else if (row.credit > 0) {
    lines.push(`*Payment received:* *${formatCurrency(row.credit)}* on *${formatDate(row.date)}*.\n${row.desc}`);
  } else {
    lines.push(`${row.desc} — ${formatDate(row.date)}`);
  }

  lines.push(
    "",
    formatRemainingBalanceWhatsApp(remainingBalanceSigned),
    "",
    "If you have any questions, reply to this message.",
    "",
    "Thank you.",
    "",
    "S.S. Diagnostics",
    "",
    "_Software by AddsMint.com_",
  );
  return lines.join("\n");
}

export function buildSupplierPaymentWhatsAppMessage(input: {
  supplierName: string;
  amount: number;
  dateISO: string;
  method: string;
  description?: string;
  remainingPayable: number;
}): string {
  const lines = [
    "*S.S. Diagnostics*",
    "",
    "Assalam-o-Alaikum,",
    "",
    `This confirms *payment made* to *${input.supplierName}*.`,
    "",
    `*Amount:* ${formatCurrency(input.amount)}`,
    `*Date:* ${formatDate(input.dateISO)}`,
    `*Method:* ${input.method}`,
  ];
  if (input.description?.trim()) lines.push(`*Note:* ${input.description.trim()}`);
  lines.push(
    "",
    `*Remaining payable:* ${formatCurrency(Math.max(0, input.remainingPayable))}`,
    "",
    "Thank you.",
    "",
    "S.S. Diagnostics",
    "",
    "_Software by AddsMint.com_",
  );
  return lines.join("\n");
}
