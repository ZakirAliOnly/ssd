import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbiddenWhatsApp, whatsappUser, whatsAppError } from "@/lib/whatsappApi";
import { MIN_SEND_DELAY_SECONDS } from "@/lib/whatsappPolicy";

export async function GET(req: NextRequest) {
  if (!await whatsappUser(req)) return forbiddenWhatsApp(req);
  const settings = await prisma.whatsAppSettings.findUnique({ where: { id: 1 } });
  const workerRunning = !!settings?.worker_lease_until && settings.worker_lease_until > new Date();
  const messages = await prisma.whatsAppMessage.findMany({ orderBy: { created_at: "desc" }, take: 100 });
  const contacts = await prisma.whatsAppContact.findMany({ orderBy: { updated_at: "desc" }, take: 100 });
  return NextResponse.json({ settings: settings ? { connected: workerRunning && settings.connection_state === "ready", displayPhone: settings.display_phone,
    enabled: settings.enabled, invoice: settings.invoice_enabled, received: settings.received_enabled, supplier: settings.supplier_enabled,
    delaySeconds: settings.delay_seconds, connectedAt: settings.connected_at, workerSeenAt: settings.worker_seen_at } : null,
    connection: { workerRunning, state: workerRunning ? settings?.connection_state ?? "disconnected" : "offline",
      error: settings?.connection_error ?? "", qr: workerRunning && settings?.connection_state === "qr" && settings.qr_expires_at && settings.qr_expires_at > new Date() ? settings.qr_data : "",
      qrExpiresAt: settings?.qr_expires_at }, messages, contacts }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function PATCH(req: NextRequest) {
  if (!await whatsappUser(req)) return forbiddenWhatsApp(req);
  const { enabled, invoice, received, supplier, delaySeconds } = await req.json();
  if (![enabled, invoice, received, supplier].every(value => typeof value === "boolean")
    || !Number.isInteger(delaySeconds) || delaySeconds < MIN_SEND_DELAY_SECONDS || delaySeconds > 3600) return whatsAppError("Choose your automations and a delay between 10 and 3,600 seconds.");
  const settings = await prisma.whatsAppSettings.findUnique({ where: { id: 1 } });
  if (enabled && (settings?.connection_state !== "ready" || !settings.worker_lease_until || settings.worker_lease_until <= new Date())) return whatsAppError("Scan the QR code and connect WhatsApp first.");
  await prisma.whatsAppSettings.upsert({ where: { id: 1 },
    create: { id: 1, enabled, invoice_enabled: invoice, received_enabled: received, supplier_enabled: supplier, delay_seconds: delaySeconds },
    update: { enabled, invoice_enabled: invoice, received_enabled: received, supplier_enabled: supplier, delay_seconds: delaySeconds } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!await whatsappUser(req)) return forbiddenWhatsApp(req);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
    await tx.whatsAppSettings.updateMany({ where: { id: 1 }, data: { enabled: false, connection_requested: false, logout_requested: true,
      connection_state: "disconnecting", session_generation: { increment: 1 }, qr_data: "", qr_expires_at: null,
      token_encrypted: "", waba_id: "", phone_number_id: "", display_phone: "", connected_at: null } });
    await tx.whatsAppMessage.updateMany({ where: { status: { in: ["queued", "blocked"] } }, data: { status: "cancelled", reason: "WhatsApp account disconnected" } });
    await tx.whatsAppAuth.deleteMany({ where: { id: { not: "transport:baileys" } } });
    await tx.whatsAppContact.updateMany({ data: { last_inbound_at: null, opted_in_at: null } });
  });
  return NextResponse.json({ ok: true });
}
