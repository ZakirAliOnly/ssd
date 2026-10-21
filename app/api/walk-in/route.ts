import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessPath } from "@/lib/moduleAccess";
import { privateReadHeaders, readAccess, readPage } from "@/lib/readAccess";

export async function GET(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateReadHeaders });
  try {
    const user = await readAccess(request, ["invoices"]);
    if (!user || !canAccessPath(user, "/quick-invoice")) return json({ error: "Walk-in invoice access required." }, 403);
    const params = request.nextUrl.searchParams;
    if (params.get("mode") === "summary") {
      // Only administrators see these cards; do not fetch them for other users.
      if (user.role !== "super_admin") return json({ error: "Administrator access required." }, 403);
      const today = params.get("today") ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today)) || new Date(today).toISOString().slice(0, 10) !== today) return json({ error: "Invalid date." }, 400);
      const sums = { grand_total: true, amount_received: true, balance_due: true } as const;
      const [day, all] = await prisma.$transaction([
        prisma.invoice.aggregate({ where: { is_walk_in: true, invoice_date: new Date(today) }, _count: true, _sum: sums }),
        prisma.invoice.aggregate({ where: { is_walk_in: true }, _count: true, _sum: sums }),
      ]);
      return json({ summary: {
        todayInvoices: day._count, todaySales: Number(day._sum.grand_total ?? 0), todayReceived: Number(day._sum.amount_received ?? 0), todayPending: Number(day._sum.balance_due ?? 0),
        totalInvoices: all._count, totalSales: Number(all._sum.grand_total ?? 0), totalReceived: Number(all._sum.amount_received ?? 0), totalPending: Number(all._sum.balance_due ?? 0),
      } });
    }
    const pageSize = 25;
    const result = await prisma.$transaction(async tx => {
      const where = { is_walk_in: true };
      const count = await tx.invoice.count({ where });
      const page = Math.min(readPage(params.get("page")), Math.max(1, Math.ceil(count / pageSize)));
      const invoices = await tx.invoice.findMany({ where, take: pageSize, skip: (page - 1) * pageSize,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { id: true, invoice_number: true, client_name: true, invoice_date: true, grand_total: true, amount_received: true,
          previous_balance: true, balance_due: true, payment_status: true, payment_method: true, created_by_name: true,
          created_by_email: true, subtotal: true, discount_amount: true, discount_type: true, discount_value: true },
      });
      return { invoices: invoices.map(invoice => ({ ...invoice, invoice_date: invoice.invoice_date.toISOString().slice(0, 10) })), count, page, pageSize };
    });
    return json(result);
  } catch (error) {
    console.error("Walk-in read failed", error);
    return json({ error: "Could not load walk-in invoices. Please try again." }, 500);
  }
}
