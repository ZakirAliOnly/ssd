import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server.js";
import { tsLoader } from "../helpers/load-ts.mjs";

test("Return Report snapshots survive PostgreSQL retries, later sales, reversals and repeated migrations", async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Integration tests require local PostgreSQL");
  const schema = `return_report_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let initialized = false;
  const require = createRequire(import.meta.url);
  const cli = (...args) => execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), ...args], {
    env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe",
  });
  const migrate = () => cli("db", "execute", "--file", "scripts/migration-v42-return-report.sql", "--schema", "prisma/schema.prisma");
  try {
    cli("db", "push", "--skip-generate");
    initialized = true;
    await db.$executeRawUnsafe("ALTER TABLE invoice_return_items DROP COLUMN invoice_before_qty, DROP COLUMN invoice_after_qty, DROP COLUMN stock_before_qty, DROP COLUMN stock_after_qty, DROP COLUMN stock_unit");
    migrate(); migrate();
    const actor = await db.user.create({ data: { email: "return-report@example.invalid", password_hash: "unused", role: "super_admin" } });
    const load = tsLoader({ "@/lib/prisma": { prisma: db }, "@/lib/auth": { COOKIE_NAME: "auth", verifyToken: async () => ({ sub: actor.id, email: actor.email, full_name: "Test" }) } });
    const route = load("app/api/db/route.ts"), returns = load("app/api/returns/route.ts"), report = load("app/api/reports/returns/route.ts"), reverse = load("app/api/returns/reverse/route.ts");
    const call = async (module, path, body) => {
      const response = await module[body ? "POST" : "GET"](new NextRequest(`http://localhost${path}`, {
        method: body ? "POST" : "GET", headers: { cookie: "auth=test", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.ok(!result.error, JSON.stringify(result));
      return result;
    };
    const product = await db.product.create({ data: { name: "Four-vial kit", code: "R1", quantity: 20, cost_price: 5, sale_price: 25,
      packaging_enabled: true, base_unit: "Vial", pieces_per_packet: 4, packets_per_box: 1 } });
    await db.stockBatch.create({ data: { product_id: product.id, received_qty: 20, remaining_qty: 20, received_date: new Date("2026-01-01") } });
    const sale = async qty => (await call(route, "/api/db", { table: "invoices", operation: "save_invoice",
      data: { client_name: "Report customer", is_walk_in: true, invoice_date: "2026-10-01", grand_total: qty * 100 },
      items: [{ product_id: product.id, category: product.name, unit: "packet", qty, rate: 100, amount: qty * 100 }] })).data;
    const invoice = await sale(2);
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoice_id: invoice.id } });
    const input = { invoiceId: invoice.id, requestId: randomUUID(), date: "2026-10-02", reason: "Test return", selections: [{ invoice_item_id: item.id, qty: 0.5 }] };
    const first = (await call(returns, "/api/returns", input)).record;
    const snapshots = await db.invoiceReturnItem.findMany();
    assert.equal((await call(returns, "/api/returns", input)).record.id, first.id);
    assert.deepEqual(await db.invoiceReturnItem.findMany(), snapshots);
    await sale(1);
    const result = await call(report, "/api/reports/returns?from=2026-10-02&to=2026-10-02&q=Report%20customer");
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.equal(row.invoiceNumber, invoice.invoice_number);
    assert.equal(row.invoiceBefore, 2); assert.equal(row.invoiceAfter, 1.5);
    assert.equal(row.stockBefore, 12); assert.equal(row.stockAfter, 14); assert.equal(row.stockUnit, "Vial");
    assert.equal(Number((await db.product.findUniqueOrThrow({ where: { id: product.id } })).quantity), 10);
    await call(reverse, "/api/returns/reverse", { id: first.id, type: "sales", reason: "Wrong invoice", refundReviewed: true, lateConfirmation: "REVERSE" });
    const after = await call(report, "/api/reports/returns?from=2026-10-01&to=2026-10-31");
    assert.ok(after.rows[0].reversedAt);
    assert.equal(after.rows[0].stockAfter, 14);
    migrate();
    assert.deepEqual(await db.invoiceReturnItem.findMany(), snapshots);
    await db.user.update({ where: { id: actor.id }, data: { role: "sub_user", modules: ["returns"] } });
    const denied = await report.GET(new NextRequest("http://localhost/api/reports/returns?from=2026-10-01&to=2026-10-31", { headers: { cookie: "auth=test" } }));
    assert.equal(denied.status, 403);
  } finally {
    if (initialized) await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
});
