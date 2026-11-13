import test from 'node:test';
import assert from 'node:assert/strict';
import {tsLoader} from './helpers/load-ts.mjs';
const {filterPartyCashbook,supplierCashbookMatcher}=tsLoader()('lib/cashbookOwnership.ts');
const supplier={id:'vendor'},purchase={id:'po',cashbook_entry_id:'linked'},entry=(id,reference,description)=>({id,reference,description,account_name:'AS Enterprises'});
test('supplier identity, purchase identity and linked cashbook id override shared names and arbitrary labels',()=>{
 const rows=[entry('a','vendor','Cheque'),entry('b','po','Paid'),entry('linked','','Custom note'),entry('party','sale','Received')];
 assert.deepEqual(filterPartyCashbook(rows,[supplier],[purchase],['sale']).map(r=>r.id),['party']);
});
test('known customer invoice references take precedence over fallback wording',()=>{
 const row=entry('customer','sale','Purchase invoice quoted in customer note');
 assert.deepEqual(filterPartyCashbook([row],[],[],['sale']),[row]);
});
test('reserved supplier labels cover old payments, purchase advances, returns and reversals',()=>{
 const matcher=supplierCashbookMatcher();for(const description of ['Supplier payment — AS Enterprises','Purchase invoice PO-1','Purchase order advance','Supplier return PO-1','Supplier return reversal','Supplier refund'])assert.equal(matcher(entry('old','',description)),true);
 for(const description of ['Payment received from AS Enterprises','Sales return SALE-1','Opening balance — AS Enterprises','Invoice includes purchase supplies'])assert.equal(matcher(entry('customer','',description)),false);
});
test('ownership matching normalizes UUID case/whitespace and never mutates source rows',()=>{
 const rows=[entry('a',' VENDOR ','Payment')],snapshot=structuredClone(rows);assert.deepEqual(filterPartyCashbook(rows,[{id:'vendor'}]),[]);assert.deepEqual(rows,snapshot);
});
