import { prisma } from "@/lib/prisma";
import { MAX_ATTEMPTS, MIN_SEND_DELAY_SECONDS, retryDelaySeconds, isWhatsAppRecipientBlocked } from "@/lib/whatsappPolicy";

export type WhatsAppTransport = {
  senderId: string;
  isReady(): boolean;
  resolveNumber(phone: string): Promise<string | null>;
  sendText(chatId: string, body: string): Promise<string>;
};

/** The Baileys worker owns delivery; the web application only writes the outbox. */
export async function processWhatsAppQueue(transport: WhatsAppTransport, owner: string) {
  if (!transport.isReady()) return { processed: false };
  const claimed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
    const settings = await tx.whatsAppSettings.findUnique({ where: { id: 1 } });
    const now = new Date();
    if (!settings || settings.worker_owner !== owner || !settings.worker_lease_until || settings.worker_lease_until <= now) return null;
    await tx.whatsAppMessage.updateMany({ where: { status: "processing", processing_at: { lt: new Date(now.getTime() - 300000) } },
      data: { status: "unknown", reason: "Worker stopped during delivery. Check the linked WhatsApp chat before sending manually." } });
    if (!settings.enabled || !settings.connection_requested || settings.connection_state !== "ready"
      || settings.phone_number_id !== transport.senderId || settings.next_send_at > now
      || await tx.whatsAppMessage.count({ where: { status: "processing" } })) return null;
    const job = await tx.whatsAppMessage.findFirst({ where: { status: "queued", available_at: { lte: now } }, orderBy: [{ created_at: "asc" }, { id: "asc" }] });
    if (!job) return null;
    const contact = await tx.whatsAppContact.findUnique({ where: { phone: job.phone } });
    const eventEnabled = job.kind === "invoice" ? settings.invoice_enabled : job.kind === "payment_received" ? settings.received_enabled : settings.supplier_enabled;
    const sourceExists = job.kind === "invoice" ? await tx.invoice.count({ where: { id: job.source_id } }) : await tx.cashbook.count({ where: { id: job.source_id } });
    const reason = job.phone_number_id !== settings.phone_number_id ? "Linked account changed" : !eventEnabled ? "This automation is paused"
      : !sourceExists ? "Source transaction was deleted" : isWhatsAppRecipientBlocked(contact) ? "Recipient opted out"
        : now.getTime() - job.created_at.getTime() > 7 * 86400000 ? "Message is older than seven days; review and send manually" : "";
    if (reason) {
      await tx.whatsAppMessage.update({ where: { id: job.id }, data: { status: "blocked", reason } });
      return null;
    }
    await tx.whatsAppMessage.update({ where: { id: job.id }, data: { status: "processing", processing_at: now, attempts: { increment: 1 } } });
    await tx.whatsAppSettings.update({ where: { id: 1 }, data: { next_send_at: new Date(now.getTime() + 60000) } });
    return { job, settings };
  });
  if (!claimed) return { processed: false };
  const { job, settings } = claimed;
  const update = (status: string, reason: string, extra = {}) => prisma.whatsAppMessage.updateMany({ where: { id: job.id, status: "processing" }, data: { status, reason, ...extra } });
  let submitted = false;
  let backoffUntil: Date | null = null;
  try {
    if (job.body.length > 65536) {
      await update("blocked", "Message is too long. Use the manual WhatsApp button.");
      return { processed: true };
    }
    const chatId = await transport.resolveNumber(job.phone);
    if (!chatId) {
      await update("blocked", "Recipient number is not registered on WhatsApp");
      return { processed: true };
    }
    const [current, recipient] = await Promise.all([
      prisma.whatsAppSettings.findUnique({ where: { id: 1 } }), prisma.whatsAppContact.findUnique({ where: { phone: job.phone } }),
    ]);
    const stillEnabled = job.kind === "invoice" ? current?.invoice_enabled : job.kind === "payment_received" ? current?.received_enabled : current?.supplier_enabled;
    if (!current?.enabled || !stillEnabled || !current.connection_requested || current.connection_state !== "ready"
      || current.worker_owner !== owner || !current.worker_lease_until || current.worker_lease_until <= new Date()
      || current.phone_number_id !== transport.senderId || !transport.isReady() || isWhatsAppRecipientBlocked(recipient)) {
      await update("blocked", "Sending paused, account disconnected, or recipient opted out");
      return { processed: true };
    }
    submitted = true;
    // Original message content is sent unchanged; there are no Cloud API templates.
    const id = await transport.sendText(chatId, job.body);
    if (!id) throw new Error("No message ID returned");
    await update("accepted", "Submitted by the linked Baileys; awaiting acknowledgement", { provider_id: id, sent_at: new Date() });
  } catch {
    if (!submitted && job.attempts + 1 < MAX_ATTEMPTS) {
      backoffUntil = new Date(Date.now() + retryDelaySeconds(job.attempts + 1) * 1000);
      await update("queued", "WhatsApp lookup failed before sending; retry scheduled", { available_at: backoffUntil });
    } else if (!submitted) await update("failed", "WhatsApp lookup failed repeatedly. Check the connection before sending manually.");
    else await update("unknown", "Delivery outcome is uncertain. Check WhatsApp before sending manually; automatic retry is disabled to prevent duplicates.");
  } finally {
    const next = backoffUntil ?? new Date(Date.now() + Math.max(MIN_SEND_DELAY_SECONDS, settings.delay_seconds) * 1000);
    await prisma.whatsAppSettings.updateMany({ where: { id: 1, worker_owner: owner, phone_number_id: settings.phone_number_id }, data: { next_send_at: next } });
  }
  return { processed: true };
}
