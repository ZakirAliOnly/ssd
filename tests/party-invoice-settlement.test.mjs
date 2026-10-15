import test from "node:test";
import assert from "node:assert/strict";
import { planPartyInvoiceSettlement, partySettlementTransaction } from "../lib/partyInvoiceSettlement.ts";
import { harness } from "./helpers/inventory-harness.mjs";

const invoice = (id, total, date, received = 0, returns = []) => ({ id, grand_total: total, amount_received: received, invoice_date: date, created_at: date, returns });
const receipt = (amount, fields = {}) => ({ id: "payment", type: "in", amount, method: "Cash", description: "Payment received", reference: "", ...fields });
const statuses = plan => plan.map(i => [i.id, i.balance_due, i.payment_status]);

test("payments settle the oldest invoice first and leave the next partially paid", () => {
  assert.deepEqual(statuses(planPartyInvoiceSettlement([
    invoice("new", 100, "2026-10-15"), invoice("old", 100, "2026-10-01"), invoice("middle", 100, "2026-10-10"),
  ], [receipt(150)])), [["old", 0, "paid"], ["middle", 50, "partial"], ["new", 100, "unpaid"]]);
});
test("linked invoice receipts are counted once and preserve original receipt amounts", () => {
  const invoices = [invoice("old", 100, "2026-10-01", 50), invoice("new", 100, "2026-10-15")];
  const before = structuredClone(invoices);
  assert.deepEqual(statuses(planPartyInvoiceSettlement(invoices, [receipt(50, { reference: "old" }), receipt(75, { id: "general" })])),
    [["old", 0, "paid"], ["new", 75, "partial"]]);
  assert.deepEqual(invoices, before);
});
test("return credits reduce the original invoice without being counted twice", () => {
  const invoices = [invoice("old", 100, "2026-10-01", 0, [{ amount: 25, credit_entry_id: "ret" }]), invoice("new", 100, "2026-10-15")];
  const result = planPartyInvoiceSettlement(invoices, [receipt(100), receipt(25, { id: "ret", type: "out", method: "Adjustment" })]);
  assert.deepEqual(statuses(result), [["old", 0, "paid"], ["new", 75, "partial"]]);
});
test("invoice overpayments and paid-invoice returns carry credit to the next invoice", () => {
  assert.deepEqual(statuses(planPartyInvoiceSettlement([
    invoice("old", 100, "2026-10-01", 100, [{ amount: 25, credit_entry_id: "ret" }]), invoice("new", 100, "2026-10-15"),
  ], [receipt(25, { id: "ret", type: "out", method: "Adjustment" })])), [["old", 0, "paid"], ["new", 75, "partial"]]);
  assert.deepEqual(statuses(planPartyInvoiceSettlement([invoice("a", 10, "2026-10-01", 20), invoice("b", 10, "2026-10-15")], [])), [["a", 0, "paid"], ["b", 0, "paid"]]);
});
test("opening debt is settled first and refunds reduce available general receipts", () => {
  const invoices = [invoice("old", 100, "2026-10-01")];
  const cash = [receipt(150), receipt(50, { id: "opening", description: "Opening balance" }), receipt(25, { id: "refund", type: "out" })];
  assert.deepEqual(statuses(planPartyInvoiceSettlement(invoices, cash)), [["old", 25, "partial"]]);
});
test("two decimal quantities and deterministic invoice order leave no rounding balance", () => {
  const invoices = [invoice("b", 0.2, "2026-10-01"), invoice("a", 0.1, "2026-10-01")];
  assert.deepEqual(statuses(planPartyInvoiceSettlement(invoices, [receipt(0.3)])), [["a", 0, "paid"], ["b", 0, "paid"]]);
});

async function party() {
  const h = harness();
  for (const [date, total] of [["2026-10-01", 100], ["2026-10-10", 100], ["2026-10-15", 100]]) {
    const result = await h.call({ table: "invoices", operation: "save_invoice", data: { client_name: "Test", is_walk_in: false, invoice_date: date, grand_total: total, amount_received: 0 }, items: [{ category: "Service", qty: 1, rate: 100, amount: 100 }] });
    assert.equal(result.status, 200);
  }
  const pay = (amount, extras = {}) => h.call({ table: "cashbook", operation: "insert", data: { account_name: "Test", type: "in", date: "2026-10-15", amount, method: "Cash", description: "Payment received", reference: "", ...extras } });
  return { h, pay };
}
test("saving, editing and deleting a ledger payment persist oldest-first statuses", async () => {
  const { h, pay } = await party();
  const saved = await pay(150); assert.equal(saved.status, 200);
  assert.deepEqual(h.state().invoices.map(i => [i.balance_due, i.payment_status]), [[0, "paid"], [50, "partial"], [100, "unpaid"]]);
  assert.ok(h.state().invoices.every(i => i.amount_received === 0));
  const filter = [{ type: "eq", col: "id", val: saved.body.data.id }];
  assert.equal((await h.call({ table: "cashbook", operation: "update", filters: filter, data: { amount: 250 } })).status, 200);
  assert.deepEqual(h.state().invoices.map(i => i.balance_due), [0, 0, 50]);
  assert.equal((await h.call({ table: "cashbook", operation: "delete", filters: filter })).status, 200);
  assert.ok(h.state().invoices.every(i => i.payment_status === "unpaid" && i.balance_due === 100));
});
test("payments for another party and walk-in invoices remain isolated", async () => {
  const { h, pay } = await party();
  const walkin = await h.call({ table: "invoices", operation: "save_invoice", data: { client_name: "Test", is_walk_in: true, invoice_date: "2026-09-01", grand_total: 50, amount_received: 0, balance_due: 50, payment_status: "unpaid" }, items: [{ category: "Service", qty: 1, rate: 50, amount: 50 }] });
  assert.equal(walkin.status, 200, JSON.stringify(walkin.body));
  assert.equal((await pay(999, { account_name: "Other" })).status, 200);
  assert.ok(h.state().invoices.every(i => i.payment_status === "unpaid"));
  assert.equal((await pay(150)).status, 200);
  assert.equal(h.state().invoices.find(i => i.id === walkin.body.data.id).balance_due, 50);
});
test("serialization failures retry the entire payment transaction", async () => {
  let calls = 0;
  const result = await partySettlementTransaction({ $transaction: async (work, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    if (++calls < 3) throw Object.assign(new Error("conflict"), { code: "P2034" });
    return work({});
  } }, async () => "saved");
  assert.equal(result, "saved"); assert.equal(calls, 3);
});
