import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { returnAdmin } from "@/lib/returnAdmin";
import { InventoryError } from "@/lib/inventory";
import { uuidPattern } from "@/lib/invoiceReturns";
import { reverseReturn } from "@/lib/returnReversal";
import { partySettlementTransaction } from "@/lib/partyInvoiceSettlement";

export async function POST(request: NextRequest) {
  try {
    const actor = await returnAdmin(request);
    if (!actor) return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
    const input = await request.json();
    if (!input || !["sales", "supplier"].includes(input.type) || !uuidPattern.test(input.id ?? "")
        || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) {
      return NextResponse.json({ error: "Select a return and enter a reason of 1–1,000 characters." }, { status: 400 });
    }
    const record = await partySettlementTransaction(prisma, tx => reverseReturn(tx, {
      id: input.id, type: input.type, reason: input.reason, refundReviewed: input.refundReviewed === true,
      lateConfirmation: typeof input.lateConfirmation === "string" ? input.lateConfirmation : undefined,
    }, actor));
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (["P2021", "P2022"].includes((error as { code?: string }).code ?? "")) return NextResponse.json({ error: "Return reversal needs its database upgrade. Ask the administrator to apply it." }, { status: 503 });
    console.error("Return reversal failed", error);
    return NextResponse.json({ error: "Could not confirm reversal. Reload history before retrying the same return." }, { status: 500 });
  }
}
