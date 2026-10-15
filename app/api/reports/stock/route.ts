import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { buildStockReport } from "@/lib/stockReport";
import { invoiceUnitRate } from "@/lib/invoicePricing";
import { invoiceLineRevenues } from "@/lib/invoiceReturns";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessPath(user, "/reports")) return NextResponse.json({ error: "Reports access required" }, { status: 403 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const product = request.nextUrl.searchParams.get("product") ?? "all";
  const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!validDate(from) || !validDate(to) || from > to || (product !== "all" && !/^[0-9a-f-]{36}$/i.test(product))) {
    return NextResponse.json({ error: "Select a valid date range and product." }, { status: 400 });
  }
  try {
    const products = await prisma.$transaction(tx => tx.product.findMany({
      where: product === "all" ? {} : { id: product }, orderBy: { name: "asc" },
      include: { category: true,
        stock_batches: { include: { purchase_item: true, supplier_returns: { include: { supplier_return: { select: { return_date: true } } } }, allocations: { include: { invoice: { select: { invoice_date: true } }, returns: { include: { return_item: { include: { invoice_return: { select: { return_date: true } } } } } } } } } },
        invoice_items: { include: { invoice: { include: { items: true } } } },
        return_items: { include: { invoice_return: { select: { return_date: true } } } },
      },
    }), { isolationLevel: "RepeatableRead" });
    const rows = buildStockReport(products.map(p => ({
      id: p.id, code: p.code, name: p.name, description: p.description, category: p.category?.name ?? "Uncategorized",
      created_at: p.created_at.toISOString(), cost_price: Number(p.cost_price),
      batches: p.stock_batches.map(b => ({ received_date: b.received_date.toISOString().slice(0, 10),
        received_qty: Number(b.received_qty), remaining_qty: Number(b.remaining_qty),
        supplier_returns: b.supplier_returns.map(r => ({ qty: Number(r.stock_removed_qty), date: r.supplier_return.return_date.toISOString().slice(0, 10) })),
        allocations: b.allocations.map(a => ({ qty: Number(a.qty), date: a.invoice.invoice_date.toISOString().slice(0, 10),
          cost: b.purchase_item && Number(b.purchase_item.qty) > 0 ? Number(b.purchase_item.amount) / Number(b.purchase_item.qty) : null,
          returns: a.returns.map(r => ({ qty: Number(r.qty), date: r.return_item.invoice_return.return_date.toISOString().slice(0, 10) })) })),
      })),
      sales: p.invoice_items.flatMap(line => {
        if (!line.invoice) return [];
        const revenue = invoiceLineRevenues(line.invoice.items, line.invoice.discount_amount).get(line.id) ?? 0;
        return [{ date: line.invoice.invoice_date.toISOString().slice(0, 10), qty: Number(line.qty),
          deducted: Number(line.stock_deducted_qty), revenue,
          lineId: line.id, invoiceId: line.invoice.id, invoiceNumber: line.invoice.invoice_number,
          customer: line.invoice.client_name, unitPrice: invoiceUnitRate(line), amount: Number(line.amount) }];
      }),
      returns: p.return_items.map(line => ({ date: line.invoice_return.return_date.toISOString().slice(0, 10),
        qty: Number(line.qty), restored: Number(line.stock_restored_qty), revenue: Number(line.revenue) })),
    })), from, to);
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stock report failed", error);
    return NextResponse.json({ error: "Could not load stock report. Please try again." }, { status: 500 });
  }
}
