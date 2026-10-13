import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { buildStockReport, stockSaleRevenue } from "@/lib/stockReport";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessPath(user, "/reports")) return NextResponse.json({ error: "Reports access required" }, { status: 403 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const category = request.nextUrl.searchParams.get("category") ?? "all";
  const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!validDate(from) || !validDate(to) || from > to || (category !== "all" && !/^[0-9a-f-]{36}$/i.test(category))) {
    return NextResponse.json({ error: "Select a valid date range and category." }, { status: 400 });
  }
  try {
    const products = await prisma.$transaction(tx => tx.product.findMany({
      where: category === "all" ? {} : { category_id: category }, orderBy: { name: "asc" },
      include: { category: true,
        stock_batches: { include: { purchase_item: true, allocations: { include: { invoice: { select: { invoice_date: true } } } } } },
        invoice_items: { include: { invoice: { include: { items: true } } } },
      },
    }), { isolationLevel: "RepeatableRead" });
    const rows = buildStockReport(products.map(p => ({
      id: p.id, code: p.code, name: p.name, category: p.category?.name ?? "Uncategorized",
      created_at: p.created_at.toISOString(), cost_price: Number(p.cost_price),
      batches: p.stock_batches.map(b => ({ received_date: b.received_date.toISOString().slice(0, 10),
        received_qty: Number(b.received_qty), remaining_qty: Number(b.remaining_qty),
        allocations: b.allocations.map(a => ({ qty: Number(a.qty), date: a.invoice.invoice_date.toISOString().slice(0, 10),
          cost: b.purchase_item && Number(b.purchase_item.qty) > 0 ? Number(b.purchase_item.amount) / Number(b.purchase_item.qty) : null })),
      })),
      sales: p.invoice_items.flatMap(line => {
        if (!line.invoice) return [];
        const total = line.invoice.items.reduce((sum, item) => sum + Number(item.amount), 0);
        return [{ date: line.invoice.invoice_date.toISOString().slice(0, 10), qty: Number(line.qty),
          deducted: Number(line.stock_deducted_qty), revenue: stockSaleRevenue(Number(line.amount), total, Number(line.invoice.discount_amount)) }];
      }),
    })), from, to);
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stock report failed", error);
    return NextResponse.json({ error: "Could not load stock report. Please try again." }, { status: 500 });
  }
}
