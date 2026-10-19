// Explicit local-database integration suite. All data lives in a temporary schema.
import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server.js";
import { tsLoader } from "../helpers/load-ts.mjs";

const database = new URL(process.env.DATABASE_URL || "postgresql://ssd@127.0.0.1:5432/ssd");
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) throw new Error("Integration tests require an isolated local database");
const schema = `whatsapp_test_${randomBytes(8).toString("hex")}`;
database.searchParams.set("schema", schema);
const db = new PrismaClient({ datasources: { db: { url: database.toString() } } });
const adminId = randomUUID();
const supplierId = randomUUID();
const phone = "923001234567";
const owner = "test-worker";
const sender = "923009999999@s.whatsapp.net";
let sends = [], transportError = null, lookupError = null, transportGate = null, registered = true, connected = true;
const load = tsLoader({ "@/lib/prisma": { prisma: db }, "@/lib/auth": { COOKIE_NAME: "auth", verifyToken: async token => token === "admin" ? { sub: adminId, email: "test@example.invalid", full_name: "Test" } : null } });
const { enqueueInvoice, enqueuePayment } = load("lib/whatsappOutbox.ts");
const worker = load("lib/whatsappWorker.ts");
const session = load("lib/whatsappSession.ts");
const transport = { senderId: sender, isReady: () => connected,
  resolveNumber: async phone => { if (lookupError) throw lookupError; return registered ? `${phone}@s.whatsapp.net` : null; },
  sendText: async (chatId, body) => { sends.push({ chatId, body }); if (transportGate) await transportGate; if (transportError) throw transportError; return `true_${phone}@s.whatsapp.net_${randomUUID()}`; },
};
const processWhatsAppQueue = () => worker.processWhatsAppQueue(transport, owner);
const dbRoute = load("app/api/db/route.ts");

async function invoice(extra = {}) {
  return db.invoice.create({ data: { invoice_number: `TEST-${randomUUID()}`, client_name: "Test customer", client_phone: phone,
    invoice_date: new Date("2026-10-18"), grand_total: 500, balance_due: 500, is_walk_in: true, ...extra } });
}
async function queuedInvoice() {
  const row = await invoice(); await db.$transaction(tx => enqueueInvoice(tx, row.id));
  return db.whatsAppMessage.findFirstOrThrow({ where: { source_id: row.id } });
}
async function inbound(text, timestamp = Math.floor(Date.now() / 1000)) {
  return session.recordIncoming(phone, text, timestamp, { owner, generation: 0, sender });
}

