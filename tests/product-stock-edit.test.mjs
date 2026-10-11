import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/inventory-harness.mjs";

const edit = (h, quantity, expected_quantity) => h.call({ table: "products", operation: "update",
  filters: [{ column: "id", op: "eq", value: h.productId }], data: { quantity, expected_quantity } });

test("increased product stock is available for subsequent sales", async () => {
  const h = harness();
  assert.equal((await edit(h, 15, 10)).status, 200);
  assert.equal(h.state().products[0].quantity, 15);
  assert.equal(h.state().batches.reduce((sum, b) => sum + b.remaining_qty, 0), 15);
  assert.equal((await h.save(12)).status, 200);
  assert.equal(h.state().products[0].quantity, 3);
});

test("stock can be reduced to zero while preserving sale allocations and returns", async () => {
  const h = harness();
  const sale = await h.save(3);
  assert.equal((await edit(h, 0, 7)).status, 200);
  assert.equal(h.state().products[0].quantity, 0);
  assert.equal(h.state().allocations[0].qty, 3);
  assert.equal((await h.save(1, sale.body.data.id)).status, 200);
  assert.equal(h.state().products[0].quantity, 2);
});

test("stale stock edits roll back without overwriting a sale", async () => {
  const h = harness();
  await h.save(3);
  const before = structuredClone(h.state());
  const response = await edit(h, 20, 10);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /Stock changed/);
  assert.deepEqual(h.state(), before);
});
