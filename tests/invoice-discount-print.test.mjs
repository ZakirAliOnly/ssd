import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as pricing from "../lib/invoicePricing.ts";
import * as helpers from "../lib/helpers.ts";
const require = createRequire(import.meta.url);
function load(name) {
  const code = ts.transpileModule(readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => name === "@/lib/helpers" ? helpers : name === "@/lib/invoicePricing" ? pricing : require(name), module, module.exports);
  return module.exports[name];
}
const Summary = load("InvoiceDiscountSummary");
const Line = load("InvoiceLineDiscount");
const render = (invoice, items) => renderToStaticMarkup(createElement(Summary, { invoice, items }));
test("print has no discount fields or extra subtotal when no discount was applied", () => {
  assert.equal(render({ subtotal: 200, discount_amount: 0 }, [{ rate: 100, qty: 2, amount: 200, discount_pct: 0 }]), "");
  assert.equal(renderToStaticMarkup(createElement(Line, { line: { rate: 0, qty: 1, amount: 0, discount_pct: 10 } })), "");
});
test("product discounts print their real deducted amount and original subtotal", () => {
  const html = render({ subtotal: 180 }, [{ rate: 100, qty: 2, amount: 180, discount_pct: 10 }]);
  assert.match(html, /Subtotal before discounts/); assert.match(html, /Rs 200/);
  assert.match(html, /Product discounts/); assert.match(html, /Rs 20/);
  assert.doesNotMatch(html, /Invoice discount/);
});
test("invoice percentage and flat discounts show only the applied invoice discount", () => {
  const html = render({ subtotal: 200, discount_amount: 20, discount_type: "pct", discount_value: 10 }, [{ rate: 100, qty: 2, amount: 200 }]);
  assert.match(html, /Invoice discount \(10%\)/); assert.match(html, /Rs 20/); assert.doesNotMatch(html, /Product discounts/);
  const flat = render({ subtotal: 200, discount_amount: 15, discount_type: "flat", discount_value: 15 }, []);
  assert.match(flat, /Rs 15/); assert.doesNotMatch(flat, /%/);
});
test("combined discounts retain decimal amounts and keep the two deductions separate", () => {
  const html = render({ subtotal: 17.55, discount_amount: 1.76, discount_type: "pct", discount_value: 10 }, [{ rate: 13, qty: 1.5, amount: 17.55, discount_pct: 10 }]);
  assert.match(html, /Rs 19.5/); assert.match(html, /Product discounts/); assert.match(html, /Rs 1.95/);
  assert.match(html, /Invoice discount/); assert.match(html, /Rs 1.76/);
});
