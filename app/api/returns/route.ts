import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { InventoryError } from "@/lib/inventory";
import { saveInvoiceReturn, uuidPattern } from "@/lib/invoiceReturns";

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
    if (!body || !uuidPattern.test(body.invoiceId ?? "") || !uuidPattern.test(body.requestId ?? "")) throw new InventoryError("Select an invoice and reload the return form.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date))
      || new Date(body.date).toISOString().slice(0, 10) !== body.date || body.date > today) throw new InventoryError("Select a valid return date no later than today.");
    if (typeof body.reason !== "string" || body.reason.length > 1000 || !Array.isArray(body.selections)) throw new InventoryError("Enter a reason of up to 1,000 characters and select the items to return.");
    if (body.selections.some((line: { invoice_item_id?: unknown; qty?: unknown } | null) => !line || typeof line.invoice_item_id !== "string" || typeof line.qty !== "number")) throw new InventoryError("Invalid return items.");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const record = await prisma.$transaction(tx => saveInvoiceReturn(tx, {
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
