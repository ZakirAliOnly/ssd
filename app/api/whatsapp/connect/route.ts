import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbiddenWhatsApp, whatsappUser, whatsAppError } from "@/lib/whatsappApi";

export async function POST(req: NextRequest) {
  if (!await whatsappUser(req)) return forbiddenWhatsApp(req);
  const settings = await prisma.whatsAppSettings.findUnique({ where: { id: 1 } });
  if (!settings?.worker_lease_until || settings.worker_lease_until <= new Date()) return whatsAppError("Start the WhatsApp Baileys worker on the server, then try again.", 503);
  if (settings.connection_state === "ready") return NextResponse.json({ ok: true });
  await prisma.whatsAppSettings.update({ where: { id: 1 }, data: { connection_requested: true, connection_state: "starting",
    connection_error: "", qr_data: "", qr_expires_at: null, session_generation: { increment: 1 } } });
  return NextResponse.json({ ok: true });
}
