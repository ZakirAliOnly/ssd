import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { returnScope, type ReturnHistoryEntry } from "@/lib/returnHistory";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active || !canAccessPath(user, "/returns")) return NextResponse.json({ error: "Returns access required." }, { status: 403 });
  const type = request.nextUrl.searchParams.get("type") ?? "sales";
  const id = request.nextUrl.searchParams.get("id");
  if (!["sales", "supplier"].includes(type) || (id && !uuid.test(id))) return NextResponse.json({ error: "Select a valid return." }, { status: 400 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawPage = Number(request.nextUrl.searchParams.get("page") ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const contains = { contains: q, mode: "insensitive" as const };
  try {
    const result = await prisma.$transaction(async tx => {
      if (type === "supplier") {
        const where = id ? { id } : q ? { OR: [
          { purchase_order: { po_number: contains } }, { purchase_order: { supplier_name: contains } },
          { items: { some: { product_name: contains } } }, ...(uuid.test(q) ? [{ id: q }] : []),
        ] } : {};
        const count = await tx.supplierReturn.count({ where });
        const records = await tx.supplierReturn.findMany({ where, take: id ? 1 : 25, skip: id ? 0 : (page - 1) * 25,
          orderBy: [{ return_date: "desc" }, { created_at: "desc" }, { id: "desc" }],
          include: { items: true, purchase_order: { include: { items: true, returns: { include: { items: true } } } } },
        });
        const returns: ReturnHistoryEntry[] = records.map(r => ({
          id: r.id, type: "supplier", return_date: r.return_date.toISOString(), created_at: r.created_at.toISOString(), reason: r.reason,
          amount: String(r.amount), created_by_name: r.created_by_name, invoice_number: r.purchase_order.po_number,
          invoice_date: r.purchase_order.order_date.toISOString(), party: r.purchase_order.supplier_name,
          scope: returnScope(r.purchase_order.items, r.items.map(i => ({ id: i.purchase_item_id, qty: i.qty })),
            r.purchase_order.returns.filter(p => p.created_at < r.created_at || (+p.created_at === +r.created_at && p.id < r.id)).flatMap(p => p.items.map(i => ({ id: i.purchase_item_id, qty: i.qty })))),
          items: r.items.map(i => ({ id: i.id, product_name: i.product_name, description: i.description, qty: String(i.qty), amount: String(i.amount), stock_restored_qty: String(i.stock_removed_qty) })),
        }));
        return { returns, count, page };
      }
      const where = id ? { id } : q ? { OR: [
        { invoice: { invoice_number: contains } }, { invoice: { client_name: contains } },
        { items: { some: { product_name: contains } } }, ...(uuid.test(q) ? [{ id: q }] : []),
      ] } : {};
      const count = await tx.invoiceReturn.count({ where });
      const records = await tx.invoiceReturn.findMany({ where, take: id ? 1 : 25, skip: id ? 0 : (page - 1) * 25,
        orderBy: [{ return_date: "desc" }, { created_at: "desc" }, { id: "desc" }],
        include: { items: true, invoice: { include: { items: true, returns: { include: { items: true } } } } },
      });
      const returns: ReturnHistoryEntry[] = records.map(r => ({
        id: r.id, type: "sales", return_date: r.return_date.toISOString(), created_at: r.created_at.toISOString(), reason: r.reason,
        amount: String(r.amount), created_by_name: r.created_by_name, invoice_number: r.invoice.invoice_number,
        invoice_date: r.invoice.invoice_date.toISOString(), party: r.invoice.client_name || "Walk-in",
        scope: returnScope(r.invoice.items, r.items.map(i => ({ id: i.invoice_item_id, qty: i.qty })),
          r.invoice.returns.filter(p => p.created_at < r.created_at || (+p.created_at === +r.created_at && p.id < r.id)).flatMap(p => p.items.map(i => ({ id: i.invoice_item_id, qty: i.qty })))),
        items: r.items.map(i => ({ id: i.id, product_name: i.product_name, description: i.description, qty: String(i.qty), amount: String(i.amount), stock_restored_qty: String(i.stock_restored_qty) })),
      }));
      return { returns, count, page };
    }, { isolationLevel: "RepeatableRead" });
    if (id && !result.returns.length) return NextResponse.json({ error: "Return not found." }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Return history failed", error);
    return NextResponse.json({ error: "Could not load return history. Please try again." }, { status: 500 });
  }
}
