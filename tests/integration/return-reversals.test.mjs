import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server.js';
import { tsLoader } from '../helpers/load-ts.mjs';
const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
const schema='reverse_'+randomUUID().replaceAll('-','');url.searchParams.set('schema',schema);
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const actorId=randomUUID();let product,supplier;
const load=tsLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>({sub:actorId,email:'admin@example.invalid',full_name:'Admin'})}},{serverOnly:true});
const api=load('app/api/db/route.ts'),returns=load('app/api/returns/route.ts'),reverse=load('app/api/returns/reverse/route.ts'),period=load('app/api/returns/period/route.ts'),history=load('app/api/returns/history/route.ts'),report=load('app/api/reports/stock/route.ts');
function req(path,body,method='POST'){return new NextRequest('http://localhost'+path,{method,headers:{cookie:'auth=yes','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function invoke(route,path,body,method='POST'){const r=await route[method](req(path,body,method));return {status:r.status,body:await r.json()}}
async function ok(route,path,body,method){const r=await invoke(route,path,body,method);assert.equal(r.status,200,JSON.stringify(r));assert.ok(!r.body.error,JSON.stringify(r));return r.body}
const qty=async()=>Number((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantity);
async function sell(n=4,walkin=false){return (await ok(api,'/api/db',{table:'invoices',operation:'save_invoice',data:{client_name:'Test party',is_walk_in:walkin,invoice_date:'2026-10-01',subtotal:n*100,grand_total:n*100,balance_due:n*100},items:[{product_id:product.id,category:product.name,qty:n,rate:100,amount:n*100}]})).data}
async function purchase(n=4){return (await ok(api,'/api/db',{table:'purchase_orders',operation:'save_purchase',requestId:randomUUID(),data:{supplier_id:supplier.id,order_date:'2026-10-01'},items:[{product_id:product.id,qty:n,rate:100,expiry_date:null}]})).data}
async function makeReturn(invoiceId,lineId,n,type='sales'){return (await ok(returns,'/api/returns',{type,invoiceId,requestId:randomUUID(),date:'2026-10-02',reason:'Wrong invoice',selections:[{invoice_item_id:lineId,qty:n}]})).record}
async function saleReturn(n=4,walkin=false){const inv=await sell(n,walkin);const line=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});const record=await makeReturn(inv.id,line.id,n);return {inv,line,record}}
const reverseBody=(record,type='sales',extra={})=>({id:record.id,type,reason:'Wrong invoice chosen',refundReviewed:true,...extra});
const reverseOk=(record,type='sales',extra={})=>ok(reverse,'/api/returns/reverse',reverseBody(record,type,extra));
function migrate(file){execFileSync('./node_modules/.bin/prisma',['db','execute','--file',file,'--schema','prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'})}
describe('Audited return reversal against PostgreSQL',()=>{
 before(async()=>{execFileSync('./node_modules/.bin/prisma',['db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});migrate('scripts/migration-v40-packaging-stock-constraints.sql');migrate('scripts/migration-v41-return-reversals.sql');await db.user.create({data:{id:actorId,email:'admin@example.invalid',password_hash:'unused',role:'super_admin'}})});
 after(async()=>{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect()});
 beforeEach(async()=>{
  await db.$executeRawUnsafe('TRUNCATE products, suppliers, invoices, cashbook, activity_log, product_categories CASCADE');
  await db.returnPeriodLock.update({where:{id:1},data:{closed_through:null}});
  await db.user.update({where:{id:actorId},data:{role:'super_admin',is_active:true,modules:[]}});
  const category=await db.productCategory.create({data:{name:'Tests',name_key:'tests'}});
  product=await db.product.create({data:{name:'Product',code:'1',quantity:20,cost_price:10,sale_price:100,category_id:category.id,created_at:new Date('2026-01-01')}});
  await db.stockBatch.create({data:{product_id:product.id,received_qty:20,remaining_qty:20,unit_cost:10,received_date:new Date('2026-01-01')}});
  supplier=await db.supplier.create({data:{name:'Supplier'}});
 });
 test('sales reversal restores the sold stock position, cancels credit and reopens returnable quantities',async()=>{
  const {inv,line,record}=await saleReturn();assert.equal(await qty(),20);
  await reverseOk(record);assert.equal(await qty(),16);
  const saved=await db.invoiceReturn.findUniqueOrThrow({where:{id:record.id}});assert.ok(saved.reversed_at);assert.equal(saved.reversal_reason,'Wrong invoice chosen');
  assert.equal(Number((await db.cashbook.findUniqueOrThrow({where:{id:saved.reversal_credit_entry_id}})).amount),400);
  assert.equal(Number((await db.invoice.findUniqueOrThrow({where:{id:inv.id}})).balance_due),400);
  const detail=await ok(returns,'/api/returns?id='+inv.id,undefined,'GET');assert.equal(detail.invoice.items[0].return_items.length,0);assert.equal(detail.invoice.returns.length,1);
  await makeReturn(inv.id,line.id,4);assert.equal(await qty(),20);assert.equal(await db.invoiceReturn.count(),2);
 });
 test('reversal retries and concurrent reversals cannot duplicate stock, credit or audit',async()=>{
  const {record}=await saleReturn();const results=await Promise.all([reverseOk(record),reverseOk(record)]);assert.equal(results.length,2);assert.equal(await qty(),16);
  await reverseOk(record);assert.equal(await qty(),16);assert.equal(await db.returnReversalStock.count(),1);assert.equal(await db.cashbook.count(),2);
  assert.equal(await db.activityLog.count({where:{title:'Return reversed'}}),1);
 });
 test('resold original return stock blocks the reversal atomically',async()=>{
  const {record}=await saleReturn();await sell(18);assert.equal(await qty(),2);
  const r=await invoke(reverse,'/api/returns/reverse',reverseBody(record));assert.equal(r.status,400);assert.match(r.body.error,/Not enough stock/);
  assert.equal(await qty(),2);assert.equal((await db.invoiceReturn.findUniqueOrThrow({where:{id:record.id}})).reversed_at,null);assert.equal(await db.returnReversalStock.count(),0);assert.equal(await db.cashbook.count(),1);
 });
 test('supplier reversal returns original batch stock and restores payable',async()=>{
  const po=await purchase();const line=await db.purchaseOrderItem.findFirstOrThrow({where:{purchase_order_id:po.id}});const record=await makeReturn(po.id,line.id,4,'supplier');assert.equal(await qty(),20);
  await reverseOk(record,'supplier');assert.equal(await qty(),24);assert.equal(Number((await db.purchaseOrder.findUniqueOrThrow({where:{id:po.id}})).balance_due),400);
  await makeReturn(po.id,line.id,4,'supplier');assert.equal(await qty(),20);
 });
 test('over-24-hour reversal requires an additional exact confirmation based on created_at',async()=>{
  const {record}=await saleReturn();await db.invoiceReturn.update({where:{id:record.id},data:{created_at:new Date(Date.now()-86400001)}});
  const r=await invoke(reverse,'/api/returns/reverse',reverseBody(record));assert.equal(r.status,400);assert.match(r.body.error,/over 24 hours/);assert.equal(await qty(),20);
  await reverseOk(record,'sales',{lateConfirmation:'REVERSE'});assert.equal(await qty(),16);
 });
 test('a backdated return created now is within the normal window, and refunds must be reviewed',async()=>{
  const {record}=await saleReturn();const r=await invoke(reverse,'/api/returns/reverse',reverseBody(record,'sales',{refundReviewed:false}));assert.equal(r.status,400);assert.match(r.body.error,/refund/i);
  await reverseOk(record);assert.equal(await qty(),16);
 });
 test('closed dates block even super-admin reversals and backdated new returns; changes are audited',async()=>{
  const {record,inv,line}=await saleReturn();await ok(period,'/api/returns/period',{closedThrough:'2026-10-02',reason:'October close'},'PATCH');
  const r=await invoke(reverse,'/api/returns/reverse',reverseBody(record));assert.equal(r.status,400);assert.match(r.body.error,/closed/);assert.equal(await qty(),20);
  const newReturn=await invoke(returns,'/api/returns',{invoiceId:inv.id,requestId:randomUUID(),date:'2026-10-02',reason:'Test',selections:[{invoice_item_id:line.id,qty:1}]});assert.equal(newReturn.status,400);assert.match(newReturn.body.error,/closed/);
  await ok(period,'/api/returns/period',{closedThrough:null,reason:'Correct erroneous close'},'PATCH');await reverseOk(record);assert.equal(await qty(),16);
  assert.equal(await db.activityLog.count({where:{entity_type:'return_period'}}),2);
 });
 test('non-admin and deactivated sessions cannot reverse or change the cutoff',async()=>{
  const {record}=await saleReturn();
  for(const profile of [{role:'sub_user',modules:['returns']},{role:'super_admin',is_active:false}]){
   await db.user.update({where:{id:actorId},data:profile});assert.equal((await invoke(reverse,'/api/returns/reverse',reverseBody(record))).status,403);assert.equal((await invoke(period,'/api/returns/period',{closedThrough:null,reason:'Bad'},'PATCH')).status,403);
  }assert.equal(await qty(),20);
 });
 test('missing reason, invalid ids and future cutoff dates are rejected',async()=>{
  const {record}=await saleReturn();for(const extra of [{reason:''},{id:'bad'},{type:'other'}])assert.equal((await invoke(reverse,'/api/returns/reverse',{...reverseBody(record),...extra})).status,400);
  assert.equal((await invoke(period,'/api/returns/period',{closedThrough:'2999-01-01',reason:'No'},'PATCH')).status,400);
 });
 test('walk-in reversal recalculates invoice balance without changing cash payments',async()=>{
  const {inv,record}=await saleReturn(4,true);await reverseOk(record);assert.equal(Number((await db.invoice.findUniqueOrThrow({where:{id:inv.id}})).balance_due),400);
  assert.equal(await db.cashbook.count({where:{method:{not:'Adjustment'}}}),0);
 });
 test('legacy restored stock uses its saved fallback batch; ambiguous old history is blocked',async()=>{
  const inv=await sell();await db.stockAllocation.deleteMany({where:{invoice_id:inv.id}});const line=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  const record=await makeReturn(inv.id,line.id,4);const returned=await db.invoiceReturnItem.findFirstOrThrow({where:{return_id:record.id}});assert.ok(returned.restored_batch_id);
  await reverseOk(record);assert.equal(await qty(),16);
  const next=await makeReturn(inv.id,line.id,4);await db.invoiceReturnItem.updateMany({where:{return_id:next.id},data:{restored_batch_id:null}});
  const r=await invoke(reverse,'/api/returns/reverse',reverseBody(next));assert.equal(r.status,400);assert.match(r.body.error,/incomplete batch history/);assert.equal(await qty(),20);
 });
 test('reversal ledger corrections are protected from generic editing and deletion',async()=>{
  const {record}=await saleReturn();await reverseOk(record);const saved=await db.invoiceReturn.findUniqueOrThrow({where:{id:record.id}});
  for(const operation of ['update','delete']){const r=await invoke(api,'/api/db',{table:'cashbook',operation,filters:[{column:'id',op:'eq',value:saved.reversal_credit_entry_id}],data:{amount:1}});assert.equal(r.status,400);}
 });
 test('history labels reversal and the migration can be rerun without changing quantities',async()=>{
  const {record}=await saleReturn();await reverseOk(record);migrate('scripts/migration-v41-return-reversals.sql');
  const r=await ok(history,'/api/returns/history?id='+record.id,undefined,'GET');assert.ok(r.returns[0].reversed_at);assert.equal(r.returns[0].reversed_by_name,'admin');assert.equal(await qty(),16);
 });
 test('stock report keeps original return and dated reversal effects without inventing stock',async()=>{
  const {record}=await saleReturn();await reverseOk(record);
  const r=await ok(report,'/api/reports/stock?from=2026-01-01&to=2026-12-31',undefined,'GET');const row=r.rows.find(p=>p.id===product.id);assert.equal(row.available,16);assert.equal(row.sold,4);assert.equal(row.warning,null);
  const old=await ok(report,'/api/reports/stock?from=2026-01-01&to=2026-10-02',undefined,'GET');assert.equal(old.rows.find(p=>p.id===product.id).available,20);
 });
 test('kit reversal and another return use the saved vial factor without duplicating allocations',async()=>{
  await db.product.update({where:{id:product.id},data:{packaging_enabled:true,base_unit:'Vial',pieces_per_packet:4}});
  const inv=(await ok(api,'/api/db',{table:'invoices',operation:'save_invoice',data:{client_name:'Kit party',invoice_date:'2026-10-01',subtotal:100,grand_total:100,balance_due:100},items:[{product_id:product.id,unit:'packet',qty:1,rate:100,amount:100}]})).data;
  const line=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});assert.equal(await qty(),16);
  const record=await makeReturn(inv.id,line.id,1);assert.equal(await qty(),20);
  await reverseOk(record);assert.equal(await qty(),16);await makeReturn(inv.id,line.id,1);assert.equal(await qty(),20);
  const r=await ok(report,'/api/reports/stock?from=2026-01-01&to=2026-12-31',undefined,'GET');const row=r.rows.find(p=>p.id===product.id);assert.equal(row.available,20);assert.equal(row.warning,null);
 });
 test('supplier report retains dated receipt and reversal effects',async()=>{
  const po=await purchase();const line=await db.purchaseOrderItem.findFirstOrThrow({where:{purchase_order_id:po.id}});const record=await makeReturn(po.id,line.id,4,'supplier');await reverseOk(record,'supplier');
  const r=await ok(report,'/api/reports/stock?from=2026-01-01&to=2026-12-31',undefined,'GET');const row=r.rows.find(p=>p.id===product.id);assert.equal(row.available,24);assert.equal(row.warning,null);
 });
 test('ledger insertion failure rolls back all stock and reversal metadata',async()=>{
  const {record}=await saleReturn();
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_test_reversal_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.description LIKE '%return reversal%' THEN RAISE EXCEPTION 'Injected ledger failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fail_test_reversal_credit BEFORE INSERT ON cashbook FOR EACH ROW EXECUTE FUNCTION fail_test_reversal_credit()');
  try {
   const r=await invoke(reverse,'/api/returns/reverse',reverseBody(record));assert.equal(r.status,500);assert.equal(await qty(),20);assert.equal(await db.returnReversalStock.count(),0);assert.equal(await db.cashbook.count(),1);assert.equal((await db.invoiceReturn.findUniqueOrThrow({where:{id:record.id}})).reversed_at,null);
  } finally {await db.$executeRawUnsafe('DROP TRIGGER fail_test_reversal_credit ON cashbook');await db.$executeRawUnsafe('DROP FUNCTION fail_test_reversal_credit()');}
  await reverseOk(record);assert.equal(await qty(),16);
 });
 test('closing a period and reversing concurrently cannot bypass the cutoff',async()=>{
  const {record}=await saleReturn();
  const [reversal,close]=await Promise.all([invoke(reverse,'/api/returns/reverse',reverseBody(record)),invoke(period,'/api/returns/period',{closedThrough:'2026-10-02',reason:'Close returns'},'PATCH')]);
  assert.equal(close.status,200);assert.ok([200,400].includes(reversal.status));const saved=await db.invoiceReturn.findUniqueOrThrow({where:{id:record.id}});assert.equal(await qty(),saved.reversed_at?16:20);
  assert.equal((await invoke(reverse,'/api/returns/reverse',reverseBody(record))).status,saved.reversed_at?200:400);
 });
 test('SQL movement ownership, positive quantities and singleton settings are enforced after db push',async()=>{
  const {record}=await saleReturn();const batch=await db.stockBatch.findFirstOrThrow({where:{product_id:product.id}});
  await assert.rejects(db.returnReversalStock.create({data:{batch_id:batch.id,qty:1,movement_date:new Date()}}));
  await assert.rejects(db.returnReversalStock.create({data:{batch_id:batch.id,sales_return_id:record.id,qty:-1,movement_date:new Date()}}));
  await assert.rejects(db.returnPeriodLock.create({data:{id:2}}));
 });
});
