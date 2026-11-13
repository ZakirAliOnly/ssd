// Same-name regression with real PostgreSQL, synthetic AS Enterprises records.
import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {NextRequest} from 'next/server.js';
import {tsLoader} from '../helpers/load-ts.mjs';
const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
const schema='owners_'+randomUUID().replaceAll('-','');url.searchParams.set('schema',schema);
const db=new PrismaClient({datasources:{db:{url:url.toString()}}}),userId=randomUUID();
const load=tsLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>({sub:userId,email:'test@example.invalid',full_name:'Test'})}},{serverOnly:true});
const overview=load('app/api/accounts/overview/route.ts'),supplierApi=load('app/api/suppliers/ledger/route.ts');
const {settlePartyInvoices}=load('lib/partyInvoiceSettlement.ts');
let party,supplier,purchase,invoice,receipt,payment;
async function get(route,path){const r=await route.GET(new NextRequest('http://localhost'+path,{headers:{cookie:'auth=test'}}));return {status:r.status,...await r.json()}}
async function partyResult(){const r=await get(overview,'/api/accounts/overview?party='+encodeURIComponent(party.name));assert.equal(r.status,200,JSON.stringify(r));return r}
async function vendorResult(){const r=await get(supplierApi,'/api/suppliers/ledger?id='+supplier.id);assert.equal(r.status,200,JSON.stringify(r));return r}
const sum=rows=>rows.reduce((n,r)=>n+r.debit-r.credit,0);
describe('Separate same-name party and supplier ledgers',()=>{
 before(async()=>{execFileSync('./node_modules/.bin/prisma',['db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});await db.user.create({data:{id:userId,email:'test@example.invalid',password_hash:'unused',role:'super_admin'}})});
 after(async()=>{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect()});
 beforeEach(async()=>{
  await db.$executeRawUnsafe('TRUNCATE accounts, suppliers, invoices, cashbook, activity_log CASCADE');await db.user.update({where:{id:userId},data:{role:'super_admin',is_active:true,modules:[]}});
  party=await db.account.create({data:{name:'AS Enterprises',type:'Customer',balance:9000,bal_type:'credit'}});
  supplier=await db.supplier.create({data:{name:'AS Enterprises',opening_balance:0}});
  invoice=await db.invoice.create({data:{invoice_number:'SALE-1',client_name:party.name,is_walk_in:false,invoice_date:new Date('2026-11-01'),subtotal:10000,grand_total:10000,amount_received:1000,balance_due:9000,payment_status:'partial'}});
  purchase=await db.purchaseOrder.create({data:{po_number:'PO-1',supplier_id:supplier.id,supplier_name:supplier.name,order_date:new Date('2026-11-01'),subtotal:5000,grand_total:5000,amount_paid:2500,balance_due:2500,payment_status:'partial'}});
  receipt=await db.cashbook.create({data:{account_name:party.name,type:'in',amount:1000,method:'Cash',description:'Payment received from AS Enterprises',reference:invoice.id,date:new Date('2026-11-01')}});
  payment=await db.cashbook.create({data:{account_name:supplier.name,type:'out',amount:2500,method:'Cash',description:'Cheque 42 (custom description)',reference:supplier.id,date:new Date('2026-11-01')}});
  await db.purchaseOrder.update({where:{id:purchase.id},data:{cashbook_entry_id:payment.id}});
 });
 test('party overview and ledger exclude the supplier payment with an arbitrary description',async()=>{
  const r=await partyResult();assert.equal(r.balances[party.id],9000);assert.deepEqual(r.cashbook.map(c=>c.id),[receipt.id]);
  const all=await get(overview,'/api/accounts/overview');assert.equal(all.balances[party.id],9000);
 });
 test('supplier screen uses report rules and excludes the party receipt',async()=>{
  const r=await vendorResult();assert.equal(r.closing,2500);assert.equal(sum(r.rows),2500);assert.ok(!r.rows.some(row=>row.desc.includes('Payment received')));assert.equal(r.rows.filter(row=>row.credit===2500).length,1);assert.equal(r.warning,null);
 });
 test('purchase references and linked payment ids are excluded even without supplier wording',async()=>{
  await db.cashbook.update({where:{id:payment.id},data:{reference:purchase.id}});assert.equal((await partyResult()).balances[party.id],9000);
  await db.cashbook.update({where:{id:payment.id},data:{reference:''}});assert.equal((await partyResult()).balances[party.id],9000);assert.equal((await vendorResult()).closing,2500);
 });
 test('linked supplier history survives a renamed supplier without name-only matching',async()=>{
  await db.supplier.update({where:{id:supplier.id},data:{name:'AS Supplier Renamed'}});
  const r=await vendorResult();assert.equal(r.closing,2500);assert.equal(r.rows.filter(row=>row.credit===2500).length,1);assert.equal((await partyResult()).balances[party.id],9000);
 });
 test('supplier returns, reversals and refunds never affect same-name party balances',async()=>{
  await db.cashbook.createMany({data:[{account_name:supplier.name,type:'out',amount:200,method:'Adjustment',description:'Supplier return PO-1',reference:supplier.id,date:new Date('2026-11-02')},{account_name:supplier.name,type:'in',amount:200,method:'Adjustment',description:'Supplier return reversal',reference:supplier.id,date:new Date('2026-11-03')},{account_name:supplier.name,type:'in',amount:100,method:'Cash',description:'Supplier refund',reference:supplier.id,date:new Date('2026-11-04')}]});
  assert.equal((await partyResult()).balances[party.id],9000);assert.equal((await vendorResult()).closing,2600);
 });
 test('party return credits and opening adjustments stay out of supplier history',async()=>{
  await db.cashbook.createMany({data:[{account_name:party.name,type:'out',amount:200,method:'Adjustment',description:'Sales return SALE-1',reference:randomUUID(),date:new Date('2026-11-02')},{account_name:party.name,type:'in',amount:100,method:'Cash',description:'Opening balance — AS Enterprises',reference:'',date:new Date('2026-11-01')}]});
  assert.equal((await partyResult()).balances[party.id],8900);assert.equal((await vendorResult()).closing,2500);
 });
 test('ambiguous unlabelled history is flagged for review rather than put on the supplier ledger',async()=>{
  await db.cashbook.create({data:{account_name:party.name,type:'in',amount:50,method:'Cash',description:'Unlinked legacy receipt',reference:'',date:new Date('2026-11-01')}});
  const r=await vendorResult();assert.equal(r.closing,2500);assert.ok(r.warning);
 });
 test('party settlement and its displayed balance agree after mixed-role payments',async()=>{
  await db.$transaction(tx=>settlePartyInvoices(tx,party.name));assert.equal(Number((await db.invoice.findUniqueOrThrow({where:{id:invoice.id}})).balance_due),9000);assert.equal((await partyResult()).balances[party.id],9000);
 });
 test('reading either ledger never edits cash or produces double-counted transactions',async()=>{
  const before=JSON.stringify(await db.cashbook.findMany({orderBy:{id:'asc'}}));await partyResult();await vendorResult();await vendorResult();assert.equal(JSON.stringify(await db.cashbook.findMany({orderBy:{id:'asc'}})),before);
 });
 test('current module grants and disabled users protect the new supplier endpoint',async()=>{
  await db.user.update({where:{id:userId},data:{role:'sub_user',modules:['accounts']}});assert.equal((await get(supplierApi,'/api/suppliers/ledger?id='+supplier.id)).status,403);assert.equal((await partyResult()).balances[party.id],9000);
  await db.user.update({where:{id:userId},data:{modules:['supplier']}});assert.equal((await get(overview,'/api/accounts/overview')).status,403);assert.equal((await vendorResult()).closing,2500);
  await db.user.update({where:{id:userId},data:{is_active:false}});assert.equal((await get(supplierApi,'/api/suppliers/ledger?id='+supplier.id)).status,403);
 });
 test('invalid and unknown supplier ids return clear failures',async()=>{assert.equal((await get(supplierApi,'/api/suppliers/ledger?id=bad')).status,400);assert.equal((await get(supplierApi,'/api/suppliers/ledger?id='+randomUUID())).status,404)});
 test('clearly labelled legacy supplier payments stay separate even with a shared name',async()=>{
  await db.cashbook.create({data:{account_name:supplier.name,type:'out',amount:500,method:'Cash',description:'Supplier payment — AS Enterprises',reference:'',date:new Date('2026-11-02')}});
  await db.purchaseOrder.update({where:{id:purchase.id},data:{amount_paid:3000,balance_due:2000}});
  assert.equal((await partyResult()).balances[party.id],9000);assert.equal((await vendorResult()).closing,2000);
 });
 test('party payment notification balance uses owned cash only; nothing is sent externally',async()=>{
  await db.account.update({where:{id:party.id},data:{whatsapp:'923001234567'}});
  await db.whatsAppSettings.create({data:{id:1,enabled:true,received_enabled:true,phone_number_id:'synthetic-sender'}});
  const {enqueuePayment}=load('lib/whatsappOutbox.ts');await db.$transaction(tx=>enqueuePayment(tx,receipt));
  const queued=await db.whatsAppMessage.findUniqueOrThrow({where:{event_key:'payment_received:'+receipt.id}});
  assert.match(queued.body,/9,000/);assert.doesNotMatch(queued.body,/11,500/);assert.equal(queued.attempts,0);
 });
});
