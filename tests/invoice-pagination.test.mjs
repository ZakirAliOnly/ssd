import test from 'node:test';
import assert from 'node:assert/strict';
import { tsLoader } from './helpers/load-ts.mjs';
const { paginateInvoiceRows } = tsLoader()('lib/invoicePagination.ts');

test('overflowing totals move one final product, not most of a nearly full page', () => {
  const pages = paginateInvoiceRows(Array(14).fill(35), 500, 190);
  assert.deepEqual(pages.map(page => page.length), [13, 1]);
  assert.deepEqual(pages.flat(), Array.from({ length: 14 }, (_, i) => i));
});

test('products and totals stay together whenever they fit, including an exact fit', () => {
  assert.deepEqual(paginateInvoiceRows(Array(14).fill(20), 500, 190).map(page => page.length), [14]);
  assert.deepEqual(paginateInvoiceRows(Array(10).fill(30), 500, 200).map(page => page.length), [10]);
});

test('long invoices fill earlier sheets and keep products in their original order', () => {
  const heights = Array(30).fill(35);
  const pages = paginateInvoiceRows(heights, 500, 190);
  assert.deepEqual(pages.map(page => page.length), [14, 14, 2]);
  assert.deepEqual(pages.flat(), Array.from({ length: 30 }, (_, i) => i));
  pages.forEach((page, i) => assert.ok(page.reduce((sum, row) => sum + heights[row], 0) + (i === pages.length - 1 ? 190 : 0) <= 500));
});

test('a tall row gets a totals-only continuation without being lost or overflowing', () => {
  assert.deepEqual(paginateInvoiceRows([450], 500, 100), [[0], []]);
  assert.deepEqual(paginateInvoiceRows([], 500, 100), [[]]);
});
