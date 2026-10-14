import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { buildSupplierStatements } from "../lib/supplierStatement.ts";

// Execute the actual TypeScript helpers, resolving the app's aliases locally.
const require = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  cache.set(path, module.exports);
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${path}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)(name => name.startsWith("./") || name.startsWith("@/lib/")
    ? load(name.replace(/^\.\//, "").replace(/^@\/lib\//, "")) : require(name), module, module.exports);
  return module.exports;
}
const { buildPartyStatements } = load("partyStatement");
const supplier = { id: "s1", name: "Supplier", phone: "", opening_balance: 100, created_at: "2026-01-01T00:00:00Z" };
const purchase = { id: "p1", po_number: "PO001", supplier_id: "s1", supplier_name: "Old name", order_date: "2026-02-01", created_at: "2026-02-01T10:00:00Z", grand_total: 500, amount_paid: 200, cashbook_entry_id: "c1" };
const payment = { id: "c1", reference: "p1", account_name: "Old name", date: "2026-02-01", created_at: "2026-02-01T11:00:00Z", type: "out", amount: 200, method: "Cash", description: "Purchase payment" };

test("supplier statements reconstruct paid opening, count each payment once, and retain rename links", () => {
  const openingPayment = { ...payment, id: "c2", reference: "s1", amount: 50, date: "2026-01-15" };
  const [statement] = buildSupplierStatements([supplier], [purchase], [payment, payment, openingPayment], "2026-01-01", "2026-02-28");
  assert.equal(statement.debit, 650);
  assert.equal(statement.credit, 250);
  assert.equal(statement.closing, 400);
  assert.equal(statement.warning, null);
});

test("supplier period includes both boundary dates and carries earlier opening balances", () => {
  const laterPayment = { ...payment, id: "c2", reference: "s1", date: "2026-03-01", amount: 50 };
  const [statement] = buildSupplierStatements([supplier], [purchase], [payment, laterPayment], "2026-02-01", "2026-02-01");
  assert.equal(statement.opening, 150);
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.closing, 450);
});

test("supplier history does not absorb same-name customer payments or unknown references", () => {
  const unrelated = { ...payment, id: "other", reference: "customer-invoice", account_name: "Supplier", amount: 900 };
  const [statement] = buildSupplierStatements([supplier], [purchase], [payment, unrelated], "2026-01-01", "2026-12-31", ["Supplier"]);
  assert.equal(statement.credit, 200);
  assert.equal(statement.closing, 400);
  assert.ok(statement.warning);
});

test("missing cashbook payment history is flagged rather than invented on invoice date", () => {
  const [statement] = buildSupplierStatements([supplier], [purchase], [], "2026-01-01", "2026-12-31");
  assert.equal(statement.credit, 0);
  assert.ok(statement.warning);
});

test("all suppliers include inactive zero-transaction suppliers and refunds increase payable", () => {
  const refund = { ...payment, reference: "s1", type: "in", amount: 20 };
  const statements = buildSupplierStatements([supplier, { ...supplier, id: "s2", name: "Empty", opening_balance: 0 }], [], [refund], "2026-01-01", "2026-12-31");
  assert.equal(statements[0].closing, 0);
  assert.equal(statements[1].closing, 120);
});

test("party statements preserve opening and adjustment entries, deduplicate invoice payments, and exclude supplier credits", () => {
  const account = { id: "a1", name: "Party", phone: "", created_at: "2026-01-01", balance: 9999 };
  const invoice = { id: "i1", invoice_number: "SSD001", client_name: "Party", invoice_date: "2026-02-01", created_at: "2026-02-01T10:00:00Z", grand_total: 500, amount_received: 200, payment_method: "Cash" };
  const cash = [
    { ...payment, id: "o", account_name: "Party", reference: "", date: "2026-01-01", type: "in", amount: 100, description: "Opening balance — Party" },
    { ...payment, id: "a", account_name: "Party", reference: "", date: "2026-02-01", type: "out", amount: 30, method: "Adjustment", description: "Balance adjustment" },
    { ...payment, id: "i", account_name: "Party", reference: "i1", type: "in", amount: 200 },
    { ...payment, account_name: "Party" },
  ];
  const [statement] = buildPartyStatements([account], [invoice], cash, [supplier], [purchase], "2026-02-01", "2026-02-01");
  assert.equal(statement.opening, 100);
  assert.equal(statement.debit, 500);
  assert.equal(statement.credit, 230);
  assert.equal(statement.closing, 370);
  assert.equal(statement.rows.length, 3);
});

test("party statements include parties with no transactions", () => {
  const statements = buildPartyStatements([{ id: "a", name: "Empty", phone: "" }], [], [], [], [], "2026-01-01", "2026-12-31");
  assert.equal(statements.length, 1);
  assert.equal(statements[0].closing, 0);
});

test("return credits preserve cents, leave cash unchanged and separate refunds settle party credit", () => {
  const accounts = [{ id: "a", name: "Client", phone: "" }];
  const invoices = [{ id: "i", client_name: "Client", invoice_number: "INV-1", invoice_date: "2026-10-06", created_at: "2026-10-06", grand_total: 1.01, amount_received: 1.01 }];
  const credit = { id: "r", account_name: "Client", date: "2026-10-10", type: "out", amount: 1.01, method: "Adjustment", reference: "return-id", description: "Sales return INV-1" };
  const [returned] = buildPartyStatements(accounts, invoices, [credit], [], [], "2026-10-01", "2026-10-31");
  assert.equal(returned.closing, -1.01);
  const refund = { id: "refund", account_name: "Client", date: "2026-10-11", type: "out", amount: 1.01, method: "Cash", reference: "i", description: "Return refund" };
  const [settled] = buildPartyStatements(accounts, invoices, [credit, refund], [], [], "2026-10-01", "2026-10-31");
  assert.equal(settled.closing, 0);
  const methods = load("paymentMethods").computeMethodBalances([credit, refund], [{ name: "Cash", opening_balance: 10 }]);
  assert.equal(methods.Cash, 8.99);
});

test("supplier return credits reduce payable without inventing opening cash and refunds settle the credit", () => {
  const supplier = { id: "s", name: "Supplier", opening_balance: 0, created_at: "2026-01-01" };
  const purchase = { id: "p", supplier_id: "s", supplier_name: "Supplier", po_number: "PO-1", order_date: "2026-10-06", created_at: "2026-10-06T00:00:00", grand_total: 500, amount_paid: 500 };
  const payment = { id: "pay", reference: "s", account_name: "Supplier", date: "2026-10-06", created_at: "2026-10-06T00:00:01", type: "out", amount: 500, method: "Cash", description: "Supplier payment" };
  const credit = { id: "r", reference: "s", account_name: "Supplier", date: "2026-10-10", created_at: "2026-10-10T00:00:00", type: "out", amount: 200, method: "Adjustment", description: "Supplier return PO-1" };
  const [returned] = buildSupplierStatements([supplier], [purchase], [payment, credit], "2026-10-01", "2026-10-31");
  assert.equal(returned.opening, 0); assert.equal(returned.closing, -200); assert.equal(returned.warning, null);
  const refund = { ...payment, id: "refund", type: "in", amount: 200, date: "2026-10-11", description: "Supplier refund" };
  const [settled] = buildSupplierStatements([supplier], [purchase], [payment, credit, refund], "2026-10-01", "2026-10-31");
  assert.equal(settled.closing, 0);
});
