import test from "node:test";
import assert from "node:assert/strict";
import { planStockChange, applyStockChange, invoiceStockLines, InventoryError } from "../lib/inventory.ts";

const A = "fd1d3e31-03dd-447c-b33f-31fd5d057f26";
const B = "ff1d3e31-03dd-447c-b33f-31fd5d057f26";
const line = (product_id, qty, stock_deducted_qty = qty) => ({ product_id, qty, stock_deducted_qty });

test("multiple lines for the same product consume their combined quantities", () => {
  assert.deepEqual(planStockChange([], [line(A, 2), line(A, 3)]).deltas, [{ product_id: A, consumed: 5 }]);
});
test("saving an unchanged invoice a second time does not deduct again", () => {
  const previous = [line(A, 3)];
  assert.equal(planStockChange(previous, [line(A, 3)]).deltas[0].consumed, 0);
});
test("edits consume or restore only the difference", () => {
  assert.equal(planStockChange([line(A, 3)], [line(A, 5)]).deltas[0].consumed, 2);
  assert.equal(planStockChange([line(A, 3)], [line(A, 1)]).deltas[0].consumed, -2);
});
test("changing a product restores the old product and consumes the replacement", () => {
  assert.deepEqual(planStockChange([line(A, 3)], [line(B, 2)]).deltas, [{ product_id: A, consumed: -3 }, { product_id: B, consumed: 2 }]);
});
test("deleting an invoice restores only its recorded deductions", () => {
  assert.equal(planStockChange([line(A, 4)], []).deltas[0].consumed, -4);
  assert.equal(planStockChange([line(A, 4, 0)], []).deltas[0].consumed, 0);
});
test("historical invoices do not consume opening stock when simply reopened and saved", () => {
  const previous = [line(A, 4, 0)];
  assert.equal(planStockChange(previous, [line(A, 4)]).deltas[0].consumed, 0);
  const increased = planStockChange(previous, [line(A, 6)]);
  assert.equal(increased.deltas[0].consumed, 2);
  assert.equal(increased.lines[0].stock_deducted_qty, 2);
  assert.equal(planStockChange(increased.lines, [line(A, 4)]).deltas[0].consumed, -2);
});
test("splitting a historical line retains its opening-stock exemption", () => {
  const result = planStockChange([line(A, 4, 0)], [line(A, 3), line(A, 3)]);
  assert.equal(result.deltas[0].consumed, 2);
  assert.deepEqual(result.lines.map(row => row.stock_deducted_qty), [0, 2]);
});
test("non-product service lines do not change product stock", () => {
  assert.deepEqual(planStockChange([], [line(null, 2)]).deltas, []);
});
test("invalid quantities and item identities are rejected", () => {
  for (const qty of [0, -1, 1.555, NaN, 2147483648]) assert.throws(() => invoiceStockLines([{ product_id: A, qty }]), InventoryError);
  assert.throws(() => invoiceStockLines([{ product_id: "bad", qty: 1 }]), InventoryError);
  assert.throws(() => invoiceStockLines([null]), InventoryError);
  assert.throws(() => invoiceStockLines([]), InventoryError);
});
test("the atomic stock guard allows only one competing sale of the remaining units", async () => {
  let quantity = 5;
  let remaining = 5;
  const tx = { product: {
    async updateMany({ where, data }) {
      if (where.quantity && quantity < where.quantity.gte) return { count: 0 };
      quantity -= data.quantity.decrement;
      return { count: 1 };
    },
    async findUnique() { return { name: "Sign", quantity }; },
    async update({ data }) { quantity = data.quantity; },
  }, stockBatch: {
    async findMany() { return [{ id: A, remaining_qty: remaining, expiry_date: null }]; },
    async updateMany({ data }) { remaining -= data.remaining_qty.decrement; return { count: 1 }; },
  }, stockAllocation: { async upsert() {} } };
  const results = await Promise.allSettled([
    applyStockChange(tx, [], [line(A, 4)], A), applyStockChange(tx, [], [line(A, 4)], B),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(quantity, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.match(failure.reason.message, /Insufficient stock/);
});
