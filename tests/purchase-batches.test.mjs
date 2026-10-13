import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness } from "./helpers/inventory-harness.mjs";

test("fractional receipts and sales preserve FIFO batch balances", async () => {
  const h = harness(undefined, 0);
  assert.equal((await h.purchase(1.5, { date: "2026-01-01" })).status, 200);
  assert.equal((await h.purchase(2.2, { date: "2026-02-01" })).status, 200);
  assert.equal((await h.save(1.7)).status, 200);
  assert.equal(h.state().products[0].quantity, 2);
  assert.equal(h.state().batches[0].remaining_qty, 0);
  assert.equal(h.state().batches[1].remaining_qty, 2);
});

test("a purchase receives stock and its expiry in the same transaction", async () => {
  const h = harness();
  const response = await h.purchase(4);
  assert.equal(response.status, 200);
  assert.equal(h.state().products[0].quantity, 14);
  assert.equal(h.state().purchaseItems[0].stock_received_qty, 4);
  assert.equal(h.state().batches[1].remaining_qty, 4);
  assert.equal(h.state().batches[1].expiry_date.toISOString().slice(0, 10), "2027-01-01");
});

test("strict FIFO sells the oldest purchase even when a newer batch expires earlier", async () => {
  const h = harness();
  await h.purchase(4, { expiryDate: "2026-11-01" });
  assert.equal((await h.save(11)).status, 200);
  assert.equal(h.state().batches[0].remaining_qty, 0);
  assert.equal(h.state().batches[1].remaining_qty, 3);
  assert.equal(h.state().products[0].quantity, 3);
  assert.equal(h.state().products[0].expiry_date.toISOString().slice(0, 10), "2026-11-01");
  assert.deepEqual(h.state().allocations.map(row => row.qty), [10, 1]);
});

test("expiry edits update the batch and next-to-sell product expiry without adding stock again", async () => {
  const h = harness(undefined, 0);
  const created = await h.purchase(4);
  const response = await h.purchase(4, { purchaseId: created.body.data.id,
    lineId: h.state().purchaseItems[0].id, expiryDate: "2028-02-29" });
  assert.equal(response.status, 200);
  assert.equal(h.state().products[0].quantity, 4);
  assert.equal(h.state().batches.length, 1);
  assert.equal(h.state().products[0].expiry_date.toISOString().slice(0, 10), "2028-02-29");
  assert.equal(h.state().purchaseItems[0].expiry_date.toISOString().slice(0, 10), "2028-02-29");
});

test("repeated purchase creates and unchanged edits do not receive twice", async () => {
  const h = harness(); const requestId = randomUUID();
  const created = await h.purchase(4, { requestId });
  assert.equal((await h.purchase(4, { requestId })).body.data.id, created.body.data.id);
  await h.purchase(4, { purchaseId: created.body.data.id, lineId: h.state().purchaseItems[0].id });
  assert.equal(h.state().products[0].quantity, 14);
  assert.equal(h.state().purchases.length, 1);
  assert.equal(h.state().batches.length, 2);
});

test("purchase quantity edits receive or remove only the difference", async () => {
  const h = harness(); const created = await h.purchase(4);
  const options = { purchaseId: created.body.data.id, lineId: h.state().purchaseItems[0].id };
  await h.purchase(6, options);
  assert.equal(h.state().products[0].quantity, 16);
  await h.purchase(3, options);
  assert.equal(h.state().products[0].quantity, 13);
});

test("a sold batch cannot be removed or reduced below its consumed quantity", async () => {
  const h = harness(); const created = await h.purchase(4);
  await h.save(12);
  const before = structuredClone(h.state());
  const response = await h.purchase(1, { purchaseId: created.body.data.id, lineId: h.state().purchaseItems[0].id });
  assert.equal(response.status, 400);
  assert.deepEqual(h.state(), before);
  // Omitting the existing line attempts to remove its sold batch.
  assert.equal((await h.purchase(4, { purchaseId: created.body.data.id })).status, 400);
  assert.deepEqual(h.state(), before);
});

test("invoice reductions and deletion return the original batches", async () => {
  const h = harness(); await h.purchase(4);
  const sale = await h.save(12);
  await h.save(9, sale.body.data.id);
  assert.equal(h.state().batches[0].remaining_qty, 1);
  assert.equal(h.state().batches[1].remaining_qty, 4);
  await h.call({ table: "invoices", operation: "delete", filters: [{ type: "eq", col: "id", val: sale.body.data.id }] });
  assert.deepEqual(h.state().batches.map(batch => batch.remaining_qty), [10, 4]);
  assert.equal(h.state().products[0].quantity, 14);
  assert.equal(h.state().allocations.length, 0);
});

test("invalid calendar dates and over-precision purchase quantities roll back", async () => {
  const h = harness(); const before = structuredClone(h.state());
  assert.equal((await h.purchase(4, { expiryDate: "2026-02-30" })).status, 400);
  assert.equal((await h.purchase(1.555)).status, 400);
  assert.deepEqual(h.state(), before);
});

