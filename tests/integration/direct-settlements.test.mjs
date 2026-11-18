import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server.js';
import { tsLoader } from '../helpers/load-ts.mjs';
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Synthetic local database only');
const schema = 'direct_' + randomUUID().replaceAll('-', ''); url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const userId = randomUUID(); let authenticated = true;
const load = tsLoader({ '@/lib/prisma': { prisma: db }, '@/lib/auth': { COOKIE_NAME: 'auth', verifyToken: async () => authenticated ? { sub: userId, email: "admin@example.invalid", full_name: "Test Admin" } : null } }, { serverOnly: true });
const api = load('app/api/direct-settlements/route.ts'), overview = load('app/api/accounts/overview/route.ts'), supplierApi = load('app/api/suppliers/ledger/route.ts'), generic = load('app/api/db/route.ts');
const { computeMethodBalances } = tsLoader({'@/lib/db':{db:{}}})('lib/paymentMethods.ts');
let party, supplier, invoice, order;
const request = (path, body, origin = 'http://localhost') => new NextRequest('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { cookie: 'auth=test', origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function call(route, path, body, origin) { const r = await route[body ? 'POST' : 'GET'](request(path, body, origin)); return { status: r.status, ...await r.json() }; }
const post = body => call(api, '/api/direct-settlements', body);
const body = (amount = 2500) => ({ request_id: randomUUID(), customer_id: party.id, supplier_id: supplier.id, amount, date: '2026-11-01', reference: 'DIRECT-42', notes: 'Paid on our behalf' });
async function balances() {
 const p = await call(overview, '/api/accounts/overview?party=' + encodeURIComponent(party.name));
 const s = await call(supplierApi, '/api/suppliers/ledger?id=' + supplier.id);
 assert.equal(p.status,200); assert.equal(s.status,200);
 return { customer:p.balances[party.id], supplier:s.closing, warning:s.warning };
}
const cli = args => execFileSync('./node_modules/.bin/prisma', args, { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
describe('Direct customer to supplier settlements (real PostgreSQL)', () => {
 before(async () => {
  cli(['db','push','--skip-generate']);
  // Recreate the new tables using the production migration, then run it again.
  await db.$executeRawUnsafe('DROP TABLE direct_settlement_allocations, direct_settlements CASCADE');
  cli(['db','execute','--file','scripts/migration-v43-direct-settlements.sql','--schema','prisma/schema.prisma']);
  cli(['db','execute','--file','scripts/migration-v43-direct-settlements.sql','--schema','prisma/schema.prisma']);
  await db.user.create({data:{id:userId,email:'admin@example.invalid',full_name:'Test Admin',password_hash:'unused',role:'super_admin'}});
 });
 after(async () => { await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await db.$disconnect(); });
 beforeEach(async () => {
  authenticated = true;
  await db.$executeRawUnsafe('TRUNCATE accounts, suppliers, invoices, cashbook, activity_log CASCADE');
  await db.user.update({where:{id:userId},data:{role:'super_admin',is_active:true,modules:[]}});
  party = await db.account.create({data:{name:'AS Enterprises',type:'Customer',balance:9000,bal_type:'credit'}});
  supplier = await db.supplier.create({data:{name:'AS Enterprises',opening_balance:1000}});
  invoice = await db.invoice.create({data:{invoice_number:'SALE-1',client_name:party.name,invoice_date:new Date('2026-11-01'),grand_total:10000,amount_received:1000,balance_due:9000,payment_status:'partial'}});
  order = await db.purchaseOrder.create({data:{po_number:'PO-1',supplier_id:supplier.id,supplier_name:supplier.name,order_date:new Date('2026-11-01'),grand_total:5000,amount_paid:2000,balance_due:3000,payment_status:'partial'}});
  await db.cashbook.createMany({data:[{type:'in',amount:1000,date:new Date('2026-11-01'),method:'Cash',account_name:party.name,reference:invoice.id,description:'Payment received from AS Enterprises'},
   {type:'out',amount:2000,date:new Date('2026-11-01'),method:'Bank',account_name:supplier.name,reference:supplier.id,description:'Supplier payment — AS Enterprises'}]});
 });
 test('same-name roles: both ledgers reduce once and own method balances stay unchanged', async () => {
  const before = computeMethodBalances(await db.cashbook.findMany(),[]);
  const r = await post(body()); assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(await balances(),{customer:6500,supplier:1500,warning:null});
  assert.deepEqual(computeMethodBalances(await db.cashbook.findMany(),[]),before);
  assert.equal(Number((await db.invoice.findUnique({where:{id:invoice.id}})).balance_due),6500);
  const po = await db.purchaseOrder.findUnique({where:{id:order.id}}); assert.equal(Number(po.amount_paid),3500); assert.equal(Number(po.balance_due),1500);
  assert.equal(Number((await db.supplier.findUnique({where:{id:supplier.id}})).opening_balance),0);
  const saved = await db.directSettlement.findFirst({include:{allocations:true}}); assert.equal(Number(saved.opening_applied),1000); assert.equal(Number(saved.allocations[0].amount),1500);
  const history = await call(api,'/api/direct-settlements?history=1'); assert.equal(history.records.length,1);
 });
 test('retries are idempotent; changed details cannot reuse a request ID', async () => {
  const b = body(); assert.equal((await post(b)).status,200); assert.equal((await post(b)).status,200);
  assert.equal((await post({...b,amount:500})).status,400); assert.equal(await db.directSettlement.count(),1); assert.equal(await db.cashbook.count(),4);
 });
 test('overpayment of either side, zero, negative, extra precision, bad IDs and future dates have no effects', async () => {
  for (const b of [body(4000.01),body(0),body(-1),body(0.001),{...body(),customer_id:randomUUID()},{...body(),date:'2099-01-01'},{...body(),date:'2026-02-30'}]) assert.equal((await post(b)).status,400,JSON.stringify(b));
  await db.invoice.update({where:{id:invoice.id},data:{grand_total:1100}});assert.equal((await post(body(101))).status,400);
  assert.equal(await db.directSettlement.count(),0); assert.equal(await db.cashbook.count(),2);
 });
 test('partial and full opening-only settlements preserve the supplier original opening in reports',async()=>{
  assert.equal((await post(body(500))).status,200);assert.deepEqual(await balances(),{customer:8500,supplier:3500,warning:null});
  assert.equal((await post(body(500))).status,200);assert.deepEqual(await balances(),{customer:8000,supplier:3000,warning:null});
 });
 test('allocates oldest purchases first, includes linked legacy supplier-name purchases', async()=>{
  const old=await db.purchaseOrder.create({data:{po_number:'OLD',supplier_name:supplier.name,order_date:new Date('2026-10-01'),grand_total:1000,balance_due:1000}});
  assert.equal((await post(body(2500))).status,200);
  assert.equal(Number((await db.purchaseOrder.findUnique({where:{id:old.id}})).balance_due),0);
  assert.equal(Number((await db.purchaseOrder.findUnique({where:{id:order.id}})).balance_due),2500);
 });
 test('reversal restores both balances, allocations and invoice statuses; repeats do not duplicate',async()=>{
  const saved=await post(body()); const b={action:'reverse',id:saved.record.id,reason:'Wrong customer selected'};
  assert.equal((await post(b)).status,200); assert.equal((await post(b)).status,200);
  assert.deepEqual(await balances(),{customer:9000,supplier:4000,warning:null});
  assert.equal(Number((await db.invoice.findUnique({where:{id:invoice.id}})).balance_due),9000);
  assert.equal(Number((await db.purchaseOrder.findUnique({where:{id:order.id}})).amount_paid),2000);
  assert.equal(await db.cashbook.count(),6); assert.equal(await db.activityLog.count(),2);
  assert.equal((await post({...b,reason:''})).status,400);
 });
 test('later supplier payments are retained when an earlier settlement is reversed',async()=>{
  const saved=await post(body());
  await db.purchaseOrder.update({where:{id:order.id},data:{amount_paid:4000,balance_due:1000}});
  await db.cashbook.create({data:{type:'out',amount:500,date:new Date(),method:'Cash',account_name:supplier.name,reference:supplier.id,description:'Supplier payment — later'}});
  assert.equal((await post({action:'reverse',id:saved.record.id,reason:'Correction'})).status,200);
  assert.deepEqual(await balances(),{customer:9000,supplier:3500,warning:null});
 });
 test('concurrent overpayments cannot spend the same payable twice',async()=>{
  const result=await Promise.all([post(body(3000)),post(body(3000))]);assert.deepEqual(result.map(r=>r.status).sort(),[200,400]);
  assert.equal(await db.directSettlement.count(),1);assert.deepEqual(await balances(),{customer:6000,supplier:1000,warning:null});
 });
 test('concurrent retries and reversals create exactly one journal event',async()=>{
  const b=body(1000), results=await Promise.all([post(b),post(b)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(await db.directSettlement.count(),1);
  const reverse={action:'reverse',id:results[0].record.id,reason:'Duplicate test'};
  const reversed=await Promise.all([post(reverse),post(reverse)]);assert.deepEqual(reversed.map(r=>r.status),[200,200]);
  assert.equal(await db.cashbook.count(),6);assert.deepEqual(await balances(),{customer:9000,supplier:4000,warning:null});
 });
 test('full settlement marks purchases paid; reversing returns their previous status',async()=>{
  const r=await post(body(4000));assert.equal(r.status,200);
  assert.equal((await db.purchaseOrder.findUnique({where:{id:order.id}})).payment_status,'paid');
  assert.deepEqual(await balances(),{customer:5000,supplier:0,warning:null});
  assert.equal((await post({action:'reverse',id:r.record.id,reason:'Wrong payment'})).status,200);
  assert.equal((await db.purchaseOrder.findUnique({where:{id:order.id}})).payment_status,'partial');
 });
 test('active supplier returns reduce the maximum, while reversed returns do not',async()=>{
  await db.supplierReturn.create({data:{request_id:randomUUID(),purchase_order_id:order.id,return_date:new Date('2026-11-01'),amount:1000}});
  assert.equal((await post(body(3000.01))).status,400);
  await db.supplierReturn.updateMany({data:{reversed_at:new Date()}});
  assert.equal((await post(body(3500))).status,200);
 });
 test('unsafe changed purchase allocations block reversal without partial writes',async()=>{
  const r=await post(body());await db.purchaseOrder.update({where:{id:order.id},data:{amount_paid:100}});
  assert.equal((await post({action:'reverse',id:r.record.id,reason:'Correction'})).status,400);
  assert.equal(await db.cashbook.count(),4);assert.equal((await db.directSettlement.findUnique({where:{id:r.record.id}})).reversed_at,null);
 });
 test('duplicate party names are blocked; same-name supplier IDs remain independently owned',async()=>{
  await db.account.create({data:{name:party.name,type:'Customer'}});assert.equal((await post(body())).status,400);
  await db.account.deleteMany({where:{id:{not:party.id}}});
  const other=await db.supplier.create({data:{name:supplier.name,opening_balance:200}});
  assert.equal((await post(body())).status,200);
  const s=await call(supplierApi,'/api/suppliers/ledger?id='+other.id);assert.equal(s.closing,200);
 });
 test('live admin role, disabled user and same-origin validation protect writes',async()=>{
  await db.user.update({where:{id:userId},data:{role:'sub_user',modules:['cashbook']}});
  assert.equal((await post(body())).status,403);assert.equal((await call(api,'/api/direct-settlements')).status,403);assert.equal((await call(api,'/api/direct-settlements?history=1')).status,200);
  await db.user.update({where:{id:userId},data:{role:'super_admin',is_active:false}});assert.equal((await post(body())).status,403);
  await db.user.update({where:{id:userId},data:{is_active:true}});assert.equal((await call(api,'/api/direct-settlements',body(),'https://evil.invalid')).status,403);
  authenticated=false;assert.equal((await call(api,'/api/direct-settlements')).status,401);
 });
 test('HTTPS proxy origin is accepted only with preserved Host and overwritten protocol',async()=>{
  const req=new NextRequest('http://localhost/api/direct-settlements',{method:'POST',headers:{cookie:'auth=test',host:'ssd.example.invalid','x-forwarded-proto':'https',origin:'https://ssd.example.invalid','content-type':'application/json'},body:JSON.stringify(body())});
  const response=await api.POST(req);assert.equal(response.status,200,JSON.stringify(await response.json()));
  const cross=new NextRequest('http://localhost/api/direct-settlements',{method:'POST',headers:{cookie:'auth=test','sec-fetch-site':'cross-site','content-type':'application/json'},body:JSON.stringify(body())});
  assert.equal((await api.POST(cross)).status,403);
 });
 test('linked cashbook entries cannot be edited or deleted through the generic API',async()=>{
  const saved=await post(body());
  for(const operation of ['update','delete']) {
   const r=await call(generic,'/api/db',{table:'cashbook',operation,filters:[{col:'id',op:'eq',value:saved.record.customer_entry_id}],data:{amount:5}});
   assert.equal(r.status,400,JSON.stringify(r)); assert.match(r.error.message,/protected/);
  }
 });
 test('allocation or journal failure rolls back both ledgers and all balances',async()=>{
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_direct_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fail_direct BEFORE INSERT ON direct_settlement_allocations FOR EACH ROW EXECUTE FUNCTION fail_direct_allocation()');
  try{assert.equal((await post(body())).status,500);assert.equal(await db.directSettlement.count(),0);assert.equal(await db.cashbook.count(),2);assert.deepEqual(await balances(),{customer:9000,supplier:4000,warning:null});}
  finally{await db.$executeRawUnsafe('DROP TRIGGER fail_direct ON direct_settlement_allocations');await db.$executeRawUnsafe('DROP FUNCTION fail_direct_allocation()');}
 });
 test('database constraints and foreign keys protect amounts and linked source deletion',async()=>{
  const r=await post(body());
  await assert.rejects(db.directSettlement.update({where:{id:r.record.id},data:{amount:0}}));
  await assert.rejects(db.cashbook.delete({where:{id:r.record.customer_entry_id}}));
  await assert.rejects(db.purchaseOrder.delete({where:{id:order.id}}));
  await assert.rejects(db.account.delete({where:{id:party.id}}));
 });
});
