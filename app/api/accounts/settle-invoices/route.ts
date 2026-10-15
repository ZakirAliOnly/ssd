import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { partySettlementTransaction, settlePartyInvoices } from "@/lib/partyInvoiceSettlement";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active || !canAccessPath(user, "/accounts")) return NextResponse.json({ error: "Accounts access required." }, { status: 403 });
  try {
    const { accountId } = await request.json();
    if (typeof accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(accountId)) return NextResponse.json({ error: "Select a valid party." }, { status: 400 });
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return NextResponse.json({ error: "Party not found." }, { status: 404 });
    await partySettlementTransaction(prisma, tx => settlePartyInvoices(tx, account.name));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Party invoice settlement failed", error);
    return NextResponse.json({ error: "Could not refresh invoice payment statuses. Please try again." }, { status: 500 });
  }
}
