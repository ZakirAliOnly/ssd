import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/inventory-harness.mjs";

test("product edit persists deactivation and reactivation without changing stock", async () => {
  const h = harness();
  for (const is_active of [false, true]) {
    const response = await h.call({ table: "products", operation: "update", data: { is_active }, filters: [{ type: "eq", col: "id", val: h.productId }] });
    assert.equal(response.status, 200);
    assert.equal(h.state().products[0].is_active, is_active);
    assert.equal(h.state().products[0].quantity, 10);
    const result = await h.call({ table: "products", operation: "select", select: "*" });
    assert.equal(result.body.data.length, is_active ? 1 : 0);
  }
});

test("inactive products disappear from catalog queries but management can retrieve them", async () => {
  const h = harness();
  h.state().products[0].is_active = false;
  const hidden = await h.call({ table: "products", operation: "select", select: "*" });
  assert.equal(hidden.status, 200);
  assert.deepEqual(hidden.body.data, []);
  const management = await h.call({ table: "products", operation: "select", select: "*", filters: [{ type: "in", col: "is_active", val: [true, false] }] });
  assert.equal(management.body.data.length, 1);
});

test("stale sales and purchase forms cannot save inactive products or change stock", async () => {
  for (const kind of ["sale", "purchase"]) {
    const h = harness();
    h.state().products[0].is_active = false;
    const response = kind === "sale" ? await h.save(2) : await h.purchase(2);
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /inactive/i);
    assert.equal(h.state().products[0].quantity, 10);
    assert.equal(h.state().invoices.length, 0);
    assert.equal(h.state().purchases.length, 0);
  }
});

test("reactivation restores catalog visibility and sales; history remains readable", async () => {
  const h = harness();
  h.state().products[0].is_active = true;
  const sale = await h.save(2);
  assert.equal(sale.status, 200);
  h.state().products[0].is_active = false;
  const history = await h.call({ table: "invoice_items", operation: "select", select: "*" });
  assert.equal(history.body.data.length, 1);
  h.state().products[0].is_active = true;
  const catalog = await h.call({ table: "products", operation: "select", select: "*" });
  assert.equal(catalog.body.data.length, 1);
});
