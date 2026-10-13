import test from "node:test";
import assert from "node:assert/strict";
import { invoiceLineTotal, invoiceUnitRate } from "../lib/invoicePricing.ts";
import { formatCurrency } from "../lib/helpers.ts";

test("decimal quantity and price are multiplied without rounding either input", () => {
  assert.equal(invoiceLineTotal(13.2, 13.5), 178.2);
  assert.equal(invoiceLineTotal(13.5, 13.2), 178.2);
  assert.equal(invoiceLineTotal(13.2, 1), 13.2);
  assert.equal(formatCurrency(13.5), "Rs 13.5");
  assert.equal(formatCurrency(13.2), "Rs 13.2");
  assert.equal(formatCurrency(178.2), "Rs 178.2");
});

test("new invoice totals use price times quantity", () => {
  assert.equal(invoiceLineTotal(125.5, 4), 502);
  assert.equal(invoiceLineTotal(0, 3), 0);
});
test("product discounts reduce line totals and preserve original rates when reopened", () => {
  assert.equal(invoiceLineTotal(125.5, 4, 10), 451.8);
  const saved = { rate: 125.5, qty: 4, amount: 451.8, discount_pct: 10 };
  assert.equal(invoiceUnitRate(saved), 125.5);
  assert.equal(invoiceLineTotal(invoiceUnitRate(saved), saved.qty, saved.discount_pct), saved.amount);
  assert.equal(invoiceLineTotal(100, 2, 100), 0);
  assert.equal(invoiceUnitRate({ rate: 100, qty: 2, amount: 0, discount_pct: 100 }), 100);
});

test("historical area-priced invoices retain their amounts as unit-priced lines", () => {
  const oldLine = { rate: 2, qty: 3, amount: 300 };
  assert.equal(invoiceUnitRate(oldLine), 100);
  assert.equal(invoiceLineTotal(invoiceUnitRate(oldLine), oldLine.qty), 300);
  assert.equal(invoiceLineTotal(invoiceUnitRate(oldLine), 4), 400);
});

test("historical fractional totals survive reopening and rounding of saved rates", () => {
  const saved = { rate: 33.33, qty: 3, amount: 100 };
  assert.equal(invoiceLineTotal(invoiceUnitRate(saved), saved.qty), 100);
  assert.equal(invoiceLineTotal(invoiceUnitRate({ ...saved, amount: "100" }), 3), 100);
});

test("recorded zero-value lines stay free and unsaved lines use their entered rate", () => {
  assert.equal(invoiceUnitRate({ rate: 200, qty: 3, amount: 0 }), 0);
  assert.equal(invoiceUnitRate({ rate: 200, qty: 3 }), 200);
  assert.equal(invoiceUnitRate({ rate: 200, qty: 3, total: 600 }), 200);
});
