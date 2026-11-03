import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { returnAdmin } from "@/lib/returnAdmin";
import { lockInventoryUnits } from "@/lib/inventoryUnits";
import { businessDate } from "@/lib/returnPeriod";
import { partySettlementTransaction } from "@/lib/partyInvoiceSettlement";

export async function GET(request: NextRequest) {
  if (!await returnAdmin(request)) return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
  try {
    const period = await prisma.returnPeriodLock.findUnique({ where: { id: 1 } });
    return NextResponse.json({ closedThrough: period?.closed_through?.toISOString().slice(0, 10) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Return accounting lock needs its database upgrade." }, { status: 503 });
  }
}
export async function PATCH(request: NextRequest) {
  const actor = await returnAdmin(request);
  if (!actor) return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
  try {
    const body = await request.json();
    const date = body?.closedThrough;
    if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > businessDate())
        || typeof body?.reason !== "string" || !body.reason.trim() || body.reason.length > 1000) {
      return NextResponse.json({ error: "Select a cutoff no later than today (or reopen), and enter a reason." }, { status: 400 });
    }
    await partySettlementTransaction(prisma, async tx => {
      await lockInventoryUnits(tx);
      const before = await tx.returnPeriodLock.findUnique({ where: { id: 1 } });
      await tx.returnPeriodLock.upsert({ where: { id: 1 }, create: { id: 1, closed_through: date ? new Date(date) : null }, update: { closed_through: date ? new Date(date) : null } });
      await tx.activityLog.create({ data: { action: "update", entity_type: "return_period", title: "Return period cutoff changed", subtitle: body.reason.trim(), user_email: actor.email, user_name: actor.name,
        metadata: JSON.stringify({ before: before?.closed_through ?? null, closedThrough: date }) } });
    });
    return NextResponse.json({ closedThrough: date });
  } catch (error) {
    console.error("Return period update failed", error);
    return NextResponse.json({ error: "Could not update the return cutoff. No change was confirmed; reload before retrying." }, { status: 500 });
  }
}
