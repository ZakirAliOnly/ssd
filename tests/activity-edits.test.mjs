import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness } from "./helpers/inventory-harness.mjs";
import { editActivityEntry, isInternalItemDeletion } from "../lib/activityEdits.ts";

test("invoice edits record the invoice, customer and actual editor once, without deletion events", async () => {
  const h = harness({ role: "sub_user", modules: ["quick-invoice"], is_active: true });
  const saved = await h.save(2);
  assert.equal(saved.status, 200);
  const invoice = saved.body.data;
  h.state().invoices[0].created_by_name = "Original creator";
  const edited = await h.save(3, invoice.id);
  assert.equal(edited.status, 200);
  const events = h.state().activity;
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "update");
  assert.equal(events[0].entity_type, "invoice");
  assert.equal(events[0].entity_id, invoice.id);
  assert.equal(events[0].title, "Invoice Edited");
  assert.equal(events[0].subtitle, `${invoice.invoice_number} — Test`);
  assert.equal(events[0].user_name, "Test");
  assert.equal(events[0].user_email, "test@example.com");
  assert.equal(events[0].amount, 300);
  assert.equal(h.state().invoices[0].created_by_name, "Original creator");
  assert.equal(h.state().products[0].quantity, 7);
});

test("a failed invoice edit leaves neither an edit nor a deletion audit", async () => {
  const h = harness();
  const saved = await h.save(2);
  const before = structuredClone(h.state());
  assert.equal((await h.save(11, saved.body.data.id)).status, 400);
  assert.deepEqual(h.state(), before);
});

test("refreshing quick-invoice mirror items is not a business deletion", async () => {
  const h = harness();
  const qid = randomUUID();
  h.state().quickInvoiceItems.push({ id: randomUUID(), quick_invoice_id: qid, description: "1 Test", grand_total: 100 });
  const response = await h.call({ table: "quick_invoice_items", operation: "delete", filters: [{ type: "eq", col: "quick_invoice_id", val: qid }] });
  assert.equal(response.status, 200);
  assert.equal(h.state().quickInvoiceItems.length, 0);
  assert.equal(h.state().activity.length, 0);
});

test("actual invoice deletion still records a deletion after an edit", async () => {
  const h = harness();
  const invoice = (await h.save(2)).body.data;
  assert.equal((await h.save(3, invoice.id)).status, 200);
  assert.equal((await h.call({ table: "invoices", operation: "delete", filters: [{ type: "eq", col: "id", val: invoice.id }] })).status, 200);
  assert.deepEqual(h.state().activity.map(event => event.action), ["update", "delete"]);
  assert.equal(h.state().products[0].quantity, 10);
});

test("purchase invoice edit audit contains its number, supplier and editor", async () => {
  const h = harness();
  const first = await h.purchase(2);
  assert.equal(first.status, 200);
  assert.equal((await h.purchase(3, { purchaseId: first.body.data.id })).status, 200);
  const event = h.state().activity[0];
  assert.equal(event.action, "update");
  assert.equal(event.title, "Purchase Invoice Edited");
  assert.equal(event.subtitle, `${first.body.data.po_number} — Supplier`);
  assert.equal(event.user_name, "Test");
});

test("the activity screen presents edits with document and editor details and hides only mirror noise", () => {
  const row = { id: "edit", action: "update", entity_type: "invoice", title: "Invoice Edited", subtitle: "SSD481 — Saeed Hospital Kuchlak",
    amount: "2400", created_at: "2026-11-12T09:05:00Z", user_email: "office@example.invalid", user_name: "Office" };
  const event = editActivityEntry(row);
  assert.equal(event.eventType, "edit");
  assert.equal(event.title, "Invoice Edited");
  assert.equal(event.subtitle, "SSD481 — Saeed Hospital Kuchlak");
  assert.equal(event.userName, "Office");
  assert.equal(event.amount, 2400);
  assert.equal(isInternalItemDeletion({ action: "delete", entity_type: "quick_invoice_item" }), true);
  assert.equal(isInternalItemDeletion({ action: "delete", entity_type: "invoice" }), false);
  assert.equal(isInternalItemDeletion({ action: "update", entity_type: "invoice" }), false);
  assert.equal(editActivityEntry({ ...row, action: "delete" }), null);
});

test("direct invoice header edits are also audited with the customer and editor", async () => {
  const h = harness();
  const saved = (await h.save(2)).body.data;
  const response = await h.call({ table: "invoices", operation: "update", data: { job_notes: "Edited notes" }, filters: [{ type: "eq", col: "id", val: saved.id }] });
  assert.equal(response.status, 200);
  assert.equal(h.state().activity[0].title, "Invoice Edited");
  assert.equal(h.state().activity[0].subtitle, `${saved.invoice_number} — Test`);
  assert.equal(h.state().activity[0].user_name, "Test");
});
