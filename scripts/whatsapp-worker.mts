import makeWASocket, { DisconnectReason, jidNormalizedUser, makeCacheableSignalKeyStore, normalizeMessageContent, type WASocket } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { HttpsProxyAgent } from "https-proxy-agent";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { createBaileysAuth, authEncryptionKey } from "../lib/whatsappBaileysAuth.mjs";
import { processWhatsAppQueue, type WhatsAppTransport } from "../lib/whatsappWorker";
import { acquireWhatsAppLease, renewWhatsAppLease, updateConnectionState, recordConnectionReady, recordIncoming, recordAcknowledgement } from "../lib/whatsappSession";

process.umask(0o077);
const owner = randomUUID();
const logger = pino({ level: "silent" }); // Library events can contain credentials and private messages.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let socket: WASocket | null = null;
let generation = -1;
let ready = false;
let stopping = false;
let failed = false;
let initializationStarted = 0;
let reconnectAt = 0;
let reconnectAttempts = 0;
let saveChain: Promise<unknown> = Promise.resolve();
const acknowledgements = new Map<string, number>();

async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("WhatsApp operation timed out")), ms); })]); }
  finally { clearTimeout(timer!); }
}

async function closeConnection(logout = false) {
  ready = false;
  const previous = socket;
  socket = null;
  if (previous) {
    if (logout) { try { await bounded(previous.logout(), 10000); } catch { /* Unlink from the phone if remote logout is unavailable. */ } }
    try { await bounded(previous.end(undefined), 10000); } catch { /* Already closed. */ }
  }
  await saveChain.catch(() => {});
  if (logout) await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
    const settings = await tx.whatsAppSettings.findUnique({ where: { id: 1 } });
    if (settings?.worker_owner === owner && settings.logout_requested && settings.worker_lease_until && settings.worker_lease_until > new Date()) {
      await tx.whatsAppAuth.deleteMany({ where: { id: { not: "transport:baileys" } } });
    }
  });
  acknowledgements.clear();
}

async function failSession(current: WASocket, version: number, message: string, forget = false) {
  if (socket !== current) return;
  ready = false;
  await prisma.whatsAppSettings.updateMany({ where: { id: 1, worker_owner: owner, session_generation: version }, data: {
    connection_requested: false, connection_state: "error", connection_error: message, qr_data: "", qr_expires_at: null,
    ...(forget ? { logout_requested: true, enabled: false } : {}),
  } });
}
function guarded(work: () => Promise<unknown>, current: WASocket, version: number) {
  void work().catch(async () => {
    if (socket !== current || generation !== version) return;
    try {
      const settings = await prisma.whatsAppSettings.findUnique({ where: { id: 1 } });
      // A user refresh/disconnect invalidates the old session; that is not a worker failure.
      if (settings?.worker_owner === owner && settings.worker_lease_until && settings.worker_lease_until > new Date()
        && (settings.session_generation !== version || !settings.connection_requested)) return;
    } catch { /* Stop on a genuine persistence/ownership failure. */ }
    failed = true; stopping = true; ready = false;
    console.error("WhatsApp session persistence failed; worker stopping safely");
  });
}
function rememberAck(id: string, ack: number) {
  if (acknowledgements.size >= 500) acknowledgements.delete(acknowledgements.keys().next().value!);
  acknowledgements.set(id, Math.max(acknowledgements.get(id) ?? -1, ack));
}

