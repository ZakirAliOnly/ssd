import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap, type SignalDataSet } from "@whiskeysockets/baileys";
import type { PrismaClient, Prisma } from "@prisma/client";

export function authEncryptionKey(value = process.env.WHATSAPP_AUTH_ENCRYPTION_KEY ?? "") {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Set WHATSAPP_AUTH_ENCRYPTION_KEY to 32 random bytes encoded as 64 hex characters");
  return Buffer.from(value, "hex");
}
export function encryptAuth(id: string, value: unknown, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(JSON.stringify(value, BufferJSON.replacer), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptAuth(id: string, value: string, key: Buffer) {
  const bytes = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"), BufferJSON.reviver);
}

/** Durable encrypted credentials and Signal keys; all writes are fenced by the worker lease. */
export async function createBaileysAuth(db: PrismaClient, owner: string, generation: number, key = authEncryptionKey()) {
  async function owned<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(8104701)::text`;
      const settings = await tx.whatsAppSettings.findUnique({ where: { id: 1 } });
      if (settings?.worker_owner !== owner || settings.session_generation !== generation || !settings.connection_requested
        || !settings.worker_lease_until || settings.worker_lease_until <= new Date()) throw new Error("WhatsApp session ownership changed");
      return work(tx);
    });
  }
  const saved = await owned(tx => tx.whatsAppAuth.findUnique({ where: { id: "creds" } }));
  const creds = saved ? decryptAuth("creds", saved.value_encrypted, key) : initAuthCreds();
  const state: AuthenticationState = { creds, keys: {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const rows = await owned(tx => tx.whatsAppAuth.findMany({ where: { id: { in: ids.map(id => `${type}:${id}`) } } }));
      const values: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const row of rows) {
        const id = row.id.slice(type.length + 1);
        const value = decryptAuth(row.id, row.value_encrypted, key);
        values[id] = type === "app-state-sync-key" ? proto.Message.AppStateSyncKeyData.fromObject(value) : value;
      }
      return values;
    },
    set: async (data: SignalDataSet) => {
      await owned(async tx => {
        for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries ?? {})) {
          const recordId = `${type}:${id}`;
          if (value == null) await tx.whatsAppAuth.deleteMany({ where: { id: recordId } });
          else {
            const encrypted = encryptAuth(recordId, value, key);
            await tx.whatsAppAuth.upsert({ where: { id: recordId }, create: { id: recordId, value_encrypted: encrypted }, update: { value_encrypted: encrypted } });
          }
        }
      });
    },
  } };
  async function saveCreds() {
    // Snapshot before entering the transaction: later events cannot change this write halfway through.
    const value = encryptAuth("creds", creds, key);
    await owned(tx => tx.whatsAppAuth.upsert({ where: { id: "creds" }, create: { id: "creds", value_encrypted: value }, update: { value_encrypted: value } }));
  }
  if (!saved) await saveCreds();
  return { state, saveCreds };
}