describe("WhatsApp connection outbox, session and worker against PostgreSQL", { concurrency: false }, () => {
  before(async () => {
    execFileSync("./node_modules/.bin/prisma", ["db", "push", "--skip-generate"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: database.toString() }, stdio: "pipe" });
    await db.user.create({ data: { id: adminId, email: "test@example.invalid", password_hash: "unused", role: "super_admin" } });
  });
  after(async () => { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.$disconnect(); });
  beforeEach(async () => {
    sends = []; transportError = null; lookupError = null; transportGate = null; registered = true; connected = true;
    await db.whatsAppMessage.deleteMany(); await db.whatsAppContact.deleteMany(); await db.whatsAppSettings.deleteMany();
    await db.cashbook.deleteMany(); await db.invoice.deleteMany(); await db.account.deleteMany(); await db.supplier.deleteMany();
    await db.whatsAppSettings.create({ data: { id: 1, enabled: true, phone_number_id: sender, connection_requested: true, connection_state: "ready",
      worker_owner: owner, worker_lease_until: new Date(Date.now() + 30000), delay_seconds: 15, next_send_at: new Date(0) } });
    await db.whatsAppContact.create({ data: { phone, opted_in_at: new Date(Date.now() - 86400000), consent_source: "Test fixture", last_inbound_at: new Date() } });
  });

  test("stale connection events cannot grant consent after disconnect", async () => {
    await db.whatsAppContact.update({ where: { phone }, data: { opted_in_at: null } });
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { session_generation: 1, connection_requested: false } });
    await inbound("START");
    assert.equal((await db.whatsAppContact.findUniqueOrThrow({ where: { phone } })).opted_in_at, null);
  });

  test("save_invoice creates a durable outbox record and repeat enqueue does not duplicate", async () => {
    const result = await dbRoute.POST(new NextRequest("http://localhost/api/db", { method: "POST", headers: { cookie: "auth=admin", "content-type": "application/json" }, body: JSON.stringify({ table: "invoices", operation: "save_invoice", data: {
      client_name: "Customer", client_phone: phone, invoice_date: "2026-10-18", grand_total: 500, balance_due: 500, is_walk_in: true,
    }, items: [{ category: "Service", qty: 1, rate: 500, amount: 500 }] }) }));
    const body = await result.json(); assert.equal(body.error, null);
    assert.equal(await db.whatsAppMessage.count(), 1);
    await db.$transaction(tx => enqueueInvoice(tx, body.data.id));
    assert.equal(await db.whatsAppMessage.count(), 1);
    const queued = await db.whatsAppMessage.findFirstOrThrow();
    assert.match(queued.body, /Invoice \*/); assert.match(queued.body, /Rs 500/);
  });

  test("business save rolls back its notification if the enclosing transaction fails", async () => {
    await assert.rejects(db.$transaction(async tx => {
      const row = await tx.invoice.create({ data: { invoice_number: "ROLLBACK", client_name: "Customer", client_phone: phone, invoice_date: new Date(), is_walk_in: true } });
      await enqueueInvoice(tx, row.id); throw new Error("Rollback");
    }));
    assert.equal(await db.whatsAppMessage.count(), 0);
    assert.equal(await db.invoice.count(), 0);
  });

  test("invoice edits refresh an unsent snapshot but never resend an accepted message", async () => {
    const job = await queuedInvoice();
    await db.invoice.update({ where: { id: job.source_id }, data: { grand_total: 600, balance_due: 600 } });
    await db.$transaction(tx => enqueueInvoice(tx, job.source_id, true));
    assert.match((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).body, /Total:\* Rs 600/);
    await processWhatsAppQueue();
    await db.invoice.update({ where: { id: job.source_id }, data: { grand_total: 700, balance_due: 700 } });
    await db.$transaction(tx => enqueueInvoice(tx, job.source_id, true));
    assert.equal(await db.whatsAppMessage.count(), 1);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "accepted");
    assert.equal(sends.length, 1);
  });

  test("party receipt preserves the default message and ledger-derived remaining balance", async () => {
    await db.account.create({ data: { name: "Test customer", type: "Customer", whatsapp: phone } });
    await invoice({ is_walk_in: false });
    const result = await dbRoute.POST(new NextRequest("http://localhost/api/db", { method: "POST", headers: { cookie: "auth=admin" }, body: JSON.stringify({ table: "cashbook", operation: "insert", data: {
      type: "in", description: "Payment received from Test customer — Thank you", amount: 200, date: "2026-10-18", account_name: "Test customer", method: "Cash", reference: "",
    } }) }));
    assert.equal((await result.json()).error, null);
    const job = await db.whatsAppMessage.findFirstOrThrow();
    assert.equal(job.kind, "payment_received"); assert.match(job.body, /\*Amount:\* Rs 200/);
    assert.match(job.body, /\*Remaining balance:\* Rs 300 \(amount due\)/); assert.match(job.body, /\*Note:\* Thank you/);
  });

  test("supplier payments use the supplier number and exclude ledger adjustments", async () => {
    await db.supplier.create({ data: { id: supplierId, name: "Supplier", phone, opening_balance: 700 } });
    const entry = await db.cashbook.create({ data: { type: "out", description: "Supplier payment — Supplier", amount: 200, date: new Date(), account_name: "Supplier", reference: supplierId } });
    await db.$transaction(tx => enqueuePayment(tx, entry));
    const job = await db.whatsAppMessage.findFirstOrThrow();
    assert.equal(job.kind, "supplier_payment"); assert.match(job.body, /Remaining payable:\* Rs 500/);
    await db.$transaction(tx => enqueuePayment(tx, { ...entry, id: randomUUID(), method: "Adjustment" }));
    assert.equal(await db.whatsAppMessage.count(), 1);
  });

  test("consented recipient receives exact existing text; database pacing survives worker reload", async () => {
    const job = await queuedInvoice(); await queuedInvoice();
    await processWhatsAppQueue();
    assert.equal(sends.length, 1); assert.equal(sends[0].body, job.body);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "accepted");
    await processWhatsAppQueue(); assert.equal(sends.length, 1);
    const settings = await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
    assert(settings.next_send_at.getTime() >= Date.now() + 14000);
  });

  test("concurrent workers send only one message", async () => {
    await queuedInvoice(); await queuedInvoice();
    let release; transportGate = new Promise(resolve => { release = resolve; });
    const first = processWhatsAppQueue();
    for (let index = 0; !sends.length && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sends.length, 1);
    await processWhatsAppQueue(); assert.equal(sends.length, 1);
    release(); await first;
  });

  test("connection sending preserves full text without a Cloud API service window or templates", async () => {
    await db.whatsAppContact.update({ where: { phone }, data: { last_inbound_at: null } });
    const job = await queuedInvoice();
    await processWhatsAppQueue();
    assert.equal(sends.length, 1); assert.equal(sends[0].body, job.body);
  });

  test("consent withdrawal blocks a previously queued receipt", async () => {
    const job = await queuedInvoice();
    await db.whatsAppContact.update({ where: { phone }, data: { opted_out_at: new Date() } });
    await processWhatsAppQueue(); assert.equal(sends.length, 0);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "blocked");
  });

  test("failed lookups back off; ambiguous send timeouts never automatically retry", async () => {
    const job = await queuedInvoice(); lookupError = new Error("Browser lookup failed");
    await processWhatsAppQueue();
    const retry = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(retry.status, "queued"); assert.equal(retry.attempts, 1); assert(retry.available_at.getTime() > Date.now() + 59000);
    lookupError = null; transportError = new Error("timeout");
    await db.whatsAppMessage.update({ where: { id: job.id }, data: { available_at: new Date(0) } });
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { next_send_at: new Date(0) } });
    await processWhatsAppQueue();
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "unknown");
    await processWhatsAppQueue(); assert.equal(sends.length, 1);
  });

  test("STOP cancels queued work; ordinary inbound does not grant consent; stale STOP cannot undo START", async () => {
    const job = await queuedInvoice();
    const time = Math.floor(Date.now() / 1000);
    await inbound("STOP", time - 2);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "cancelled");
    await inbound("Hello", time - 1);
    assert((await db.whatsAppContact.findUniqueOrThrow({ where: { phone } })).opted_out_at);
    await inbound("START", time);
    await inbound("STOP", time - 2);
    assert.equal((await db.whatsAppContact.findUniqueOrThrow({ where: { phone } })).opted_out_at, null);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "cancelled");
  });

  test("unauthenticated and cross-origin settings requests are rejected", async () => {
    const settingsRoute = load("app/api/whatsapp/settings/route.ts");
    assert.equal((await settingsRoute.GET(new NextRequest("http://localhost/api/whatsapp/settings"))).status, 403);
    assert.equal((await settingsRoute.PATCH(new NextRequest("http://localhost/api/whatsapp/settings", { method: "PATCH", headers: { cookie: "auth=admin", origin: "https://evil.example" }, body: "{}" }))).status, 403);
  });

  test("an administrator can connect and save settings through the HTTPS Nginx proxy", async () => {
    const headers = { cookie: "auth=admin", origin: "https://ssd.addsmint.com", host: "ssd.addsmint.com", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" };
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { connection_state: "disconnected", connection_requested: false } });
    const response = await load("app/api/whatsapp/connect/route.ts").POST(new NextRequest("http://localhost:3000/api/whatsapp/connect", { method: "POST", headers }));
    assert.equal(response.status, 200);
    assert.equal((await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } })).connection_state, "starting");
    const saved = await load("app/api/whatsapp/settings/route.ts").PATCH(new NextRequest("http://localhost:3000/api/whatsapp/settings", {
      method: "PATCH", headers, body: JSON.stringify({ enabled: false, invoice: true, received: true, supplier: true, delaySeconds: 20 }),
    }));
    assert.equal(saved.status, 200);
    assert.equal((await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } })).delay_seconds, 20);
  });

  test("proxy origin validation rejects foreign origins and forged forwarded hosts", async () => {
    const route = load("app/api/whatsapp/connect/route.ts");
    const headers = { cookie: "auth=admin", host: "ssd.addsmint.com", "x-forwarded-proto": "https" };
    for (const extra of [
      { origin: "https://evil.example" },
      { origin: "https://evil.example", "x-forwarded-host": "evil.example" },
      { origin: "https://ssd.addsmint.com", "sec-fetch-site": "cross-site" },
      { origin: "http://ssd.addsmint.com" },
      { origin: "https://ssd.addsmint.com:444" },
      { origin: "https://ssd.addsmint.com", "x-forwarded-proto": "https,http" },
      { origin: "https://ssd.addsmint.com", host: "ssd.addsmint.com/evil" },
    ]) {
      const response = await route.POST(new NextRequest("http://localhost:3000/api/whatsapp/connect", { method: "POST", headers: { ...headers, ...extra } }));
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /origin/);
    }
    assert.equal((await route.POST(new NextRequest("http://localhost:3000/api/whatsapp/connect", { method: "POST", headers: { ...headers, origin: "https://ssd.addsmint.com", "x-forwarded-host": "ignored.example" } }))).status, 200);
  });

  test("proxy support does not grant administrator rights to sub-users or inactive accounts", async () => {
    const route = load("app/api/whatsapp/connect/route.ts");
    const headers = { cookie: "auth=admin", origin: "https://ssd.addsmint.com", host: "ssd.addsmint.com", "x-forwarded-proto": "https" };
    try {
      for (const data of [{ role: "sub_user", is_active: true }, { role: "super_admin", is_active: false }]) {
        await db.user.update({ where: { id: adminId }, data });
        const response = await route.POST(new NextRequest("http://localhost:3000/api/whatsapp/connect", { method: "POST", headers }));
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /Administrator/);
      }
    } finally { await db.user.update({ where: { id: adminId }, data: { role: "super_admin", is_active: true } }); }
  });

  test("connection acknowledgements do not regress read to sent or failed", async () => {
    const job = await queuedInvoice(); await processWhatsAppQueue();
    const accepted = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } });
    for (const ack of [3, 1, -1]) await session.recordAcknowledgement(sender, accepted.provider_id, ack);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "read");
  });

  test("an unregistered destination is held without submitting a message", async () => {
    const job = await queuedInvoice(); registered = false;
    await processWhatsAppQueue(); assert.equal(sends.length, 0);
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: job.id } })).status, "blocked");
  });

  test("a disconnected connection and a worker without the lease cannot send", async () => {
    await queuedInvoice(); connected = false;
    await processWhatsAppQueue(); assert.equal(sends.length, 0);
    connected = true;
    await worker.processWhatsAppQueue(transport, "other-worker"); assert.equal(sends.length, 0);
    assert.equal(await session.acquireWhatsAppLease("other-worker"), false);
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { worker_lease_until: new Date(0) } });
    assert.equal(await session.acquireWhatsAppLease("other-worker"), true);
    assert.equal(await session.renewWhatsAppLease(owner), false);
    await processWhatsAppQueue(); assert.equal(sends.length, 0);
  });

  test("old connection generations cannot publish QR codes or change linked numbers", async () => {
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { session_generation: 2 } });
    await session.updateConnectionState(owner, 1, { connection_state: "qr", qr_data: "stale" });
    assert.equal((await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } })).qr_data, "");
    assert.equal(await session.recordConnectionReady(owner, 1, "different@s.whatsapp.net"), false);
    await queuedInvoice();
    assert.equal(await session.recordConnectionReady(owner, 2, "923001111111@s.whatsapp.net"), true);
    assert.equal((await db.whatsAppMessage.findFirstOrThrow()).status, "cancelled");
    assert.equal((await db.whatsAppContact.findUniqueOrThrow({ where: { phone } })).opted_in_at, null);
  });

  test("expired QR codes are not exposed and disconnect clears pending work", async () => {
    const settingsRoute = load("app/api/whatsapp/settings/route.ts");
    await db.whatsAppSettings.update({ where: { id: 1 }, data: { connection_state: "qr", qr_data: "expired", qr_expires_at: new Date(0) } });
    const req = new NextRequest("http://localhost/api/whatsapp/settings", { headers: { cookie: "auth=admin" } });
    const response = await settingsRoute.GET(req);
    assert.equal((await response.json()).connection.qr, "");
    assert.match(response.headers.get("cache-control"), /no-store/);
    await queuedInvoice();
    await settingsRoute.DELETE(new NextRequest("http://localhost/api/whatsapp/settings", { method: "DELETE", headers: { cookie: "auth=admin" } }));
    const row = await db.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(row.connection_requested, false); assert.equal(row.logout_requested, true); assert.equal(row.enabled, false);
    assert.equal((await db.whatsAppMessage.findFirstOrThrow()).status, "cancelled");
  });
});
