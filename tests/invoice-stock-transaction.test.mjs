import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/inventory-harness.mjs";

test("decimal sales preserve exact stock across repeated saves, edits and deletion", async () => {
  const h = harness(undefined, 20);
  const saved = await h.save(13.5, undefined, 178.2);
  assert.equal(saved.status, 200);
  const id = saved.body.data.id;
  assert.equal(h.state().invoiceItems[0].qty, 13.5);
  assert.equal(h.state().products[0].quantity, 6.5);
  assert.equal((await h.save(13.5, id, 178.2)).status, 200);
  assert.equal(h.state().products[0].quantity, 6.5);
  assert.equal((await h.save(13.2, id, 174.24)).status, 200);
  assert.equal(h.state().products[0].quantity, 6.8);
  assert.equal((await h.call({ table: "invoices", operation: "delete", filters: [{ column: "id", op: "eq", value: id }] })).status, 200);
  assert.equal(h.state().products[0].quantity, 20);
});

test("invoice line discounts persist through saves without changing quantity consumption", async () => {
  const h = harness();
  const result = await h.call({ table: "invoices", operation: "save_invoice", data: { invoice_number: "discount-test", client_name: "Client", grand_total: 180 },
    items: [{ product_id: h.productId, qty: 2, rate: 100, amount: 180, discount_pct: 10 }] });
  assert.equal(result.status, 200);
  assert.equal(h.state().invoiceItems[0].discount_pct, 10);
  assert.equal(h.state().invoiceItems[0].amount, 180);
  assert.equal(h.state().products[0].quantity, 8);
});

test("invalid line discounts are rejected before writing invoices or consuming stock", async () => {
  for (const discount_pct of [-1, 101, "invalid"]) {
    const h = harness();
    const result = await h.call({ table: "invoices", operation: "save_invoice", data: { client_name: "Client" }, items: [{ product_id: h.productId, qty: 2, rate: 100, amount: 180, discount_pct }] });
    assert.equal(result.status, 400);
    assert.equal(h.state().products[0].quantity, 10);
    assert.equal(h.state().invoices.length, 0);
  }
});

test("unassigned modules reject direct API requests before transactions", async () => {
  const h = harness({ role: "sub_user", modules: ["products"], is_active: true });
  assert.equal((await h.save(3)).status, 403);
  assert.equal(h.transactions(), 0);
  assert.equal(h.state().products[0].quantity, 10);
});

test("granted invoice access still performs automatic stock adjustments", async () => {
  const h = harness({ role: "sub_user", modules: ["quick-invoice"], is_active: true });
  assert.equal((await h.save(3)).status, 200);
  assert.equal(h.state().products[0].quantity, 7);
});

test("inactive or deleted users cannot use an existing token", async () => {
  for (const profile of [null, { role: "super_admin", modules: [], is_active: false }]) {
    const h = harness(profile);
    assert.equal((await h.save(3)).status, 401);
    assert.equal(h.transactions(), 0);
  }
});

test("relation reads and nested writes cannot bypass module grants", async () => {
  const h = harness({ role: "sub_user", modules: ["products"], is_active: true });
  assert.equal((await h.call({ table: "products", operation: "select", select: "*,invoices(*)" })).status, 403);
  assert.equal((await h.call({ table: "products", operation: "update", data: { invoice_items: { deleteMany: {} } } })).status, 403);
});

test("invoice creation and stock deduction commit together", async () => {
  const h = harness(); const response = await h.save(3);
  assert.equal(response.status, 200);
  assert.equal(h.transactions(), 1);
  assert.equal(h.state().products[0].quantity, 7);
  assert.equal(h.state().invoiceItems[0].stock_deducted_qty, 3);
  assert.equal(h.state().invoices.length, 1);
});

test("insufficient opening stock rolls back the newly created invoice", async () => {
  const h = harness(); const response = await h.save(11);
  assert.equal(response.status, 400);
  assert.equal(h.state().invoices.length, 0);
  assert.equal(h.state().invoiceItems.length, 0);
  assert.equal(h.state().products[0].quantity, 10);
});

test("out-of-stock products reject invoice sales without saving or consuming stock", async () => {
  const h = harness(undefined, 0);
  const before = structuredClone(h.state());
  const response = await h.save(1);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /Sign is out of stock/);
  assert.deepEqual(h.state(), before);
});

test("selling the last units blocks a new invoice but allows resaving the original", async () => {
  const h = harness(undefined, 1);
  const saved = await h.save(1);
  assert.equal(saved.status, 200);
  assert.equal(h.state().products[0].quantity, 0);
  const before = structuredClone(h.state());
  const rejected = await h.save(1);
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error.message, /out of stock/);
  assert.deepEqual(h.state(), before);
  assert.equal((await h.save(1, saved.body.data.id)).status, 200);
  assert.equal(h.state().products[0].quantity, 0);
});

test("a rejected edit preserves the previous invoice, items, and stock", async () => {
  const h = harness(); const created = await h.save(3); const before = structuredClone(h.state());
  const response = await h.save(11, created.body.data.id);
  assert.equal(response.status, 400);
  assert.deepEqual(h.state(), before);
});

test("repeated saves and deletions never double-deduct or double-restore", async () => {
  const h = harness(); const created = await h.save(3); const id = created.body.data.id;
  await h.save(5, id); await h.save(5, id);
  assert.equal(h.state().products[0].quantity, 5);
  const deletion = { table: "invoices", operation: "delete", filters: [{ type: "eq", col: "id", val: id }] };
  await h.call(deletion); await h.call(deletion);
  assert.equal(h.state().products[0].quantity, 10);
  assert.equal(h.state().invoices.length, 0);
});


test("invoice numbers are assigned on save, shared across invoice types, and preserved on edit", async () => {
  const h = harness();
  const save = (data, invoiceId) => h.call({ table: "invoices", operation: "save_invoice", data, items: [{ qty: 1, rate: 10, amount: 10 }], ...(invoiceId ? { invoiceId } : {}) });
  const first = await save({ client_name: "Walk-in", is_walk_in: true, invoice_number: "SSD999" });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.invoice_number, "SSD001");
  const second = await save({ client_name: "Party", is_walk_in: false, invoice_number: "SSD999" });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.invoice_number, "SSD002");
  const edited = await save({ client_name: "Updated", invoice_number: "SSD999" }, first.body.data.id);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.invoice_number, "SSD001");
});
