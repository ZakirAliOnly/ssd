import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/inventory-harness.mjs";
const remove = (h, id) => h.call({ table: "purchase_orders", operation: "delete", filters: [{ type: "eq", col: "id", val: id }] });
test("admin deletes an unused purchase and reverses only its stock", async () => {
  const h = harness(undefined, 2);
  const purchase = await h.purchase(5);
  assert.equal((await remove(h, purchase.body.data.id)).status, 200);
  assert.equal(h.state().products[0].quantity, 2);
  assert.equal(h.state().purchases.length, 0);
  assert.equal(h.state().purchaseItems.length, 0);
  assert.equal(h.state().batches.length, 1);
  assert.equal(h.state().activity.at(-1).action, "delete");
});
test("paid purchases and sold stock cannot be deleted", async () => {
  for (const paid of [0, 100]) {
    const h = harness(undefined, 0);
    const purchase = await h.purchase(5, { paid });
    if (!paid) await h.save(1);
    const before = structuredClone(h.state());
    assert.equal((await remove(h, purchase.body.data.id)).status, 400);
    assert.deepEqual(h.state(), before);
  }
});
test("sub-user deletion is rejected before transactions", async () => {
  const h = harness({ role: "sub_user", modules: ["supplier"], is_active: true });
  assert.equal((await remove(h, h.supplierId)).status, 403);
  assert.equal(h.transactions(), 0);
});
