import type { Cashbook, Prisma } from "@prisma/client";
import { buildInvoiceShareWhatsAppMessage, buildPaymentReceivedWhatsAppMessage, buildSupplierPaymentWhatsAppMessage } from "@/lib/whatsappWaMe";
import { normalizeWhatsAppPhone, type WhatsAppEvent } from "@/lib/whatsappPolicy";
import { computePartySignedBalance } from "@/lib/partyBalance";
import { isLedgerOnlyEntry } from "@/lib/paymentMethods";
import type { Invoice, CashbookEntry } from "@/lib/database.types";

type Tx = Prisma.TransactionClient;
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function enabled(tx: Tx, kind: WhatsAppEvent) {
  const settings = await tx.whatsAppSettings.findUnique({ where: { id: 1 } });
  const flag = kind === "invoice" ? settings?.invoice_enabled : kind === "payment_received" ? settings?.received_enabled : settings?.supplier_enabled;
  return settings?.enabled && settings.phone_number_id && flag ? settings : null;
}

async function enqueue(tx: Tx, input: { kind: WhatsAppEvent; sourceId: string; phone: string; name: string; body: string; sender: string }, refreshPending = false) {
  const phone = normalizeWhatsAppPhone(input.phone);
  const contact = phone ? await tx.whatsAppContact.findUnique({ where: { phone } }) : null;
  const reason = !phone ? "Missing or invalid recipient number" : !contact?.opted_in_at || contact.opted_out_at ? "Recipient consent required" : "";
  const data = { phone: phone ?? "", phone_number_id: input.sender, recipient_name: input.name, body: input.body,
    status: reason ? "blocked" : "queued", reason };
  if (refreshPending) {
    // Amend only notifications that have never been submitted. Never resend an
    // accepted/unknown delivery, or create a notification for a historical edit.
    await tx.whatsAppMessage.updateMany({ where: { event_key: `${input.kind}:${input.sourceId}`, attempts: 0, status: { in: ["queued", "blocked"] } }, data });
    return;
  }
  // The outbox and business record commit together. Save/print or HTTP retries
  // cannot produce a second notification for the same persisted document.
  await tx.whatsAppMessage.upsert({
    where: { event_key: `${input.kind}:${input.sourceId}` }, update: {},
    create: { event_key: `${input.kind}:${input.sourceId}`, kind: input.kind, source_id: input.sourceId,
      ...data },
  });
}

export async function enqueueInvoice(tx: Tx, id: string, refreshPending = false) {
  const settings = await enabled(tx, "invoice");
  if (!settings) {
    if (refreshPending) await tx.whatsAppMessage.updateMany({ where: { event_key: `invoice:${id}`, status: { in: ["queued", "blocked"] } }, data: { status: "cancelled", reason: "Invoice amended while automation was paused" } });
    return;
  }
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const parties = !invoice.is_walk_in ? await tx.account.findMany({ where: { name: invoice.client_name }, take: 2 }) : [];
  const party = parties.length === 1 ? parties[0] : null;
  const items = invoice.items.map(line => ({ category: line.category, description: line.description,
    width: Number(line.width), height: Number(line.height), sqft: Number(line.sqft), rate: Number(line.rate), qty: Number(line.qty), amount: Number(line.amount) }));
  const input = { invoiceNumber: invoice.invoice_number, clientName: invoice.client_name, invoiceDate: iso(invoice.invoice_date),
    grandTotal: Number(invoice.grand_total), amountReceived: Number(invoice.amount_received), balanceDue: Number(invoice.balance_due),
    paymentStatus: invoice.payment_status, invoiceDescription: invoice.job_notes || invoice.job_name, items };
  const body = buildInvoiceShareWhatsAppMessage(input);
  await enqueue(tx, { kind: "invoice", sourceId: id, sender: settings.phone_number_id,
    phone: party?.whatsapp || party?.phone || invoice.client_phone, name: invoice.client_name, body
 }, refreshPending);
}

export async function enqueuePayment(tx: Tx, entry: Cashbook) {
  if (Number(entry.amount) <= 0 || isLedgerOnlyEntry(entry)) return;
  const kind = entry.type === "in" ? "payment_received" : "supplier_payment";
  const settings = await enabled(tx, kind);
  if (!settings) return;
  if (entry.type === "in") {
    if (!entry.account_name || !/^Payment received from /i.test(entry.description)) return;
    const parties = await tx.account.findMany({ where: { name: entry.account_name }, take: 2 });
    if (parties.length !== 1) return; // Never guess a recipient when names collide.
    const party = parties[0];
    const invoices = await tx.invoice.findMany({ where: { client_name: party.name, is_walk_in: false } });
    const cash = await tx.cashbook.findMany({ where: { account_name: { equals: party.name, mode: "insensitive" } } });
    const signed = computePartySignedBalance(party.name,
      JSON.parse(JSON.stringify(invoices)) as Invoice[], JSON.parse(JSON.stringify(cash)) as CashbookEntry[]);
    const description = entry.description.startsWith(`Payment received from ${party.name} — `)
      ? entry.description.slice(`Payment received from ${party.name} — `.length) : "";
    const input = { partyName: party.name, amount: Number(entry.amount), dateISO: iso(entry.date), method: entry.method,
      description, remainingBalanceSigned: signed };
    await enqueue(tx, { kind, sourceId: entry.id, sender: settings.phone_number_id, phone: party.whatsapp || party.phone,
      name: party.name, body: buildPaymentReceivedWhatsAppMessage(input) });
  } else if (entry.type === "out" && /^[0-9a-f-]{36}$/i.test(entry.reference)) {
    const supplier = await tx.supplier.findUnique({ where: { id: entry.reference } });
    const purchase = supplier ? null : await tx.purchaseOrder.findUnique({ where: { id: entry.reference }, include: { supplier: true } });
    const target = supplier ?? purchase?.supplier;
    if (!target) return;
    const purchases = supplier ? await tx.purchaseOrder.findMany({ where: { supplier_id: supplier.id } }) : [];
    const remainingPayable = supplier ? Math.max(0, Number(supplier.opening_balance) + purchases.reduce((sum, p) => sum + Number(p.balance_due), 0) - Number(entry.amount))
      : Math.max(0, Number(purchase!.balance_due));
    const description = purchase ? `Advance/paid amount for PO ${purchase.po_number}`
      : entry.description.startsWith(`Supplier payment — ${target.name} — `) ? entry.description.slice(`Supplier payment — ${target.name} — `.length) : "";
    const input = { supplierName: target.name, amount: Number(entry.amount), dateISO: iso(entry.date), method: entry.method, description, remainingPayable };
    await enqueue(tx, { kind, sourceId: entry.id, sender: settings.phone_number_id, phone: target.phone, name: target.name,
      body: buildSupplierPaymentWhatsAppMessage(input) });
  }
}
