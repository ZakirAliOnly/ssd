import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { InventoryError } from "@/lib/inventory";
import { saveInvoiceReturn, uuidPattern } from "@/lib/invoiceReturns";
import { saveSupplierReturn } from "@/lib/supplierReturns";

async function authorize(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return null;
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active || !canAccessPath(user, "/returns")) return null;
  return { email: auth.email, name: auth.full_name || auth.email.split("@")[0] };
}
function failure(error: unknown) {
  if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 400 });
  const code = (error as { code?: string }).code;
  if (code === "P2021" || code === "P2022") return NextResponse.json({ error: "Returns is not set up yet. Ask your administrator to complete the database upgrade." }, { status: 503 });
  console.error("Returns request failed", error);
  return NextResponse.json({ error: "Could not complete this request. Reload the invoice before trying again." }, { status: 500 });
}
export async function GET(request: NextRequest) {
  try {
    if (!await authorize(request)) return NextResponse.json({ error: "Returns access required." }, { status: 403 });
    const id = request.nextUrl.searchParams.get("id");
    const type = request.nextUrl.searchParams.get("type") ?? "sales";
    if (!["sales", "supplier"].includes(type)) throw new InventoryError("Select a valid return tab.");
    if (type === "supplier") {
      if (id) {
        if (!uuidPattern.test(id)) throw new InventoryError("Select a valid supplier invoice.");
        const purchase = await prisma.purchaseOrder.findUnique({ where: { id }, include: {
          items: { include: { stock_batch: { include: { product: { select: { name: true } } } }, return_items: true }, orderBy: { id: "asc" } },
          returns: { include: { items: true }, orderBy: [{ created_at: "desc" }, { id: "desc" }] },
        } });
        if (!purchase) return NextResponse.json({ error: "Supplier invoice not found." }, { status: 404 });
        return NextResponse.json({ invoice: { ...purchase, invoice_number: purchase.po_number, client_name: purchase.supplier_name,
          invoice_date: purchase.order_date, is_walk_in: false,
          discount_amount: purchase.items.reduce((sum, item) => sum + Number(item.amount), 0) - Number(purchase.grand_total),
          items: purchase.items.map(item => ({ ...item, category: item.description, product: item.stock_batch?.product ?? null,
            stock_deducted_qty: item.stock_received_qty, available_qty: item.stock_batch?.remaining_qty ?? null,
            return_items: item.return_items.map(r => ({ ...r, invoice_item_id: r.purchase_item_id, stock_restored_qty: r.stock_removed_qty, revenue: r.amount })) })),
          returns: purchase.returns.map(record => ({ ...record, items: record.items.map(item => ({ ...item, stock_restored_qty: item.stock_removed_qty })) })),
        } }, { headers: { "Cache-Control": "no-store" } });
      }
      const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
      const rawPage = Number(request.nextUrl.searchParams.get("page") ?? 1);
      const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
      const where = q ? { OR: [{ po_number: { contains: q, mode: "insensitive" as const } },
        { supplier_name: { contains: q, mode: "insensitive" as const } }, ...(uuidPattern.test(q) ? [{ id: q }] : [])] } : {};
      const [purchases, count] = await prisma.$transaction([
        prisma.purchaseOrder.findMany({ where, take: 25, skip: (page - 1) * 25,
          orderBy: [{ order_date: "desc" }, { created_at: "desc" }, { id: "desc" }],
          select: { id: true, po_number: true, supplier_name: true, order_date: true, grand_total: true, returns: { select: { amount: true } } } }),
        prisma.purchaseOrder.count({ where }),
      ]);
      return NextResponse.json({ invoices: purchases.map(p => ({ ...p, invoice_number: p.po_number, client_name: p.supplier_name, invoice_date: p.order_date, is_walk_in: false })), count, page }, { headers: { "Cache-Control": "no-store" } });
    }
    if (id) {
      if (!uuidPattern.test(id)) throw new InventoryError("Select a valid invoice.");
      const invoice = await prisma.invoice.findUnique({ where: { id }, include: {
        items: { include: { product: { select: { name: true } }, return_items: true }, orderBy: { id: "asc" } },
        returns: { include: { items: true }, orderBy: [{ created_at: "desc" }, { id: "desc" }] },
      } });
      if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
      return NextResponse.json({ invoice }, { headers: { "Cache-Control": "no-store" } });
    }
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const rawPage = Number(request.nextUrl.searchParams.get("page") ?? 1);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const where = q ? { OR: [
      { invoice_number: { contains: q, mode: "insensitive" as const } },
      { client_name: { contains: q, mode: "insensitive" as const } },
      ...(uuidPattern.test(q) ? [{ id: q }] : []),
    ] } : {};
    const [invoices, count] = await prisma.$transaction([
      prisma.invoice.findMany({ where, orderBy: [{ invoice_date: "desc" }, { created_at: "desc" }, { id: "desc" }],
        take: 25, skip: (page - 1) * 25, select: { id: true, invoice_number: true, client_name: true,
          invoice_date: true, grand_total: true, is_walk_in: true, returns: { select: { amount: true } } } }),
      prisma.invoice.count({ where }),
    ]);
    return NextResponse.json({ invoices, count, page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await authorize(request);
    if (!user) return NextResponse.json({ error: "Returns access required." }, { status: 403 });
    const body = await request.json();
    if (body?.type !== undefined && !["sales", "supplier"].includes(body.type)) throw new InventoryError("Select a valid return tab.");
    if (!body || !uuidPattern.test(body.invoiceId ?? "") || !uuidPattern.test(body.requestId ?? "")) throw new InventoryError("Select an invoice and reload the return form.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date))
      || new Date(body.date).toISOString().slice(0, 10) !== body.date || body.date > today) throw new InventoryError("Select a valid return date no later than today.");
    if (typeof body.reason !== "string" || body.reason.length > 1000 || !Array.isArray(body.selections)) throw new InventoryError("Enter a reason of up to 1,000 characters and select the items to return.");
    if (body.selections.some((line: { invoice_item_id?: unknown; qty?: unknown } | null) => !line || typeof line.invoice_item_id !== "string" || typeof line.qty !== "number")) throw new InventoryError("Invalid return items.");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const save = body.type === "supplier" ? saveSupplierReturn : saveInvoiceReturn;
        const record = await prisma.$transaction(async tx => await save(tx, {
          invoiceId: body.invoiceId, requestId: body.requestId, date: body.date, reason: body.reason.trim(), selections: body.selections,
        }, user), { isolationLevel: "Serializable", timeout: 20000 });
        return NextResponse.json({ record });
      } catch (error) {
        if (attempt < 3 && ["P2034", "P2002"].includes((error as { code?: string }).code ?? "")) continue;
        throw error;
      }
    }
  } catch (error) { return failure(error); }
}
