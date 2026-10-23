import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { partyBalanceOverview } from "@/lib/partyOverview";
import type { Invoice, CashbookEntry } from "@/lib/database.types";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessPath(user, "/accounts")) return NextResponse.json({ error: "Parties access required" }, { status: 403 });
  const party = request.nextUrl.searchParams.get("party");
  if (party != null && (!party.trim() || party.length > 2000)) return NextResponse.json({ error: "Choose a valid party." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      const [accounts, heads, invoices, cashbook] = await Promise.all([
        tx.account.findMany({ where: party == null ? {} : { name: party }, include: { head_account: true }, orderBy: { name: "asc" } }),
        tx.headAccount.findMany({ orderBy: { code: "asc" } }),
        tx.invoice.findMany({ where: { is_walk_in: false, ...(party == null ? {} : { client_name: party }) }, select: party == null ? { id: true, client_name: true, is_walk_in: true,
          grand_total: true, amount_received: true, invoice_date: true, created_at: true, invoice_number: true } : undefined }),
        tx.cashbook.findMany({ where: party == null ? {} : { account_name: { equals: party, mode: "insensitive" } }, select: { id: true, account_name: true, type: true, amount: true, method: true,
          description: true, reference: true, date: true, created_at: true } }),
      ]);
      const balances = partyBalanceOverview(accounts, invoices as unknown as Invoice[], cashbook as unknown as CashbookEntry[]);
      return { accounts: accounts.map(({ head_account, ...account }) => ({ ...account, head_accounts: head_account })), heads, balances,
        ...(party == null ? {} : {
          invoices: invoices.map(invoice => ({ ...invoice, invoice_date: new Date(invoice.invoice_date).toISOString().slice(0, 10) })),
          cashbook: cashbook.map(entry => ({ ...entry, date: new Date(entry.date).toISOString().slice(0, 10) })),
        }) };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Parties overview failed", error);
    return NextResponse.json({ error: "Could not load parties. Please try again." }, { status: 500 });
  }
}
