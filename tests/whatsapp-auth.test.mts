import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { authEncryptionKey, createBaileysAuth, encryptAuth, decryptAuth } from "../lib/whatsappBaileysAuth.mjs";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://ssd@127.0.0.1:5432/ssd");
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) throw new Error("Auth tests require local PostgreSQL");
const schema = `baileys_auth_test_${randomBytes(8).toString("hex")}`;
database.searchParams.set("schema", schema);
const db = new PrismaClient({ datasources: { db: { url: database.toString() } } });
const key = randomBytes(32);
const owner = "auth-test-worker";

describe("Baileys encrypted PostgreSQL auth", () => {
  before(async () => {
    execFileSync("./node_modules/.bin/prisma", ["db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: database.toString() }, stdio: "pipe" });
  });
  after(async () => { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.$disconnect(); });
  beforeEach(async () => {
    await db.whatsAppAuth.deleteMany(); await db.whatsAppSettings.deleteMany();
    await db.whatsAppSettings.create({ data: { id: 1, worker_owner: owner, worker_lease_until: new Date(Date.now() + 60000), connection_requested: true } });
  });
  test("requires a full encryption key and preserves binary keys without plaintext", () => {
    assert.throws(() => authEncryptionKey("short"));
    const value = { secret: Buffer.from("fixture-secret") };
    const encrypted = encryptAuth("session:key", value, key);
    assert.ok(!encrypted.includes("fixture-secret"));
    assert.deepEqual(decryptAuth("session:key", encrypted, key), value);
    assert.throws(() => decryptAuth("other:key", encrypted, key));
    assert.throws(() => decryptAuth("session:key", encrypted, randomBytes(32)));
  });
  test("credentials and batched Signal keys survive a fresh auth-store instance", async () => {
    const first = await createBaileysAuth(db, owner, 0, key);
    first.state.creds.registered = true;
    await first.saveCreds();
    await first.state.keys.set({ session: { recipient: Buffer.from("fixture-session") }, "pre-key": { "12": { public: Buffer.from("public"), private: Buffer.from("private") } } });
    const second = await createBaileysAuth(db, owner, 0, key);
    assert.equal(second.state.creds.registered, true);
    assert.deepEqual(second.state.creds.noiseKey, first.state.creds.noiseKey);
    assert.deepEqual(await second.state.keys.get("session", ["recipient"]), { recipient: Buffer.from("fixture-session") });
    await second.state.keys.set({ session: { recipient: null } });
    assert.deepEqual(await second.state.keys.get("session", ["recipient"]), {});
    const rows = await db.whatsAppAuth.findMany();
    assert.ok(rows.every(row => !row.value_encrypted.includes("fixture")));
  });
  test("app-state sync keys restore to protobuf objects", async () => {
    const auth = await createBaileysAuth(db, owner, 0, key);
    await auth.state.keys.set({ "app-state-sync-key": { "1": { keyData: Buffer.from("app-state"), timestamp: 1 } } });
    const restored = await auth.state.keys.get("app-state-sync-key", ["1"]);
    assert.deepEqual(Buffer.from(restored["1"].keyData!), Buffer.from("app-state"));
  });
  test("stale generations and expired owners cannot overwrite session credentials", async () => {
    const auth = await createBaileysAuth(db, owner, 0, key);
    const original = await db.whatsAppAuth.findUniqueOrThrow({ where: { id: "creds" } });
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { session_generation: 1 } });
    await assert.rejects(auth.saveCreds(), /ownership changed/);
    assert.equal((await db.whatsAppAuth.findUniqueOrThrow({ where: { id: "creds" } })).value_encrypted, original.value_encrypted);
    await assert.rejects(createBaileysAuth(db, "old-owner", 1, key), /ownership changed/);
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { worker_lease_until: new Date(0) } });
    await assert.rejects(createBaileysAuth(db, owner, 1, key), /ownership changed/);
  });
  test("transport migration pauses the old session once and preserves Baileys credentials on rerun", async () => {
    const migrate = () => execFileSync("./node_modules/.bin/prisma", ["db", "execute", "--file", "scripts/migration-v38-whatsapp-baileys.sql", "--schema", "prisma/schema.prisma"], {
      env: { ...process.env, DATABASE_URL: database.toString() }, stdio: "pipe",
    });
    migrate();
    let settings = await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(settings.connection_requested, false);
    assert.equal(settings.enabled, false);
    await db.whatsAppSettings.update({ where: { id: 1 }, data: {
      worker_owner: owner, worker_lease_until: new Date(Date.now() + 60000), session_generation: 3, connection_requested: true,
    } });
    await createBaileysAuth(db, owner, 3, key);
    const original = await db.whatsAppAuth.findUniqueOrThrow({ where: { id: "creds" } });
    migrate();
    settings = await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(settings.session_generation, 3);
    assert.equal(settings.connection_requested, true);
    assert.equal((await db.whatsAppAuth.findUniqueOrThrow({ where: { id: "creds" } })).value_encrypted, original.value_encrypted);
  });
  test("corrupt or wrong-key credentials fail closed instead of creating a replacement identity", async () => {
    await createBaileysAuth(db, owner, 0, key);
    await assert.rejects(createBaileysAuth(db, owner, 0, randomBytes(32)));
    await db.whatsAppAuth.update({ where: { id: "creds" }, data: { value_encrypted: "corrupted" } });
    await assert.rejects(createBaileysAuth(db, owner, 0, key));
  });
});