async function startConnection(version: number) {
  generation = version;
  initializationStarted = Date.now();
  const auth = await createBaileysAuth(prisma, owner, version);
  const proxy = process.env.WHATSAPP_PROXY_URL;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  await updateConnectionState(owner, version, { connection_state: "starting", connection_error: "", qr_data: "", qr_expires_at: null });
  const current = makeWASocket({ auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    logger, agent, fetchAgent: agent, markOnlineOnConnect: false, syncFullHistory: false,
    shouldSyncHistoryMessage: () => false, emitOwnEvents: true,
    connectTimeoutMs: 30000, defaultQueryTimeoutMs: 15000,
    getMessage: async () => undefined });
  socket = current;
  ready = false;
  current.ev.on("creds.update", () => {
    if (socket !== current) return;
    const save = saveChain.then(() => auth.saveCreds());
    saveChain = save;
    guarded(() => save, current, version);
  });
  current.ev.on("connection.update", update => guarded(async () => {
    if (socket !== current) return;
    if (update.qr) {
      const image = await QRCode.toDataURL(update.qr, { width: 280, margin: 2, errorCorrectionLevel: "M" });
      await updateConnectionState(owner, version, { connection_state: "qr", qr_data: image, qr_expires_at: new Date(Date.now() + 45000), connection_error: "" });
    }
    if (update.connection === "open") {
      const sender = current.user?.id ? jidNormalizedUser(current.user.id) : "";
      if (!sender.endsWith("@s.whatsapp.net")) return failSession(current, version, "Could not identify the linked number. Disconnect and scan again.", true);
      await saveChain;
      const accepted = await recordConnectionReady(owner, version, sender);
      if (socket !== current) return;
      ready = accepted;
      if (!accepted) await closeConnection();
      else { reconnectAttempts = 0; console.log("WhatsApp Baileys connected"); }
    }
    if (update.connection === "close") {
      ready = false;
      const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession || code === DisconnectReason.multideviceMismatch) {
        await failSession(current, version, "WhatsApp session expired or was revoked. Reconnect and scan a new QR code.", true);
      } else if (code === DisconnectReason.connectionReplaced || reconnectAttempts >= 5) {
        await failSession(current, version, "WhatsApp disconnected. Check Linked devices and reconnect from this page.");
      } else {
        reconnectAttempts++;
        reconnectAt = Date.now() + (code === DisconnectReason.restartRequired ? 1000 : Math.min(60000, 2000 * 2 ** (reconnectAttempts - 1)));
        await updateConnectionState(owner, version, { connection_state: "reconnecting", qr_data: "", qr_expires_at: null });
        if (socket === current) await closeConnection();
      }
    }
  }, current, version));
  current.ev.on("messages.upsert", ({ messages, type }) => guarded(async () => {
    if (socket !== current || !ready || type !== "notify") return;
    for (const message of messages) {
      if (message.key.fromMe) continue;
      let jid = message.key.remoteJid ?? "";
      if (jid.endsWith("@lid")) jid = message.key.remoteJidAlt ?? await current.signalRepository.lidMapping.getPNForLID(jid) ?? "";
      if (!jid.endsWith("@s.whatsapp.net")) continue; // Never treat groups, broadcasts or unknown LIDs as a phone number.
      const content = normalizeMessageContent(message.message);
      const text = content?.conversation ?? content?.extendedTextMessage?.text ?? "";
      if (socket !== current || !ready) return;
      await recordIncoming(jidNormalizedUser(jid).split("@")[0], text, Number(message.messageTimestamp),
        { owner, generation: version, sender: jidNormalizedUser(current.user!.id) });
    }
  }, current, version));
  current.ev.on("messages.update", updates => {
    if (socket !== current) return;
    for (const { key, update } of updates) if (key.fromMe && key.id && update.status != null) {
      // Baileys statuses: ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5.
      if (update.status !== 1) rememberAck(key.id, update.status === 0 ? -1 : update.status - 1);
    }
  });
  current.ev.on("message-receipt.update", updates => {
    if (socket !== current) return;
    for (const { key, receipt } of updates) if (key.fromMe && key.id) {
      if (receipt.readTimestamp || receipt.playedTimestamp) rememberAck(key.id, 3);
      else if (receipt.receiptTimestamp) rememberAck(key.id, 2);
    }
  });
}

async function main() {
  authEncryptionKey(); // Fail before acquiring ownership if the persistent encryption key is missing.
  if (!await acquireWhatsAppLease(owner)) throw new Error("Another WhatsApp worker owns this installation");
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing || stopping) return;
    renewing = true;
    void renewWhatsAppLease(owner).then(ok => { if (!ok) { failed = true; stopping = true; void closeConnection(); } })
      .catch(() => { failed = true; stopping = true; void closeConnection(); }).finally(() => { renewing = false; });
  }, 5000);
  console.log("WhatsApp Baileys worker running; connect from WhatsApp Setup");
  try {
    while (!stopping) {
      const settings = await prisma.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
      if (settings.worker_owner !== owner || !settings.worker_lease_until || settings.worker_lease_until <= new Date()) throw new Error("Worker lease lost");
      if (settings.logout_requested) {
        await closeConnection(true);
        await prisma.whatsAppSettings.updateMany({ where: { id: 1, worker_owner: owner, session_generation: settings.session_generation },
          data: { logout_requested: false, connection_state: "disconnected", qr_data: "", qr_expires_at: null } });
      } else if (!settings.connection_requested) {
        if (socket) await closeConnection();
        reconnectAttempts = 0;
      } else if (generation !== settings.session_generation || !socket && Date.now() >= reconnectAt) {
        if (generation !== settings.session_generation) { reconnectAttempts = 0; reconnectAt = 0; }
        await closeConnection();
        await startConnection(settings.session_generation);
      } else if (socket && !ready && Date.now() - initializationStarted > 300000) {
        await failSession(socket, generation, "Connection timed out. Reconnect to generate a new QR code.");
      } else if (socket && ready) {
        const current = socket;
        const senderId = jidNormalizedUser(current.user!.id);
        const transport: WhatsAppTransport = { senderId, isReady: () => ready && socket === current && !stopping,
          resolveNumber: async phone => { const result = await bounded(current.onWhatsApp(phone), 15000); return result?.find(row => row.exists)?.jid ?? null; },
          sendText: async (chatId, body) => {
            try {
              const message = await bounded(current.sendMessage(chatId, { text: body }), 30000);
              if (!message?.key.id) throw new Error("No message identifier returned");
              return message.key.id;
            } catch (error) {
              await failSession(current, generation, "Sending was interrupted. Check WhatsApp and reconnect before continuing.");
              await closeConnection();
              throw error;
            }
          } };
        await processWhatsAppQueue(transport, owner);
        for (const [id, ack] of acknowledgements) {
          await recordAcknowledgement(senderId, id, ack);
          if (acknowledgements.get(id) === ack) acknowledgements.delete(id);
        }
      }
      await sleep(1000);
    }
  } finally {
    clearInterval(heartbeat);
    await closeConnection();
    await prisma.whatsAppSettings.updateMany({ where: { id: 1, worker_owner: owner }, data: {
      worker_owner: "", worker_lease_until: null, connection_state: "disconnected", qr_data: "", qr_expires_at: null,
    } });
    await prisma.$disconnect();
  }
  if (failed) throw new Error("WhatsApp session ownership or persistence failed");
}
main().catch(async () => {
  console.error("WhatsApp worker stopped. Check the encryption key, database/migrations and single-worker service configuration.");
  await prisma.$disconnect(); process.exitCode = 1;
});