test("historical purchase edits do not replay already-counted opening stock", async () => {
  const h = harness(); const id = randomUUID(), lineId = randomUUID();
  h.state().purchases.push({ id, po_number: "PO001", supplier_id: h.supplierId, amount_paid: 0 });
  h.state().purchaseItems.push({ id: lineId, purchase_order_id: id, product_id: h.productId,
    qty: 5, rate: 100, amount: 500, stock_received_qty: 0, expiry_date: null });
  await h.purchase(5, { purchaseId: id, lineId });
  assert.equal(h.state().products[0].quantity, 10);
  await h.purchase(7, { purchaseId: id, lineId });
  assert.equal(h.state().products[0].quantity, 12);
  assert.equal(h.state().purchaseItems[0].stock_received_qty, 2);
});

test("an unidentified historical purchase can link to a product without receiving twice", async () => {
  const h = harness(); const id = randomUUID(), lineId = randomUUID();
  h.state().purchases.push({ id, po_number: "PO001", supplier_id: h.supplierId, amount_paid: 0 });
  h.state().purchaseItems.push({ id: lineId, purchase_order_id: id, product_id: null, description: "Sign",
    qty: 5, rate: 100, amount: 500, stock_received_qty: 0, expiry_date: null });
  assert.equal((await h.purchase(5, { purchaseId: id, lineId })).status, 200);
  assert.equal(h.state().products[0].quantity, 10);
  assert.equal(h.state().purchaseItems[0].product_id, h.productId);
});

test("supplier module grants allow receiving stock without granting product management", async () => {
  const h = harness({ role: "sub_user", modules: ["supplier"], is_active: true });
  assert.equal((await h.purchase(4)).status, 200);
  assert.equal((await h.call({ table: "products", operation: "update", data: { quantity: 100 } })).status, 403);
});

test("direct purchase item and batch writes cannot bypass stock accounting", async () => {
  const h = harness();
  assert.equal((await h.call({ table: "purchase_order_items", operation: "insert", data: { qty: 4 } })).status, 400);
  assert.equal((await h.call({ table: "stock_batches", operation: "delete", filters: [] })).status, 400);
  assert.equal(h.state().products[0].quantity, 10);
});

test("non-expiring stock follows the same purchase FIFO order", async () => {
  const h = harness(undefined, 0);
  await h.purchase(2, { expiryDate: null, date: "2026-01-01" });
  await h.purchase(3, { expiryDate: "2026-11-01", date: "2026-02-01" });
  assert.equal(h.state().products[0].expiry_date, null);
  await h.save(3);
  assert.deepEqual(h.state().batches.map(batch => batch.remaining_qty), [0, 2]);
  assert.equal(h.state().products[0].expiry_date.toISOString().slice(0, 10), "2026-11-01");
});

test("changing a newer batch expiry preserves the older batch's expiry", async () => {
  const h = harness(); const created = await h.purchase(4);
  await h.purchase(4, { purchaseId: created.body.data.id, lineId: h.state().purchaseItems[0].id, expiryDate: "2028-01-01" });
  assert.equal(h.state().batches[0].expiry_date.toISOString().slice(0, 10), "2027-12-31");
  assert.equal(h.state().batches[1].expiry_date.toISOString().slice(0, 10), "2028-01-01");
  await h.save(10);
  assert.equal(h.state().products[0].expiry_date.toISOString().slice(0, 10), "2028-01-01");
});

test("unused opening stock can be cancelled; purchased products retain history", async () => {
  const h = harness();
  assert.equal((await h.call({ table: "products", operation: "delete", filters: [{ type: "eq", col: "id", val: h.productId }] })).status, 200);
  assert.equal(h.state().batches.length, 0);
  assert.equal(h.state().products.length, 0);
  const purchased = harness(); await purchased.purchase(3);
  assert.equal((await purchased.call({ table: "products", operation: "delete", filters: [{ type: "eq", col: "id", val: purchased.productId }] })).status, 400);
  assert.equal(purchased.state().products.length, 1);
});

test("returns from pre-batch sales retain the opening expiry after newer stock is received", async () => {
  const h = harness(); await h.purchase(4, { expiryDate: "2027-01-01" });
  await h.save(10); // The original opening batch is now empty.
  const id = randomUUID();
  h.state().invoices.push({ id, client_name: "Test", invoice_number: "OLD", grand_total: 300 });
  h.state().invoiceItems.push({ id: randomUUID(), invoice_id: id, product_id: h.productId, qty: 3, stock_deducted_qty: 3 });
  await h.call({ table: "invoices", operation: "delete", filters: [{ type: "eq", col: "id", val: id }] });
  assert.equal(h.state().batches[0].remaining_qty, 3);
  assert.equal(h.state().batches[0].expiry_date.toISOString().slice(0, 10), "2027-12-31");
  assert.equal(h.state().products[0].expiry_date.toISOString().slice(0, 10), "2027-12-31");
  assert.equal(h.state().products[0].quantity, 7);
});
