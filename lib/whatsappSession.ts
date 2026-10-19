import { prisma } from "@/lib/prisma";
import { consentKeyword, normalizeWhatsAppPhone } from "@/lib/whatsappPolicy";

export const LEASE_MS = 30000;
export async function acquireWhatsAppLease(owner: string) {
  await prisma.whatsAppSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const now = new Date();
  const result = await prisma.whatsAppSettings.updateMany({ where: { id: 1,
    OR: [{ worker_owner: "" }, { worker_lease_until: null }, { worker_lease_until: { lt: now } }] },
    data: { worker_owner: owner, worker_lease_until: new Date(now.getTime() + LEASE_MS), worker_seen_at: now, connection_state: "disconnected", qr_data: "", qr_expires_at: null } });
  return result.count === 1;
}

export async function renewWhatsAppLease(owner: string) {
  const now = new Date();
  const result = await prisma.whatsAppSettings.updateMany({ where: { id: 1, worker_owner: owner, worker_lease_until: { gt: now } },
    data: { worker_lease_until: new Date(now.getTime() + LEASE_MS), worker_seen_at: now } });
  return result.count === 1;
}

/** Only the current connection generation can publish QR codes or connection state. */
export async function updateConnectionState(owner: string, generation: number, data: {
  connection_state?: string; connection_error?: string; qr_data?: string; qr_expires_at?: Date | null;
}) {
  return prisma.whatsAppSettings.updateMany({ where: { id: 1, worker_owner: owner, session_generation: generation,
    connection_requested: true, worker_lease_until: { gt: new Date() } }, data });
}

export async function recordConnectionReady(owner: string, generation: number, sender: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
    const settings = await tx.whatsAppSettings.findUnique({ where: { id: 1 } });
    if (!settings || settings.worker_owner !== owner || settings.session_generation !== generation || !settings.connection_requested
      || !settings.worker_lease_until || settings.worker_lease_until <= new Date()) return false;
    if (settings.phone_number_id && settings.phone_number_id !== sender) {
      await tx.whatsAppMessage.updateMany({ where: { status: { in: ["queued", "blocked"] } }, data: { status: "cancelled", reason: "Linked WhatsApp account changed" } });
      await tx.whatsAppContact.updateMany({ data: { opted_in_at: null, opted_out_at: new Date(), consent_source: "Linked account changed", last_inbound_at: null } });
    }
    await tx.whatsAppSettings.update({ where: { id: 1 }, data: { connection_state: "ready", connection_error: "", qr_data: "", qr_expires_at: null,
      phone_number_id: sender, display_phone: sender.split("@")[0].split(":")[0], connected_at: new Date(),
      ...(settings.phone_number_id !== sender ? { enabled: false } : {}), token_encrypted: "", waba_id: "" } });
    return true;
  });
}

export async function recordIncoming(phoneRaw: string, text: string, timestamp: number, session: { owner: string; generation: number; sender: string }) {
  const phone = normalizeWhatsAppPhone(phoneRaw);
  const date = new Date(timestamp * 1000);
  if (!phone || !Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 60000) return;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
    const settings = await tx.whatsAppSettings.findUnique({ where: { id: 1 } });
    if (!settings || settings.worker_owner !== session.owner || settings.session_generation !== session.generation
      || settings.phone_number_id !== session.sender || !settings.connection_requested || settings.connection_state !== "ready"
      || !settings.worker_lease_until || settings.worker_lease_until <= new Date()) return;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))::text`;
    const contact = await tx.whatsAppContact.findUnique({ where: { phone } });
    const keyword = consentKeyword(text);
    const lastConsent = Math.max(contact?.opted_in_at?.getTime() ?? 0, contact?.opted_out_at?.getTime() ?? 0);
    const consent = date.getTime() > lastConsent && keyword ? keyword === "stop"
      ? { opted_in_at: null, opted_out_at: date, consent_source: "Recipient sent STOP" }
      : { opted_in_at: date, opted_out_at: null, consent_source: "Recipient sent START" } : {};
    const lastInbound = contact?.last_inbound_at && contact.last_inbound_at > date ? contact.last_inbound_at : date;
    await tx.whatsAppContact.upsert({ where: { phone }, create: { phone, last_inbound_at: lastInbound, ...consent }, update: { last_inbound_at: lastInbound, ...consent } });
    if (consent.opted_out_at) await tx.whatsAppMessage.updateMany({ where: { phone, status: { in: ["queued", "blocked"] } }, data: { status: "cancelled", reason: "Recipient opted out" } });
  });
}

export async function recordAcknowledgement(sender: string, id: string, ack: number) {
  const statuses: Record<number, { status: string; previous: string[] }> = {
    [-1]: { status: "failed", previous: ["accepted", "sent"] },
    1: { status: "sent", previous: ["accepted"] },
    2: { status: "delivered", previous: ["accepted", "sent"] },
    3: { status: "read", previous: ["accepted", "sent", "delivered"] },
    4: { status: "read", previous: ["accepted", "sent", "delivered"] },
  };
  const next = statuses[ack];
  if (!next) return;
  await prisma.whatsAppMessage.updateMany({ where: { provider_id: id, phone_number_id: sender, status: { in: next.previous } },
    data: { status: next.status, reason: ack === -1 ? "WhatsApp reported a delivery failure" : "" } });
}
