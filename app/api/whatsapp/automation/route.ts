import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { whatsappUser } from "@/lib/whatsappApi";

export async function GET(req: NextRequest) {
  if (!await whatsappUser(req, false)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await prisma.whatsAppSettings.findUnique({ where: { id: 1 } });
  return NextResponse.json({ payment_received: !!settings?.enabled && settings.received_enabled,
    supplier_payment: !!settings?.enabled && settings.supplier_enabled });
}
