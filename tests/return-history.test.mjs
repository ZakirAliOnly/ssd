import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as history from "../lib/returnHistory.ts";

const original = [{ id: "a", qty: "2.5" }, { id: "b", qty: "1" }];
test("a whole invoice return must include every original quantity", () => {
  assert.equal(history.returnScope(original, [{ id: "b", qty: 1 }, { id: "a", qty: 2.5 }], []), "Whole invoice");
  assert.equal(history.returnScope(original, [{ id: "a", qty: 2.5 }], []), "Selected items");
  assert.equal(history.returnScope(original, [{ id: "a", qty: 1 }, { id: "b", qty: 1 }], []), "Selected items");
});
test("finishing earlier partial returns is labelled remaining invoice", () => {
  assert.equal(history.returnScope(original, [{ id: "a", qty: 1.25 }, { id: "b", qty: 1 }], [{ id: "a", qty: 1.25 }]), "Remaining invoice");
  assert.equal(history.returnScope(original, [{ id: "a", qty: 0.25 }], [{ id: "a", qty: 1.25 }]), "Selected items");
  assert.equal(history.returnScope([], [], []), "Selected items");
});

const compiled = ts.transpileModule(readFileSync(new URL("../app/api/returns/history/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function harness({ signedIn = true, active = true, allowed = true, missing = false } = {}) {
  const queries = [];
  const id = "00000000-0000-0000-0000-000000000001";
  const date = new Date("2026-10-15T12:00:00Z");
  const earlier = { id: "earlier", created_at: new Date("2026-10-14T12:00:00Z"), items: [{ invoice_item_id: "a", purchase_item_id: "a", qty: "1.25" }] };
  const item = { id: "line", invoice_item_id: "a", purchase_item_id: "a", product_name: "Product", description: "Description", qty: "1.25", amount: "25", stock_restored_qty: "1.25", stock_removed_qty: "1.25" };
  const base = { id, return_date: date, created_at: date, reason: "Reason", amount: "25", created_by_name: "Operator", items: [item] };
  const invoice = { invoice_number: "INV-1", po_number: "PO-1", client_name: "Customer", supplier_name: "Supplier", invoice_date: date, order_date: date,
    items: [{ id: "a", qty: "2.5" }], returns: [earlier, base] };
  const prisma = { user: { findUnique: async () => ({ is_active: active }) }, $transaction: async callback => callback(prisma) };
  for (const type of ["invoiceReturn", "supplierReturn"]) prisma[type] = {
    count: async args => { queries.push({ type, operation: "count", ...args }); return missing ? 0 : 26; },
    findMany: async args => { queries.push({ type, operation: "findMany", ...args }); return missing ? [] : [{ ...base, invoice, purchase_order: invoice }]; },
  };
  const deps = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/auth": { COOKIE_NAME: "auth", verifyToken: async () => signedIn ? { sub: "user" } : null },
    "@/lib/prisma": { prisma }, "@/lib/moduleAccess": { canAccessPath: () => allowed }, "@/lib/returnHistory": history,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => deps[name], module, module.exports);
  return { id, queries, call: params => module.exports.GET({ cookies: { get: () => ({ value: "token" }) }, nextUrl: new URL(`http://local/history?${new URLSearchParams(params)}`) }) };
}
test("history rejects missing authentication, inactive users and missing return access", async () => {
  for (const [options, status] of [[{ signedIn: false }, 401], [{ active: false }, 403], [{ allowed: false }, 403]]) {
    const h = harness(options); assert.equal((await h.call({})).status, status); assert.equal(h.queries.length, 0);
  }
});
test("sales history is paginated and searches invoice, party and products without case sensitivity", async () => {
  const h = harness(); const result = await h.call({ type: "sales", q: "pRoDuCt", page: "2" });
  assert.equal(result.status, 200);
  const query = h.queries.find(q => q.operation === "findMany");
  assert.equal(query.take, 25); assert.equal(query.skip, 25);
  assert.equal(query.where.OR[2].items.some.product_name.mode, "insensitive");
  assert.equal(result.body.returns[0].scope, "Remaining invoice");
  assert.equal(result.body.returns[0].invoice_number, "INV-1");
  assert.equal(result.body.returns[0].items[0].product_name, "Product");
});
test("supplier detail normalizes stock removed and keeps supplier invoice reference", async () => {
  const h = harness(); const result = await h.call({ type: "supplier", id: h.id });
  assert.equal(result.status, 200); assert.equal(result.body.returns[0].invoice_number, "PO-1");
  assert.equal(result.body.returns[0].type, "supplier");
  assert.equal(result.body.returns[0].items[0].stock_restored_qty, "1.25");
  assert.equal(h.queries.find(q => q.operation === "findMany").take, 1);
});
test("invalid or missing return IDs fail clearly", async () => {
  const h = harness(); assert.equal((await h.call({ type: "other" })).status, 400);
  assert.equal((await h.call({ id: "bad" })).status, 400);
  assert.equal(h.queries.length, 0);
  const missing = harness({ missing: true }); assert.equal((await missing.call({ id: missing.id })).status, 404);
});
