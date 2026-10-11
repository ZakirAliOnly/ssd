import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCategory, normalizeProduct, ProductValidationError } from "../lib/productValidation.ts";

test("category identity ignores case and extra whitespace", () => {
  assert.deepEqual(normalizeCategory({ name: "  Outdoor   Signs  " }), { name: "Outdoor Signs", name_key: "outdoor signs" });
  assert.equal(normalizeCategory({ name: "OUTDOOR signs", name_key: "spoof" }).name_key, "outdoor signs");
});

test("category names cannot be blank or exceed the form limit", () => {
  for (const name of ["", "   ", "a".repeat(101), null]) {
    assert.throws(() => normalizeCategory({ name }), ProductValidationError);
  }
});

test("products require a category on creation, including legacy callers", () => {
  for (const category_id of [undefined, null, "", "not-an-id"]) {
    assert.throws(() => normalizeProduct({ category_id, quantity: 0 }, true), ProductValidationError);
  }
});

test("a caller cannot create or edit a sqft product", () => {
  const category_id = "e55b082a-5bc6-4631-ae1c-2b28c55f7fa6";
  assert.equal(normalizeProduct({ category_id, quantity: 0, pricing_type: "sqft", sale_price: 200 }, true).pricing_type, "standalone");
  assert.equal(normalizeProduct({ pricing_type: "sqft" }, false).pricing_type, "standalone");
});

test("stock quantities must be nonnegative whole units", () => {
  const category_id = "e55b082a-5bc6-4631-ae1c-2b28c55f7fa6";
  for (const quantity of [-1, 1.5, NaN, Infinity, "5", null, 2147483648]) {
    assert.throws(() => normalizeProduct({ category_id, quantity }, true), ProductValidationError);
  }
  assert.equal(normalizeProduct({ category_id, quantity: 0 }, true).quantity, 0);
});

test("product stock edits require the previous quantity", () => {
  for (const data of [{ quantity: 10 }, { quantity: 0 }, { expected_quantity: 10 }]) {
    assert.throws(() => normalizeProduct(data, false), /Reload the product/);
  }
  assert.equal(normalizeProduct({ quantity: 0, expected_quantity: 10 }, false).quantity, 0);
  for (const quantity of [-1, 1.5, 2147483648]) {
    assert.throws(() => normalizeProduct({ quantity, expected_quantity: 10 }, false), ProductValidationError);
  }
});

test("expiry accepts valid calendar dates and nullable non-expiry", () => {
  assert.equal(normalizeProduct({ expiry_date: "2028-02-29" }, false).expiry_date, "2028-02-29");
  assert.equal(normalizeProduct({ expiry_date: null }, false).expiry_date, null);
  for (const expiry_date of ["", "2026-02-29", "2026-02-30", "2026-13-01", "2026-01-01T00:00:00Z", 123]) {
    assert.throws(() => normalizeProduct({ expiry_date }, false), ProductValidationError);
  }
});

test("partial updates preserve category; explicit invalid assignments fail", () => {
  assert.deepEqual(normalizeProduct({ sale_price: 400 }, false), { sale_price: 400, pricing_type: "standalone" });
  assert.throws(() => normalizeProduct({ category_id: null }, false), ProductValidationError);
});
