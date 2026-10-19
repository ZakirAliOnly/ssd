import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbiddenWhatsApp, whatsappUser, whatsAppError } from "@/lib/whatsappApi";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPolicy";

export async function POST(req: NextRequest) {
  const user = await whatsappUser(req);
  if (!user) return forbiddenWhatsApp(req);
  const { phone: raw, name, optedIn, source = "" } = await req.json();
  const phone = typeof raw === "string" ? normalizeWhatsAppPhone(raw) : null;
  if (!phone || typeof name !== "string" || name.length > 150 || typeof optedIn !== "boolean"
    || typeof source !== "string" || source.length > 500) {
    return whatsAppError("Enter a valid number and choose whether transaction messages are allowed.");
  }
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
    const data = { name, opted_in_at: optedIn ? new Date() : null, opted_out_at: optedIn ? null : new Date(), consent_source: `${user.email}: ${source.trim() || (optedIn ? "Transaction messages allowed" : "Recipient opted out")}` };
    await tx.whatsAppContact.upsert({ where: { phone }, create: { phone, ...data }, update: data });
    if (!optedIn) await tx.whatsAppMessage.updateMany({ where: { phone, status: { in: ["queued", "blocked"] } }, data: { status: "cancelled", reason: "Recipient opted out" } });
  });
  return NextResponse.json({ ok: true });
}
