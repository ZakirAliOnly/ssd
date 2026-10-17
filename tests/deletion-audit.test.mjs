import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/inventory-harness.mjs";
const remove = (h, table, id) => h.call({ table, operation: "delete", filters: [{ type: "eq", col: "id", val: id }] });
test("invoice deletion records identity, reference and amount exactly once", async () => {
 const h = harness(); const sale = await h.save(2); const id = sale.body.data.id;
 assert.equal((await remove(h, "invoices", id)).status, 200);
 const logs = h.state().activity.filter(row => row.action === "delete" && row.entity_id === id);
 assert.equal(logs.length, 1); assert.equal(logs[0].entity_type, "invoice");
 assert.equal(Number(logs[0].amount), 200); assert.ok(logs[0].user_email); assert.ok(logs[0].subtitle);
 await remove(h, "invoices", id);
 assert.equal(h.state().activity.filter(row => row.action === "delete" && row.entity_id === id).length, 1);
});
test("supplier deletion uses the same transactional audit and failed deletes do not log", async () => {
 const h = harness(); assert.equal((await remove(h, "suppliers", h.supplierId)).status, 200);
 assert.equal(h.state().activity.at(-1).entity_type, "supplier");
 const p = harness(); const purchase = await p.purchase(1, { paid: 100 });
 const before = structuredClone(p.state()); assert.equal((await remove(p, "purchase_orders", purchase.body.data.id)).status, 400);
 assert.deepEqual(p.state(), before);
});
