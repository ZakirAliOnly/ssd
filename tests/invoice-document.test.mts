import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceDocument, SalesInvoiceDocument, documentNumber } from '../components/InvoiceDocument';
import { PurchaseOrderPdfDocument } from '../components/PurchaseOrderPdfDocument';

const invoice = { invoice_number: 'SSD-019', invoice_date: '2026-10-23', client_name: 'Test customer',
  grand_total: 178.2, amount_received: 50, previous_balance: 20, discount_amount: 19.8 };
const items = [{ category: 'Diagnostic product', description: 'One packet contains 10 pieces', qty: 2, unit: 'packet', rate: 110, amount: 198, discount_pct: 10 }];

test('party invoices retain line and invoice discounts and the exact saved balance', () => {
  const html = renderToStaticMarkup(createElement(SalesInvoiceDocument, { invoice, items }));
  assert.match(html, /Product discounts/); assert.match(html, /Invoice discount/);
  assert.match(html, /Subtotal before discounts/); assert.match(html, /220/);
  assert.match(html, /New bill \(PKR\)/); assert.match(html, /178.2/); assert.match(html, /148.2/);
  assert.match(html, /<small>Packet<\/small>/); assert.doesNotMatch(html, /\bRs\b/);
  assert.match(html, /data-page-number/); assert.match(html, /23 Oct 2026/);
});
test('walk-in invoices use the shared template and preserve historical per-unit rates', () => {
  const html = renderToStaticMarkup(createElement(SalesInvoiceDocument, { invoice, items: [{category:'Legacy product',qty:2,rate:1,amount:50}],walkIn:true }));
  assert.match(html, /Walk-in invoice/); assert.match(html, /invoice-number">25</);
  assert.match(html, /S.S. DIAGNOSTICS/); assert.match(html, /AddsMint.com/); assert.doesNotMatch(html, /\bRs\b/);
});
test('purchase invoices retain expiry, pack unit, amounts and supplier identity', () => {
  const html = renderToStaticMarkup(createElement(PurchaseOrderPdfDocument, {data:{po:{po_number:'PO-019',supplier_name:'Test supplier',supplier_phone:'03000000000',order_date:'2026-10-23',payment_status:'partial',grand_total:200,amount_paid:50,balance_due:150,payment_method:'Cash',notes:'Storage instructions'},items:[{description:'Reagent',qty:1,unit:'box',expiry_date:'2027-01-01',rate:200,amount:200}]}}));
  assert.match(html, /PO-019/);assert.match(html, /Test supplier/);assert.match(html, /1 Jan 2027/);
  assert.match(html, /Payment method: Cash/);assert.match(html, /Status: partial/);assert.match(html, /<small>Box<\/small>/);assert.match(html, /Remaining/);assert.match(html, /150/);assert.doesNotMatch(html, /\bRs\b/);
});
test('return documents keep original invoice references and credit-only wording', () => {
  for(const title of ['Sales return','Supplier return']) {
    const html=renderToStaticMarkup(createElement(InvoiceDocument,{data:{title,returnDocument:true,number:'RETURN-019',reference:'SSD-019',date:'2026-10-23',party:'Test',lines:[{product:'Returned item',qty:1,amount:20}],totals:[{label:'Total credit (PKR)',value:20}]}}));
    assert.match(html,/Original invoice \/ PO: SSD-019/);assert.match(html,/No cash refund recorded/);assert.match(html,/Credit amount/);assert.doesNotMatch(html,/\bRs\b/);
  }
});
test('numeric rate and amount formatting keeps decimals without a currency prefix', () => {
  assert.equal(documentNumber(178.2),'178.2');assert.equal(documentNumber(13365),'13,365');assert.equal(documentNumber(0),'0');
});

test('invoice totals put discounts before bill, received, previous and total', () => {
  const html=renderToStaticMarkup(createElement(SalesInvoiceDocument,{invoice,items}));
  const labels=['Product discounts','New bill (PKR)','Received amount','Previous balance','Total balance'];
  for(let i=1;i<labels.length;i++)assert.ok(html.indexOf(labels[i-1])<html.indexOf(labels[i]));
});
test('live party print states its balance basis and matches the ledger closing', () => {
  const html=renderToStaticMarkup(createElement(SalesInvoiceDocument,{invoice:{...invoice,grand_total:28950,amount_received:0,previous_balance:127250},items,partyBalance:{closing:128950,asOf:'23 Oct 2026 12:00'}}));
  assert.match(html,/128,950/);assert.match(html,/100,000/);assert.doesNotMatch(html,/156,200/);
  assert.match(html,/Previous \/ other balance/);assert.match(html,/Other balance includes later transactions/);
});
