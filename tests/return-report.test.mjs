import test from "node:test";
import assert from "node:assert/strict";
import { tsLoader } from "./helpers/load-ts.mjs";
import { invoiceQuantityBefore } from "../lib/returnReport.ts";

function setup({ signedIn = true, active = true, modules = ["reports"], records = [], error } = {}) {
  const queries = [];
  const GET = tsLoader({
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, headers: options?.headers }) } },
    "@/lib/auth": { COOKIE_NAME: "auth", verifyToken: async () => signedIn ? { sub: "user" } : null },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => ({ role: "sub_user", modules, is_active: active }) },
      invoiceReturn: { findMany: async args => { queries.push(args); if (error) throw error; return records; } },
    } },
  })("app/api/reports/returns/route.ts").GET;
  return { queries, call: params => GET({ cookies: { get: () => ({ value: "token" }) }, nextUrl: new URL(`http://localhost/api/reports/returns?${new URLSearchParams(params ?? { from: "2026-10-01", to: "2026-10-31" })}`) }) };
}

test("Return Report requires fresh reports access and an active signed-in user", async () => {
  for (const options of [{ signedIn: false }, { active: false }, { modules: ["returns"] }]) {
    const h = setup(options);
    assert.ok([401, 403].includes((await h.call()).status));
    assert.equal(h.queries.length, 0);
  }
});

test("invalid, missing and reversed date ranges are rejected before reading returns", async () => {
  const h = setup();
  for (const params of [{}, { from: "2026-02-30", to: "2026-03-10" }, { from: "2026-10-31", to: "2026-10-01" }, { from: "bad", to: "2026-10-31" }]) {
    assert.equal((await h.call(params)).status, 400);
  }
  assert.equal(h.queries.length, 0);
});

test("date and search filters preserve complete return records and inclusive boundaries", async () => {
  const h = setup();
  const response = await h.call({ from: "2026-10-01", to: "2026-10-31", q: " INV-12 " });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.rows, []);
  assert.equal(response.headers["Cache-Control"], "no-store");
  const query = h.queries[0];
  assert.equal(query.where.return_date.gte.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(query.where.return_date.lte.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(query.where.OR[0].invoice.invoice_number.contains, "INV-12");
  assert.equal(query.where.OR[1].invoice.client_name.mode, "insensitive");
  assert.equal(query.where.OR[2].items.some.product_name.contains, "INV-12");
  assert.equal(query.where.reversed_at, undefined);
  assert.equal(query.take, undefined);
});

test("report serializes immutable snapshots, historical gaps and reversal status", async () => {
  const item = { id: "line", invoice_item_id: "sold", product_name: "Kit", description: "Test", unit: "packet", qty: "0.5", amount: "100",
    invoice_item: { qty: "2" }, invoice_before_qty: "2", invoice_after_qty: "1.5", stock_before_qty: "12", stock_after_qty: "14", stock_unit: "Vial" };
  const base = { id: "return", created_at: new Date("2026-10-03"), return_date: new Date("2026-10-03"), invoice: { invoice_number: "INV-12", client_name: "", returns: [] }, reason: "Damaged", reversed_at: new Date("2026-10-04"), items: [item, { ...item, id: "old", invoice_before_qty: null, invoice_after_qty: null, stock_before_qty: null, stock_after_qty: null, stock_unit: null }] };
  const h = setup({ records: [base] });
  const response = await h.call();
  assert.equal(response.status, 200);
  const [row, old] = response.body.rows;
  assert.equal(row.invoiceNumber, "INV-12");
  assert.equal(row.customer, "Walk-in");
  assert.equal(row.invoiceBefore, 2);
  assert.equal(row.invoiceAfter, 1.5);
  assert.equal(row.stockBefore, 12);
  assert.equal(row.stockAfter, 14);
  assert.equal(row.stockUnit, "Vial");
  assert.equal(row.reversedAt, "2026-10-04T00:00:00.000Z");
  assert.equal(old.stockBefore, null);
  assert.equal(old.invoiceAfter, 1.5);
});

test("historical invoice quantities include earlier returns outside the range and respect reversals", () => {
  const current = { id: "b", created_at: new Date("2026-10-10T12:00Z") };
  const entry = (id, created, reversed, qty = 1) => ({ id, created_at: new Date(created), reversed_at: reversed ? new Date(reversed) : null, items: [{ invoice_item_id: "sold", qty }] });
  const history = [entry("a", "2026-09-01", null), entry("b", "2026-10-10T12:00Z", null),
    entry("c", "2026-10-11", null), entry("d", "2026-10-01", "2026-10-09"),
    entry("e", "2026-10-02", "2026-10-11", 0.5)];
  assert.equal(invoiceQuantityBefore(4, "sold", current, history), 2.5);
});

test("missing report columns return a clear upgrade error", async t => {
  t.mock.method(console, "error", () => {});
  const result = await setup({ error: { code: "P2022" } }).call();
  assert.equal(result.status, 503);
  assert.match(result.body.error, /db:upgrade:return-report/);
});
