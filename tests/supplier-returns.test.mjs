import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness } from "./helpers/inventory-harness.mjs";

async function setup(qty = 10, paid = 0) {
  const h = harness(undefined, 0);
  const purchase = await h.purchase(qty, { paid });
  assert.equal(purchase.status, 200);
  const invoiceId = purchase.body.data.id;
  const lineId = h.state().purchaseItems[0].id;
  const body = (qty, requestId = randomUUID()) => ({ type: "supplier", invoiceId, requestId, date: "2026-10-10", reason: "Wrong item",
    selections: [{ invoice_item_id: lineId, qty }] });
  return { h, invoiceId, lineId, body };
}
test("supplier returns remove original batch stock and reduce payable without recording cash received", async () => {
  const { h, body } = await setup();
  const items = structuredClone(h.state().purchaseItems);
  const response = await h.returnCall(body(2.5));
  assert.equal(response.status, 200);
  assert.equal(response.body.record.amount, 250);
  assert.equal(h.state().products[0].quantity, 7.5);
  assert.equal(h.state().batches[0].remaining_qty, 7.5);
  assert.equal(h.state().batches[0].received_qty, 10);
  assert.equal(h.state().purchases[0].grand_total, 1000);
  assert.equal(h.state().purchases[0].balance_due, 750);
  assert.deepEqual(h.state().purchaseItems, items);
  assert.equal(h.state().cashbook[0].method, "Adjustment");
  assert.equal(h.state().cashbook[0].reference, h.supplierId);
});
test("whole and repeated supplier returns cannot duplicate credits or return quantities twice", async () => {
  const { h, body } = await setup(3.5);
  const request = body(1.25);
  assert.equal((await h.returnCall(request)).status, 200);
  const before = structuredClone(h.state());
  assert.equal((await h.returnCall(request)).status, 200);
  assert.deepEqual(h.state(), before);
  assert.equal((await h.returnCall(body(2.5))).status, 400);
  assert.deepEqual(h.state(), before);
  assert.equal((await h.returnCall(body(2.25))).status, 200);
  assert.equal(h.state().products[0].quantity, 0);
  assert.equal(h.state().purchases[0].balance_due, 0);
  assert.equal((await h.returnCall(body(0.01))).status, 400);
});
test("supplier return cannot use stock from a different purchase when its batch is sold", async () => {
  const { h, body } = await setup(5);
  assert.equal((await h.save(4)).status, 200);
  assert.equal((await h.purchase(10)).status, 200);
  const before = structuredClone(h.state());
  const rejected = await h.returnCall(body(2));
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /Not enough unsold stock/);
  assert.deepEqual(h.state(), before);
  assert.equal((await h.returnCall(body(1))).status, 200);
  assert.equal(h.state().products[0].quantity, 10);
});
test("returns of paid purchases create supplier credit without changing the payment", async () => {
  const { h, body } = await setup(4, 400);
  assert.equal((await h.returnCall(body(2))).status, 200);
  assert.equal(h.state().purchases[0].balance_due, -200);
  assert.equal(h.state().purchases[0].amount_paid, 400);
  assert.equal(h.state().cashbook.length, 1);
});
test("supplier return list supports purchase numbers, supplier names and UUIDs", async () => {
  const { h, invoiceId, body } = await setup();
  assert.equal((await h.returnCall(body(1))).status, 200);
  for (const q of [invoiceId, h.state().purchases[0].po_number, "Supplier"]) {
    const response = await h.returnGet({ type: "supplier", q });
    assert.equal(response.status, 200); assert.equal(response.body.count, 1);
    assert.equal(response.body.invoices[0].returns.length, 1);
  }
  const detail = await h.returnGet({ type: "supplier", id: invoiceId });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.invoice.items[0].return_items[0].stock_restored_qty, 1);
  assert.equal(detail.body.invoice.returns.length, 1);
});
test("return history protects supplier invoice edits and credits while payments use the net balance", async () => {
  const { h, invoiceId, lineId, body } = await setup(5);
  assert.equal((await h.returnCall(body(2))).status, 200);
  const before = structuredClone(h.state());
  assert.equal((await h.purchase(5, { purchaseId: invoiceId, lineId })).status, 400);
  for (const operation of ["update", "delete"]) {
    const response = await h.call({ table: "cashbook", operation, data: { amount: 1 }, filters: [{ type: "eq", col: "id", val: h.state().cashbook[0].id }] });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(h.state(), before);
  assert.equal((await h.call({ table: "purchase_orders", operation: "update", data: { amount_paid: 400 }, filters: [{ type: "eq", col: "id", val: invoiceId }] })).status, 400);
  assert.equal((await h.call({ table: "purchase_orders", operation: "update", data: { amount_paid: 100, balance_due: 400 }, filters: [{ type: "eq", col: "id", val: invoiceId }] })).status, 200);
  assert.equal(h.state().purchases[0].balance_due, 200);
});
test("supplier endpoints reject missing grants, invalid dates and foreign invoice items", async () => {
  const denied = harness({ role: "sub_user", modules: ["supplier"], is_active: true });
  assert.equal((await denied.returnGet({ type: "supplier" })).status, 403);
  assert.equal((await denied.returnCall({ type: "supplier" })).status, 403);
  const { h, body } = await setup(); const before = structuredClone(h.state());
  for (const qty of [-1, 0, 0.001]) assert.equal((await h.returnCall(body(qty))).status, 400);
  const foreign = body(1); foreign.selections[0].invoice_item_id = randomUUID();
  assert.equal((await h.returnCall(foreign)).status, 400);
  assert.equal((await h.returnCall({ ...body(1), date: "2026-10-01" })).status, 400);
  assert.deepEqual(h.state(), before);
});
