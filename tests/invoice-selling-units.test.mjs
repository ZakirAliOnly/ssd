import test from "node:test";
import assert from "node:assert/strict";
import { productUnits, unitSalePrice } from "../lib/productUnits.ts";
import { invoiceLineTotal } from "../lib/invoicePricing.ts";

const product = { packaging_enabled: true, base_unit: "Piece", pieces_per_packet: 12, packets_per_box: 1, sale_price: 10, packet_sale_price: 110 };

test("selling pieces and packets uses each unit price and physical size", () => {
  for (const [unit, rate, factor, total] of [["piece", 10, 1, 30], ["packet", 110, 12, 330]]) {
    assert.equal(unitSalePrice(product, unit), rate);
    assert.equal(productUnits(product).find(row => row.value === unit).factor, factor);
    assert.equal(invoiceLineTotal(unitSalePrice(product, unit), 3), total);
  }
  assert.equal(invoiceLineTotal(unitSalePrice(product, "packet"), 3, 10), 297);
});

test("packet rates fall back to piece rate times size", () => {
  assert.equal(unitSalePrice({ ...product, packet_sale_price: 0 }, "packet"), 120);
});

test("one-piece packets remain selectable and keep their own price", () => {
  const single = { ...product, pieces_per_packet: 1, packet_sale_price: 9 };
  assert.equal(productUnits(single).find(row => row.value === "packet").factor, 1);
  assert.equal(invoiceLineTotal(unitSalePrice(single, "packet"), 2), 18);
});

test("ordinary products and legacy boxes retain their units", () => {
  assert.deepEqual(productUnits({ packaging_enabled: false }), [{ value: "unit", label: "Unit", factor: 1 }]);
  const boxed = { ...product, packets_per_box: 5, box_sale_price: 500 };
  assert.equal(productUnits(boxed).find(row => row.value === "box").factor, 60);
  assert.equal(invoiceLineTotal(unitSalePrice(boxed, "box"), 2), 1000);
});
