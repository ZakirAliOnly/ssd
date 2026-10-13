import test from "node:test";
import assert from "node:assert/strict";
import { buildStockReport, stockSaleRevenue } from "../lib/stockReport.ts";

const product = {
  id: "p1", code: "1", name: "Vinyl", category: "Print", created_at: "2026-01-01", cost_price: 12,
  batches: [
    { received_date: "2026-01-01", received_qty: 10, remaining_qty: 5,
      allocations: [{ date: "2026-01-31", qty: 2, cost: 8 }, { date: "2026-02-01", qty: 3, cost: 8 }] },
    { received_date: "2026-02-28", received_qty: 5, remaining_qty: 3,
      allocations: [{ date: "2026-03-01", qty: 2, cost: 10 }] },
  ],
  sales: [{ date: "2026-01-31", qty: 2, deducted: 2, revenue: 40 },
    { date: "2026-02-01", qty: 3, deducted: 3, revenue: 54 },
    { date: "2026-03-01", qty: 2, deducted: 2, revenue: 40 }],
};
test("opening, receipts, sales and closing use inclusive invoice and receipt dates", () => {
  const [r] = buildStockReport([product], "2026-02-01", "2026-02-28");
  assert.equal(r.opening, 8); assert.equal(r.received, 5); assert.equal(r.sold, 3);
  assert.equal(r.available, 10); assert.equal(r.revenue, 54); assert.equal(r.cost, 24);
  assert.equal(r.profit, 30); assert.equal(r.warning, null);
});
test("single day includes both receipts and sales on that day", () => {
  const [r] = buildStockReport([product], "2026-02-01", "2026-02-01");
  assert.equal(r.opening, 8); assert.equal(r.received, 0); assert.equal(r.available, 5);
});

test("stock report carries product descriptions and handles missing descriptions", () => {
  const rows = buildStockReport([{ ...product, description: "Outdoor printing vinyl" }, { ...product, id: "p2", description: null }], "2026-02-01", "2026-02-28");
  assert.equal(rows[0].description, "Outdoor printing vinyl");
  assert.equal(rows[1].description, "");
});
test("undated manual stock reductions never create invented historical balances", () => {
  const changed = { ...product, batches: [{ ...product.batches[0], remaining_qty: 4 }, product.batches[1]] };
  const [r] = buildStockReport([changed], "2026-02-01", "2026-02-28");
  assert.equal(r.opening, null); assert.equal(r.available, null); assert.ok(r.warning);
});
test("legacy sales use fallback cost and flag missing balance history", () => {
  const [r] = buildStockReport([{ ...product, sales: [{ date: "2026-02-01", qty: 3, deducted: 0, revenue: 54 }], batches: [] }], "2026-02-01", "2026-02-28");
  assert.equal(r.cost, 36); assert.equal(r.profit, 18); assert.equal(r.available, null);
});
test("missing earlier allocations also flag opening balances", () => {
  const changed = { ...product, batches: product.batches.map(b => ({ ...b, allocations: b.allocations.filter(a => a.date >= "2026-02-01"), received_qty: b.received_qty - 2 })) };
  assert.ok(buildStockReport([changed], "2026-02-01", "2026-02-28")[0].warning);
});
test("future products are excluded and empty categories produce no rows", () => {
  assert.deepEqual(buildStockReport([{ ...product, created_at: "2026-04-01" }], "2026-02-01", "2026-02-28"), []);
  assert.deepEqual(buildStockReport([], "2026-02-01", "2026-02-28"), []);
});
test("invoice discounts are proportional across categories and never produce negative revenue", () => {
  assert.equal(stockSaleRevenue(60, 100, 10), 54);
  assert.equal(stockSaleRevenue(40, 100, 10), 36);
  assert.equal(stockSaleRevenue(60, 100, 200), 0);
  assert.equal(stockSaleRevenue(0, 0, 0), 0);
});
