import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { returnAdmin } from "@/lib/returnAdmin";
import { canAccessPath } from "@/lib/moduleAccess";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { createDirectSettlement, reverseDirectSettlement, SettlementError } from "@/lib/directSettlements";
import { partySettlementTransaction } from "@/lib/partyInvoiceSettlement";
import { loadPartyCashbook } from "@/lib/partyCashbook";
import { computePartySignedBalance } from "@/lib/partyBalance";
import type { Invoice, CashbookEntry } from "@/lib/database.types";
import { whatsAppOriginAllowed as sameOriginAllowed } from "@/lib/whatsappApi";
import { businessDate } from "@/lib/returnPeriod";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: unknown) => {
  if (error instanceof SettlementError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (["P2021", "P2022"].includes((error as { code?: string })?.code ?? "")) return NextResponse.json({ error: "Direct settlements need the v43 database upgrade." }, { status: 503 });
  console.error("Direct settlement failed", error);
  return NextResponse.json({ error: "Could not confirm settlement. Reload history before retrying." }, { status: 500 });
};
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyToken(request.cookies.get(COOKIE_NAME)?.value ?? "");
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { id: auth.sub } });
    const historyOnly = request.nextUrl.searchParams.get("history") === "1";
    if (!user?.is_active || (user.role !== "super_admin" && (!historyOnly || !canAccessPath(user, "/cashbook")))) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const data = await prisma.$transaction(async tx => {
      const records = await tx.directSettlement.findMany({ orderBy: [{ date: "desc" }, { created_at: "desc" }] });
      if (historyOnly) return { records };
      const customers = await tx.account.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } });
      const suppliers = await tx.supplier.findMany({ orderBy: { name: "asc" } });
      const orders = await tx.purchaseOrder.findMany({ include: { returns: { where: { reversed_at: null }, select: { amount: true } } } });
      const invoices = await tx.invoice.findMany({ where: { is_walk_in: false } });
      const cash = await tx.cashbook.findMany();
      const owned = await loadPartyCashbook(tx, cash, invoices.map(i => i.id));
      const invoiceRows = JSON.parse(JSON.stringify(invoices)) as Invoice[];
      const cashRows = JSON.parse(JSON.stringify(owned)) as CashbookEntry[];
      const customerOptions = customers.map(customer => ({ id: customer.id, name: customer.name,
        balance: computePartySignedBalance(customer.name, invoiceRows, cashRows) }));
      return { records, customers: customerOptions, suppliers: suppliers.map(s => ({ id: s.id, name: s.name,
        balance: Number(s.opening_balance) + orders.filter(p => p.supplier_id === s.id || !p.supplier_id && p.supplier_name.toLowerCase() === s.name.toLowerCase() && suppliers.filter(v => v.name.toLowerCase() === s.name.toLowerCase()).length === 1)
          .reduce((n, p) => n + Math.max(0, Number(p.grand_total) - Number(p.amount_paid) - p.returns.reduce((v, r) => v + Number(r.amount), 0)), 0) })) };
    }, { isolationLevel: "RepeatableRead", timeout: 30000 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(request: NextRequest) {
  try {
    if (!sameOriginAllowed(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const actor = await returnAdmin(request);
    if (!actor) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const input = await request.json();
    let record;
    if (input?.action === "reverse") {
      if (!uuid.test(input.id ?? "") || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) throw new SettlementError("Select a settlement and enter a reversal reason (1–1,000 characters).");
      record = await partySettlementTransaction(prisma, tx => reverseDirectSettlement(tx, input.id, input.reason.trim(), actor));
    } else {
      if (!input || ![input.request_id, input.customer_id, input.supplier_id].every(v => typeof v === "string" && uuid.test(v))) throw new SettlementError("Select a customer and supplier.");
      if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 9999999999.99 || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 0.0001) throw new SettlementError("Enter a positive amount with at most two decimal places.");
      if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date || input.date < "2000-01-01" || input.date > businessDate()) throw new SettlementError("Enter a valid payment date, not in the future.");
      if (typeof input.reference !== "string" || input.reference.length > 200 || typeof input.notes !== "string" || input.notes.length > 1000) throw new SettlementError("Reference is limited to 200 characters and notes to 1,000.");
      record = await partySettlementTransaction(prisma, tx => createDirectSettlement(tx, { request_id: input.request_id, customer_id: input.customer_id, supplier_id: input.supplier_id,
        amount: input.amount, date: input.date, reference: input.reference.trim(), notes: input.notes.trim() }, actor));
    }
    return NextResponse.json({ record });
  } catch (error) { return fail(error); }
}
