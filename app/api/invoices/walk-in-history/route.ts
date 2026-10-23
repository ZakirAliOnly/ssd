import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE = 15;
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessPath(user, "/quick-invoice")) return NextResponse.json({ error: "Walk-in invoice access required." }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const month = params.get("month") || "";
  const status = params.get("status") || "all";
  const rawPage = params.get("page") ?? "1";
  if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)) || !["all", "paid", "unpaid", "partial"].includes(status)
    || (month && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")))) {
    return NextResponse.json({ error: "Select a valid month, payment status and page." }, { status: 400 });
  }
  const where: Prisma.InvoiceWhereInput = { is_walk_in: true };
  if (status !== "all") where.payment_status = status;
  if (month) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    where.invoice_date = { gte: start, lt: end };
  }
  try {
    const result = await prisma.$transaction(async tx => {
      const total = await tx.invoice.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(Number(rawPage), totalPages);
      const rows = await tx.invoice.findMany({ where, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { id: true, invoice_number: true, client_name: true, invoice_date: true,
          grand_total: true, amount_received: true, previous_balance: true, balance_due: true,
          payment_status: true, payment_method: true, created_by_name: true, created_by_email: true,
          subtotal: true, discount_amount: true, discount_type: true, discount_value: true },
      });
      const invoices = rows.map(row => ({ ...row, invoice_date: row.invoice_date.toISOString().slice(0, 10),
        grand_total: Number(row.grand_total), amount_received: Number(row.amount_received),
        previous_balance: Number(row.previous_balance), balance_due: Number(row.balance_due),
        subtotal: Number(row.subtotal), discount_amount: Number(row.discount_amount), discount_value: Number(row.discount_value),
      }));
      return { invoices, total, page, totalPages, pageSize: PAGE_SIZE };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Walk-in invoice history failed", error);
    return NextResponse.json({ error: "Could not load invoice history. Please try again." }, { status: 500 });
  }
}
