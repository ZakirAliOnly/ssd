import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { invoiceQuantityBefore, validReturnReportRange, type ReturnReportRow } from "@/lib/returnReport";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const auth = token ? await verifyToken(token) : null;
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
    if (!user?.is_active || !canAccessPath(user, "/reports")) return NextResponse.json({ error: "Reports access required." }, { status: 403 });
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    if (!validReturnReportRange(from, to)) return NextResponse.json({ error: "Select a valid date range." }, { status: 400 });
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const contains = { contains: q, mode: "insensitive" as const };
    const records = await prisma.invoiceReturn.findMany({
      where: { return_date: { gte: new Date(from), lte: new Date(to) },
        ...(q ? { OR: [{ invoice: { invoice_number: contains } }, { invoice: { client_name: contains } }, { items: { some: { product_name: contains } } }] } : {}),
      },
      orderBy: [{ return_date: "desc" }, { created_at: "desc" }, { id: "desc" }],
      include: { invoice: { select: { invoice_number: true, client_name: true,
        returns: { select: { id: true, created_at: true, reversed_at: true, items: { select: { invoice_item_id: true, qty: true } } } },
      } },
        items: { include: { invoice_item: { select: { qty: true } } }, orderBy: { id: "asc" } } },
    });
    const numberOrNull = (value: unknown) => value == null ? null : Number(value);
    const rows: ReturnReportRow[] = records.flatMap(record => record.items.map(item => {
      const invoiceBefore = numberOrNull(item.invoice_before_qty) ?? invoiceQuantityBefore(item.invoice_item.qty, item.invoice_item_id, record, record.invoice.returns);
      return {
      id: item.id, returnId: record.id, date: record.return_date.toISOString().slice(0, 10),
      invoiceNumber: record.invoice.invoice_number, customer: record.invoice.client_name || "Walk-in",
      product: item.product_name, description: item.description, unit: item.unit,
      originalQty: Number(item.invoice_item.qty), returnedQty: Number(item.qty),
      invoiceBefore, invoiceAfter: numberOrNull(item.invoice_after_qty) ?? Math.round((invoiceBefore - Number(item.qty)) * 100) / 100,
      stockBefore: numberOrNull(item.stock_before_qty), stockAfter: numberOrNull(item.stock_after_qty), stockUnit: item.stock_unit,
      amount: Number(item.amount), reversedAt: record.reversed_at?.toISOString() ?? null, reason: record.reason,
    }; }));
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Return report failed", error);
    const code = (error as { code?: string }).code;
    return NextResponse.json({ error: code === "P2021" || code === "P2022"
      ? "Return Report needs a database upgrade. Ask your administrator to run db:upgrade:return-report."
      : "Could not load Return Report. Please try again." }, { status: code === "P2021" || code === "P2022" ? 503 : 500 });
  }
}
