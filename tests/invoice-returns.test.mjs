import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness } from "./helpers/inventory-harness.mjs";

async function setup(qty = 4, opening = 10) {
  const h = harness(undefined, opening);
  const sale = await h.save(qty);
  assert.equal(sale.status, 200);
  const invoiceId = sale.body.data.id;
  const lineId = h.state().invoiceItems[0].id;
  const body = (returned, requestId = randomUUID()) => ({ invoiceId, requestId, date: "2026-10-10", reason: "Customer return",
    selections: [{ invoice_item_id: lineId, qty: returned }] });
  return { h, invoiceId, lineId, body };
}
test("partial return restores original batch stock and credits the party without cash movement", async () => {
  const { h, body, invoiceId } = await setup();
  const original = structuredClone(h.state().invoices);
  const items = structuredClone(h.state().invoiceItems);
  const response = await h.returnCall(body(1.5));
  assert.equal(response.status, 200);
  assert.equal(Number(response.body.record.amount), 150);
  assert.equal(h.state().products[0].quantity, 7.5);
  assert.equal(h.state().batches[0].remaining_qty, 7.5);
  assert.equal(h.state().allocations[0].qty, 4);
  assert.equal(h.state().returnAllocations[0].qty, 1.5);
  assert.deepEqual(h.state().invoices, original.map(invoice => ({ ...invoice, balance_due: 250, payment_status: "partial" })));
  assert.deepEqual(h.state().invoiceItems, items);
  assert.equal(h.state().cashbook[0].method, "Adjustment");
  assert.equal(h.state().cashbook[0].account_name, "Test");
  assert.equal(h.state().cashbook[0].type, "out");
  const detail = await h.returnGet({ id: invoiceId });
  assert.equal(detail.body.invoice.returns.length, 1);
});
test("retrying the same request never credits or restocks twice", async () => {
  const { h, body } = await setup(); const request = body(2);
  const first = await h.returnCall(request); const before = structuredClone(h.state());
  const retry = await h.returnCall(request);
  assert.equal(first.status, 200); assert.equal(retry.status, 200);
  assert.equal(retry.body.record.id, first.body.record.id);
  assert.deepEqual(h.state(), before);
});
test("repeated partial returns cannot exceed sold quantity and roll back on failure", async () => {
  const { h, body } = await setup(3.5);
  assert.equal((await h.returnCall(body(1.25))).status, 200);
  const before = structuredClone(h.state());
  const rejected = await h.returnCall(body(2.5));
  assert.equal(rejected.status, 400);
  assert.deepEqual(h.state(), before);
  assert.equal((await h.returnCall(body(2.25))).status, 200);
  assert.equal(h.state().products[0].quantity, 10);
  assert.equal((await h.returnCall(body(0.01))).status, 400);
});
test("whole-invoice return selects several lines and preserves the original sale", async () => {
  const h = harness();
  const sale = await h.call({ table: "invoices", operation: "save_invoice", data: { invoice_date: "2026-10-06", client_name: "Test", grand_total: 270, discount_amount: 30 },
    items: [{ product_id: h.productId, category: "Sign", qty: 1, rate: 100, amount: 100 }, { product_id: h.productId, category: "Sign", description: "Second line", qty: 2, rate: 100, amount: 200 }] });
  const result = await h.returnCall({ invoiceId: sale.body.data.id, requestId: randomUUID(), date: "2026-10-10", reason: "", selections: h.state().invoiceItems.map(item => ({ invoice_item_id: item.id, qty: item.qty })) });
  assert.equal(result.status, 200); assert.equal(result.body.record.amount, 270);
  assert.equal(h.state().products[0].quantity, 10);
  assert.equal(h.state().returnItems.length, 2);
});
test("invalid quantities, duplicate selections, foreign items and invalid dates are rejected", async () => {
  const { h, body } = await setup(); const before = structuredClone(h.state());
  for (const qty of [-1, 0, 0.001, 5, "1"]) assert.equal((await h.returnCall(body(qty))).status, 400);
  const duplicate = body(1); duplicate.selections.push(duplicate.selections[0]);
  assert.equal((await h.returnCall(duplicate)).status, 400);
  const foreign = body(1); foreign.selections[0].invoice_item_id = randomUUID();
  assert.equal((await h.returnCall(foreign)).status, 400);
  for (const date of ["2026-10-01", "2026-02-30", "2999-01-01"]) assert.equal((await h.returnCall({ ...body(1), date })).status, 400);
  assert.deepEqual(h.state(), before);
});
test("legacy sales without batch history restock returned products", async () => {
  const { h, body } = await setup();
  h.state().allocations.length = 0;
  h.state().invoiceItems[0].stock_deducted_qty = 0;
  const response = await h.returnCall(body(1));
  assert.equal(response.status, 200);
  assert.equal(h.state().products[0].quantity, 7);
  assert.equal((await h.returnCall(body(3))).status, 200);
  assert.equal(h.state().products[0].quantity, 10);
});
test("return history protects invoices, items and ledger credits from edits and deletion", async () => {
  const { h, body, invoiceId, lineId } = await setup();
  assert.equal((await h.returnCall(body(1))).status, 200);
  const before = structuredClone(h.state());
  assert.equal((await h.save(4, invoiceId)).status, 400);
  for (const [table, id] of [["invoices", invoiceId], ["invoice_items", lineId], ["cashbook", h.state().cashbook[0].id]]) {
    assert.equal((await h.call({ table, operation: "delete", filters: [{ type: "eq", col: "id", val: id }] })).status, 400);
    if (table !== "invoice_items") assert.equal((await h.call({ table, operation: "update", data: { amount: 999 }, filters: [{ type: "eq", col: "id", val: id }] })).status, 400);
  }
  assert.deepEqual(h.state(), before);
});
test("returns endpoints enforce fresh module grants and active users", async () => {
  for (const profile of [{ role: "sub_user", modules: ["quick-invoice"], is_active: true }, { role: "sub_user", modules: ["returns"], is_active: false }, null]) {
    const h = harness(profile);
    assert.equal((await h.returnCall({})).status, 403);
    assert.equal((await h.returnGet({})).status, 403);
    assert.equal(h.transactions(), 0);
  }
  const h = harness({ role: "sub_user", modules: ["returns"], is_active: true });
  assert.equal((await h.returnGet({})).status, 200);
});
test("cumulative rounded credits exactly match discounted and taxed invoice totals", () => {
  const h = harness();
  const invoice = { id: randomUUID(), grand_total: 1.01, discount_amount: 0.1,
    items: [{ id: "a", product_id: h.productId, category: "A", description: "", qty: 3, stock_deducted_qty: 3, amount: 1 }] };
  const previous = [];
  for (let i = 0; i < 3; i++) previous.push(...h.planReturn(invoice, previous, [{ invoice_item_id: "a", qty: 1 }]).lines);
  assert.equal(Math.round(previous.reduce((sum, line) => sum + line.amount, 0) * 100), 101);
  assert.equal(Math.round(previous.reduce((sum, line) => sum + line.revenue, 0) * 100), 90);
  const free = h.planReturn({ ...invoice, grand_total: 0, discount_amount: 0, items: [{ ...invoice.items[0], amount: 0, stock_deducted_qty: 0 }] }, [], [{ invoice_item_id: "a", qty: 3 }]);
  assert.equal(free.amount, 0); assert.equal(free.lines[0].stock_restored_qty, 3);
});


test("non-admins cannot delete invoices, suppliers or supplier invoices", async () => {
  const h = harness({ role: "sub_user", modules: ["accounts", "quick-invoice", "supplier"], is_active: true });
  for (const table of ["invoices", "invoice_items", "quick_invoices", "suppliers", "purchase_orders", "purchase_order_items"]) {
    assert.equal((await h.call({ table, operation: "delete", filters: [] })).status, 403, table);
  }
  assert.equal(h.transactions(), 0);
});
