import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { dailyCashEntries, type DailyActivity, type DailyStatementData } from "@/lib/dailyStatement";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active || !canAccessPath(user, "/reports")) return NextResponse.json({ error: "Reports access required." }, { status: 403 });
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "Select a valid report date." }, { status: 400 });
  }
  try {
    const day = new Date(date);
    const [sales, purchases, returns, supplierReturns, expenses, cash] = await prisma.$transaction([
      prisma.invoice.findMany({ where: { invoice_date: day }, orderBy: [{ created_at: "asc" }, { id: "asc" }], select: { id: true, invoice_number: true, client_name: true, grand_total: true, is_walk_in: true } }),
      prisma.purchaseOrder.findMany({ where: { order_date: day }, orderBy: [{ created_at: "asc" }, { id: "asc" }], select: { id: true, po_number: true, supplier_name: true, grand_total: true } }),
      prisma.invoiceReturn.findMany({ where: { return_date: day }, orderBy: [{ created_at: "asc" }, { id: "asc" }], include: { invoice: { select: { invoice_number: true, client_name: true } }, items: true } }),
      prisma.supplierReturn.findMany({ where: { return_date: day }, orderBy: [{ created_at: "asc" }, { id: "asc" }], include: { purchase_order: { select: { po_number: true, supplier_name: true } }, items: true } }),
      prisma.expense.findMany({ where: { date: day }, orderBy: [{ created_at: "asc" }, { id: "asc" }] }),
      prisma.cashbook.findMany({ where: { date: day }, orderBy: [{ created_at: "asc" }, { id: "asc" }] }),
    ], { isolationLevel: "RepeatableRead" });
    const activity: DailyActivity[] = [
      ...sales.map(s => ({ id: s.id, kind: "Sale" as const, reference: s.invoice_number, party: s.client_name || "Walk-in", amount: Number(s.grand_total), details: s.is_walk_in ? "Walk-in invoice" : "Party invoice" })),
      ...purchases.map(p => ({ id: p.id, kind: "Purchase" as const, reference: p.po_number, party: p.supplier_name, amount: Number(p.grand_total), details: "Supplier invoice" })),
      ...returns.map(r => ({ id: r.id, kind: "Sales return" as const, reference: r.invoice.invoice_number, party: r.invoice.client_name || "Walk-in", amount: Number(r.amount), details: `Return ${r.id}: ${r.items.map(i => `${i.product_name} × ${Number(i.qty)}`).join(", ")}${r.reason ? ` / ${r.reason}` : ""}` })),
      ...supplierReturns.map(r => ({ id: r.id, kind: "Supplier return" as const, reference: r.purchase_order.po_number, party: r.purchase_order.supplier_name, amount: Number(r.amount), details: `Return ${r.id}: ${r.items.map(i => `${i.product_name} × ${Number(i.qty)}`).join(", ")}${r.reason ? ` / ${r.reason}` : ""}` })),
    ];
    const result: DailyStatementData = { date, activity,
      cash: dailyCashEntries(cash.map(e => ({ id: e.id, type: e.type, amount: Number(e.amount), description: e.description, method: e.method, reference: e.reference }))),
      expenses: expenses.map(e => ({ id: e.id, reference: e.expense_number || e.id, description: e.description, category: e.category, amount: Number(e.amount), completed: e.completed })),
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Daily statement failed", error);
    return NextResponse.json({ error: "Could not load the daily statement. Please try again." }, { status: 500 });
  }
}
