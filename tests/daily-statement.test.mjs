import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as daily from "../lib/dailyStatement.ts";

test("daily totals distinguish cash, pending expenses and non-cash returns", () => {
  const cash = (type, amount, method = "Cash", description = "Payment") => ({ id: "c", type, amount, method, description, reference: "" });
  const activity = (kind, amount) => ({ id: kind, kind, amount, reference: "INV", party: "Party", details: "" });
  const totals = daily.dailyStatementTotals({ date: "2026-10-15",
    cash: [cash("in", 100), cash("in", 50, "Bank"), cash("out", 20), cash("out", 10, "Cash", "Cash refund"),
      cash("out", 70, " Adjustment "), cash("in", 900, "Cash", "Opening balance"), cash("out", 800, "Cash", "Balance adjustment")],
    expenses: [{ id: "e", reference: "EXP", description: "", category: "", amount: 20, completed: true },
      { id: "pending", reference: "EXP2", description: "", category: "", amount: 5, completed: false }],
    activity: [activity("Sale", 200), activity("Purchase", 90), activity("Sales return", 70), activity("Supplier return", 15)],
  });
  assert.deepEqual(totals, { income: 150, cashOut: 30, netCash: 120, expenses: 25, sales: 200, purchases: 90, salesReturns: 70, supplierReturns: 15 });
});

test("empty days and decimal cash movements produce exact totals", () => {
  const data = { date: "2026-10-15", cash: [], expenses: [], activity: [] };
  assert.ok(Object.values(daily.dailyStatementTotals(data)).every(v => v === 0));
  data.cash = [0.1, 0.2].map((amount, i) => ({ id: String(i), type: "in", amount, method: "Cash", description: "", reference: "" }));
  assert.equal(daily.dailyStatementTotals(data).netCash, 0.3);
});

const compiled = ts.transpileModule(readFileSync(new URL("../app/api/reports/daily-statement/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function harness({ signedIn = true, active = true, allowed = true } = {}) {
  const queries = [];
  const prisma = { user: { findUnique: async () => ({ is_active: active }) },
    $transaction: async (queries, options) => { assert.equal(options.isolationLevel, "RepeatableRead"); return Promise.all(queries); } };
  const rows = {
    invoice: [{ id: "sale", invoice_number: "INV-1", client_name: "Customer", grand_total: "100", is_walk_in: true }],
    purchaseOrder: [], expense: [], cashbook: [], supplierReturn: [],
    invoiceReturn: [{ id: "return", invoice: { invoice_number: "OLDER-INVOICE", client_name: "Customer" }, amount: "12.5", reason: "Damaged", items: [{ product_name: "Product", qty: "0.5" }] }],
  };
  for (const [model, records] of Object.entries(rows)) prisma[model] = { findMany: async args => { queries.push({ model, ...args }); return records; } };
  const deps = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/auth": { COOKIE_NAME: "auth", verifyToken: async () => signedIn ? { sub: "u" } : null },
    "@/lib/moduleAccess": { canAccessPath: () => allowed },
    "@/lib/prisma": { prisma }, "@/lib/dailyStatement": daily,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => deps[name], module, module.exports);
  const call = date => module.exports.GET({ cookies: { get: () => ({ value: "token" }) }, nextUrl: new URL(`http://local/api?date=${date}`) });
  return { call, queries };
}

test("daily statement requires a signed-in active user with reports access", async () => {
  for (const [options, status] of [[{ signedIn: false }, 401], [{ active: false }, 403], [{ allowed: false }, 403]]) {
    const h = harness(options);
    assert.equal((await h.call("2026-10-15")).status, status);
    assert.equal(h.queries.length, 0);
  }
});
test("invalid days are rejected before querying financial data", async () => {
  for (const date of ["", "2026-02-30", "bad-date"]) {
    const h = harness(); assert.equal((await h.call(date)).status, 400); assert.equal(h.queries.length, 0);
  }
});
test("all sources use the selected business date and returns retain older invoice references", async () => {
  const h = harness(); const result = await h.call("2026-10-15");
  assert.equal(result.status, 200); assert.equal(h.queries.length, 6);
  for (const query of h.queries) assert.equal(Object.values(query.where)[0].toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(result.body.date, "2026-10-15");
  assert.equal(result.body.activity[1].reference, "OLDER-INVOICE");
  assert.match(result.body.activity[1].details, /Product × 0.5/);
  assert.equal(result.body.activity[1].amount, 12.5);
});
