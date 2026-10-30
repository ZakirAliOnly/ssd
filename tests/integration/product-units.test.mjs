// Real PostgreSQL transactions; no production database or messaging provider used.
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server.js';
import { tsLoader } from '../helpers/load-ts.mjs';
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
const schema = 'packaging_' + randomUUID().replaceAll('-',''); url.searchParams.set('schema',schema);
const db = new PrismaClient({datasources:{db:{url:url.toString()}}});
const adminId=randomUUID(), categoryId=randomUUID(); let product, supplier;
const load=tsLoader({'@/lib/prisma':{prisma:db}, '@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>({sub:adminId,email:'test@example.invalid',full_name:'Test'})}}, {serverOnly:true});
const route=load('app/api/db/route.ts'), returns=load('app/api/returns/route.ts'), report=load('app/api/reports/stock/route.ts');
const request=(path,body)=>new NextRequest('http://localhost'+path,{method:'POST',headers:{cookie:'auth=admin','content-type':'application/json'},body:JSON.stringify(body)});
const call=async body=>{const r=await route.POST(request('/api/db',body));return {status:r.status,...await r.json()}};
async function ok(body){const r=await call(body);assert.equal(r.error,null,JSON.stringify(r));return r.data}
const pack={packaging_enabled:true,base_unit:'Piece',pieces_per_packet:10,packets_per_box:10,packet_sale_price:90,box_sale_price:800};
async function configure(data=pack){await ok({table:'products',operation:'update',filters:[{column:'id',op:'eq',value:product.id}],data})}
async function convert(unit='box',extra={}){const p=await db.product.findUniqueOrThrow({where:{id:product.id}});return configure({...pack,conversion_unit:unit,expected_quantity:Number(p.quantity),...extra})}
async function purchase(qty=2,unit='box',extra={}) {return ok({table:'purchase_orders',operation:'save_purchase',requestId:randomUUID(),data:{supplier_id:supplier.id,order_date:'2026-10-01'},items:[{product_id:product.id,qty,rate:1000,unit,...extra}]})}
async function sell(lines,invoiceId){const total=lines.reduce((s,l)=>s+l.qty*(l.rate??10),0);return ok({table:'invoices',operation:'save_invoice',invoiceId,data:{client_name:'Test',is_walk_in:true,invoice_date:'2026-10-02',subtotal:total,grand_total:total,balance_due:total},items:lines.map(l=>({product_id:product.id,category:'Distribution product',rate:10,amount:l.qty*(l.rate??10),...l}))})}
const qty=async()=>Number((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantity);
async function giveBack(invoiceId,itemId,n,type='sales'){const response=await returns.POST(request('/api/returns',{invoiceId,requestId:randomUUID(),date:'2026-10-03',reason:'Test return',type,selections:[{invoice_item_id:itemId,qty:n}]}));const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.record}
async function stockReport(){const r=await report.GET(new NextRequest('http://localhost/api/reports/stock?from=2026-01-01&to=2026-10-20',{headers:{cookie:'auth=admin'}}));const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.rows.find(r=>r.id===product.id)}
function migrate(file){execFileSync('./node_modules/.bin/prisma',['db','execute','--file',file,'--schema','prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'})}
describe('Distribution units through real API transactions',()=>{
 before(async()=>{
  execFileSync('./node_modules/.bin/prisma',['db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});
  // Prisma db push does not install SQL CHECKs. Recreate the real legacy
  // migration constraints instead of testing against a more permissive schema.
  migrate('scripts/migration-v26-product-stock.sql');
  for(const [table,column,file] of [
   ['invoice_return_items','stock_restored_qty','scripts/migration-v33-invoice-returns.sql'],
   ['supplier_return_items','stock_removed_qty','scripts/migration-v34-supplier-returns.sql'],
  ]){
   const definition=readFileSync(file,'utf8').split('\n').find(line=>line.trim().startsWith(column+' '));
   const check=definition.slice(definition.indexOf('CHECK')).replace(/,\s*$/,'');
   await db.$executeRawUnsafe(`ALTER TABLE ${table} ADD ${check}`);
  }
  await db.user.create({data:{id:adminId,email:'test@example.invalid',password_hash:'unused',role:'super_admin'}});await db.productCategory.create({data:{id:categoryId,name:'Test',name_key:'test'}})
 });
 after(async()=>{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect()});
 beforeEach(async()=>{await db.$executeRawUnsafe('TRUNCATE products, suppliers, invoices, cashbook, activity_log CASCADE');product=await db.product.create({data:{name:'Distribution product',code:'1',category_id:categoryId,cost_price:5,sale_price:10,created_at:new Date('2026-01-01')}});supplier=await db.supplier.create({data:{name:'Supplier'}})});
 test('v40 repairs the production kit CHECK failure, preserves rollback, and supports party sales and both returns',async()=>{
  await convert('piece',{base_unit:'Vial',pieces_per_packet:4});
  const po=await purchase(3,'packet');assert.equal(await qty(),12);
  const body={table:'invoices',operation:'save_invoice',data:{client_name:'Synthetic party',is_walk_in:false,invoice_date:'2026-10-02',subtotal:14365.5,grand_total:14365.5,balance_due:14365.5},items:[{product_id:product.id,category:'Synthetic kit',qty:1,unit:'packet',rate:19154,discount_pct:25,amount:14365.5}]};
  const failed=await call(body);assert.equal(failed.status,500);assert.match(failed.error.message,/invoice_items_stock_deducted_valid/);
  assert.equal(await qty(),12);assert.equal(await db.invoice.count(),0);assert.equal(await db.stockAllocation.count(),0);
  migrate('scripts/migration-v40-packaging-stock-constraints.sql');
  migrate('scripts/migration-v40-packaging-stock-constraints.sql');
  const inv=await ok(body);assert.equal(await qty(),8);
  const item=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  assert.equal(Number(item.qty),1);assert.equal(Number(item.unit_factor),4);assert.equal(Number(item.stock_deducted_qty),4);
  await assert.rejects(db.invoiceItem.update({where:{id:item.id},data:{stock_deducted_qty:5}}));
  await assert.rejects(db.invoiceItem.update({where:{id:item.id},data:{stock_deducted_qty:-1}}));
  await assert.rejects(db.invoiceItem.update({where:{id:item.id},data:{unit_factor:0,stock_deducted_qty:0}}));
  await giveBack(inv.id,item.id,1);assert.equal(await qty(),12);
  const returned=await db.invoiceReturnItem.findFirstOrThrow({where:{invoice_item_id:item.id}});
  assert.equal(Number(returned.stock_restored_qty),4);
  await assert.rejects(db.invoiceReturnItem.update({where:{id:returned.id},data:{stock_restored_qty:5}}));
  await assert.rejects(db.invoiceReturnItem.update({where:{id:returned.id},data:{stock_restored_qty:-1}}));
  const purchaseItem=await db.purchaseOrderItem.findFirstOrThrow({where:{purchase_order_id:po.id}});
  await giveBack(po.id,purchaseItem.id,1,'supplier');assert.equal(await qty(),8);
  const supplierReturn=await db.supplierReturnItem.findFirstOrThrow({where:{purchase_item_id:purchaseItem.id}});
  assert.equal(Number(supplierReturn.stock_removed_qty),4);
  await assert.rejects(db.supplierReturnItem.update({where:{id:supplierReturn.id},data:{stock_removed_qty:5}}));
  await assert.rejects(db.supplierReturnItem.update({where:{id:supplierReturn.id},data:{stock_removed_qty:-1}}));
  migrate('scripts/migration-v40-packaging-stock-constraints.sql');assert.equal(await qty(),8);
 });
 test('box purchases, packet and loose-piece sales reconcile FIFO and report costs',async()=>{
  await convert('piece');await purchase(); assert.equal(await qty(),200);
  const invoice=await sell([{qty:1,unit:'packet',rate:90},{qty:3,unit:'piece',rate:10}]);assert.equal(await qty(),187);
  const items=await db.invoiceItem.findMany({where:{invoice_id:invoice.id},orderBy:{unit:'asc'}});
  assert.deepEqual(items.map(l=>Number(l.stock_deducted_qty)),[10,3]);
  const report=await stockReport(); assert.equal(report.received,200);assert.equal(report.sold,13);assert.equal(report.available,187);assert.equal(report.cost,130);assert.equal(report.revenue,120);assert.equal(report.warning,null);
 });
 test('fractional pack quantities do not create false stock-report discrepancies',async()=>{
  await convert('piece',{pieces_per_packet:3});await purchase();const inv=await sell([{qty:1.3,unit:'packet'}]);const item=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  assert.equal(await qty(),56.1);let r=await stockReport();assert.equal(r.sold,3.9);assert.equal(r.warning,null);assert.equal(r.cost,130);
  await giveBack(inv.id,item.id,.3);r=await stockReport();assert.equal(r.sold,3);assert.equal(r.available,57);assert.equal(r.warning,null);
 });
 test('sales returns restore base pieces using the saved packet size',async()=>{
  await convert('piece');await purchase();const inv=await sell([{qty:2,unit:'packet',rate:90}]);const item=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  await configure({...pack,pieces_per_packet:12});await giveBack(inv.id,item.id,1);assert.equal(await qty(),190);
  const r=await stockReport();assert.equal(r.sold,10);assert.equal(r.available,190);assert.equal(r.cost,100);
 });
 test('editing a saved sale keeps its snapshot after the product pack size changes',async()=>{
  await convert('piece');await purchase();const inv=await sell([{qty:1,unit:'packet'}]);const old=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  await configure({...pack,pieces_per_packet:12});await sell([{qty:1,unit:'packet',source_item_id:old.id,unit_factor:10}],inv.id);assert.equal(await qty(),190);
  await sell([{qty:1,unit:'packet',unit_factor:12}]);assert.equal(await qty(),178);
 });
 test('forged factors and stale unit choices fail atomically',async()=>{
  await convert('piece');await purchase();
  const r=await call({table:'invoices',operation:'save_invoice',data:{client_name:'Test',invoice_date:'2026-10-02',grand_total:10},items:[{product_id:product.id,unit:'box',unit_factor:1,qty:1,rate:10,amount:10}]});assert.equal(r.status,400);assert.equal(await qty(),200);assert.equal(await db.invoice.count(),0);
 });
 test('an outdated client cannot silently save a packaged product as plain units',async()=>{
  await convert('piece');await purchase();const response=await call({table:'invoices',operation:'save_invoice',data:{client_name:'Test',invoice_date:'2026-10-02',grand_total:10},items:[{product_id:product.id,qty:1,rate:10,amount:10}]});assert.equal(response.status,400);assert.match(response.error.message,/Reload/);assert.equal(await qty(),200);
 });
 test('over-selling across duplicate unit lines rolls back the whole invoice',async()=>{
  await convert('piece');await purchase(1);const r=await call({table:'invoices',operation:'save_invoice',data:{client_name:'Test',invoice_date:'2026-10-02',grand_total:10},items:[{product_id:product.id,unit:'box',qty:1,rate:10,amount:10},{product_id:product.id,unit:'piece',qty:1,rate:10,amount:10}]});assert.equal(r.status,400);assert.equal(await qty(),100);assert.equal(await db.stockAllocation.count(),0);
 });
 test('legacy conversion retains prices, quantities, expiry and prior return history',async()=>{
  const po=await purchase(5,'unit');const oldPurchase=po.items[0];const inv=await sell([{qty:2,unit:'unit',rate:1500}]);const old=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  await giveBack(inv.id,old.id,1);assert.equal(await qty(),4);
  await convert('box');assert.equal(await qty(),400);assert.equal(Number((await db.product.findUniqueOrThrow({where:{id:product.id}})).cost_price),.05);
  const original=await db.invoiceItem.findUniqueOrThrow({where:{id:old.id}});assert.equal(Number(original.qty),2);assert.equal(Number(original.amount),3000);assert.equal(Number(original.unit_factor),100);
  assert.equal(Number((await db.invoiceReturnItem.findFirstOrThrow()).stock_restored_qty),100);
  await giveBack(po.id,oldPurchase.id,1,'supplier');assert.equal(await qty(),300);
  await giveBack(inv.id,old.id,1);assert.equal(await qty(),400);
  const r=await stockReport();assert.equal(r.available,400);assert.equal(r.sold,0);assert.equal(r.cost,0);assert.equal(r.warning,null);
  assert.equal(Number((await db.stockBatch.findFirstOrThrow()).unit_cost),10);
 });
 test('legacy opening stock is converted once with optimistic quantity checks',async()=>{
  await db.product.update({where:{id:product.id},data:{quantity:5,cost_price:1000}});await db.stockBatch.create({data:{product_id:product.id,received_qty:5,remaining_qty:5,received_date:new Date('2026-01-01'),expiry_date:new Date('2027-01-01'),unit_cost:1000}});
  const stale=await call({table:'products',operation:'update',filters:[{column:'id',op:'eq',value:product.id}],data:{...pack,conversion_unit:'box',expected_quantity:4}});assert.equal(stale.status,400);assert.equal(await qty(),5);
  await convert('box');assert.equal(await qty(),500);const updated=await db.product.findUniqueOrThrow({where:{id:product.id}});assert.equal(Number(updated.cost_price)*Number(updated.quantity),5000);
  const again=await call({table:'products',operation:'update',filters:[{column:'id',op:'eq',value:product.id}],data:{...pack,conversion_unit:'box',expected_quantity:500}});assert.equal(again.status,400);assert.equal(await qty(),500);assert.equal(await db.activityLog.count({where:{entity_type:'product'}}),1);
  assert.equal((await db.stockBatch.findFirstOrThrow()).expiry_date.toISOString().slice(0,10),'2027-01-01');
 });
 test('supplier returns use saved box sizes after packaging edits',async()=>{
  await convert('piece');const po=await purchase();await configure({...pack,packets_per_box:5});await giveBack(po.id,po.items[0].id,1,'supplier');assert.equal(await qty(),100);
 });
 test('a purchase edit keeps historical physical receipt and rejects reducing below sold stock',async()=>{
  await convert('piece');const po=await purchase();await sell([{qty:150,unit:'piece'}]);
  const r=await call({table:'purchase_orders',operation:'save_purchase',purchaseId:po.id,data:{order_date:'2026-10-01'},items:[{id:po.items[0].id,product_id:product.id,unit:'box',unit_factor:100,qty:1,rate:1000}]});assert.equal(r.status,400);assert.equal(await qty(),50);
 });
 test('deleting a sale restores its saved base quantities',async()=>{
  await convert('piece');await purchase();const inv=await sell([{qty:1,unit:'box'}]);await configure({...pack,packets_per_box:5});await ok({table:'invoices',operation:'delete',filters:[{column:'id',op:'eq',value:inv.id}]});assert.equal(await qty(),200);
 });
 test('unconfigured products retain their existing units and stock quantities',async()=>{
  await purchase(5,'unit');const inv=await sell([{qty:2,unit:'unit'}]);assert.equal(await qty(),3);
  const line=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});assert.equal(Number(line.unit_factor),1);assert.equal(line.unit,'unit');
 });
 test('legacy sale edits after conversion preserve original quantities and deductions',async()=>{
  await purchase(5,'unit');const inv=await sell([{qty:2,unit:'unit'}]);const line=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});await convert('box');
  await sell([{qty:2,unit:'unit',unit_factor:100,source_item_id:line.id}],inv.id);assert.equal(await qty(),300);
  const updated=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});assert.equal(Number(updated.qty),2);assert.equal(Number(updated.stock_deducted_qty),200);
 });
 test('competing mixed-unit sales cannot oversell the same box',async()=>{
  await convert('piece');await purchase(1);
  const body=()=>({table:'invoices',operation:'save_invoice',data:{client_name:'Test',is_walk_in:true,invoice_date:'2026-10-02',grand_total:10},items:[{product_id:product.id,unit:'packet',qty:6,rate:10,amount:60}]});
  const results=await Promise.all([call(body()),call(body())]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(await qty(),40);
 });
 test('linking an untracked historical purchase does not receive its boxes twice',async()=>{
  await db.product.update({where:{id:product.id},data:{quantity:5}});await db.stockBatch.create({data:{product_id:product.id,received_qty:5,remaining_qty:5,received_date:new Date('2026-01-01')}});await convert('box');
  const po=await db.purchaseOrder.create({data:{po_number:'OLD-'+randomUUID(),supplier_id:supplier.id,supplier_name:supplier.name,order_date:new Date('2026-10-01'),subtotal:5000,grand_total:5000,balance_due:5000}});
  const line=await db.purchaseOrderItem.create({data:{purchase_order_id:po.id,description:'Untracked product',qty:5,rate:1000,amount:5000}});
  await ok({table:'purchase_orders',operation:'save_purchase',purchaseId:po.id,data:{order_date:'2026-10-01'},items:[{id:line.id,product_id:product.id,unit:'box',qty:5,rate:1000}]});assert.equal(await qty(),500);assert.equal(await db.stockBatch.count(),1);
 });
 test('a concurrent legacy sale and conversion cannot use different stock bases',async()=>{
  await db.product.update({where:{id:product.id},data:{quantity:5}});await db.stockBatch.create({data:{product_id:product.id,received_qty:5,remaining_qty:5,received_date:new Date('2026-01-01')}});
  const results=await Promise.all([call({table:'products',operation:'update',filters:[{column:'id',op:'eq',value:product.id}],data:{...pack,conversion_unit:'box',expected_quantity:5}}),call({table:'invoices',operation:'save_invoice',data:{client_name:'Test',is_walk_in:true,invoice_date:'2026-10-02',grand_total:10},items:[{product_id:product.id,unit:'unit',qty:1,rate:10,amount:10}]})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);const p=await db.product.findUniqueOrThrow({where:{id:product.id}});assert.equal(Number(p.quantity),p.packaging_enabled?500:4);
 });
 test('migration adds defaults to legacy tables without converting existing quantities',async()=>{
  await db.product.update({where:{id:product.id},data:{quantity:5,cost_price:1000}});
  for(const column of ['packaging_enabled','base_unit','pieces_per_packet','packets_per_box','packet_sale_price','box_sale_price','packaging_converted_at']) await db.$executeRawUnsafe('ALTER TABLE products DROP COLUMN '+column);
  await db.$executeRawUnsafe('ALTER TABLE invoice_items DROP COLUMN unit, DROP COLUMN unit_factor');
  await db.$executeRawUnsafe('ALTER TABLE purchase_order_items DROP COLUMN unit_factor');
  await db.$executeRawUnsafe('ALTER TABLE stock_batches DROP COLUMN unit_cost');
  await db.$executeRawUnsafe('ALTER TABLE invoice_return_items DROP COLUMN unit');
  await db.$executeRawUnsafe('ALTER TABLE supplier_return_items DROP COLUMN unit');
  execFileSync('./node_modules/.bin/prisma',['db','execute','--file','scripts/migration-v39-product-packaging.sql','--schema','prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});
  await db.$disconnect(); await db.$connect();
  const p=await db.product.findUniqueOrThrow({where:{id:product.id}});assert.equal(p.packaging_enabled,false);assert.equal(Number(p.quantity),5);assert.equal(Number(p.cost_price),1000);
 });
 test('additive migration can be repeated without changing converted stock',async()=>{
  await convert('piece');await purchase();for(let i=0;i<2;i++)execFileSync('./node_modules/.bin/prisma',['db','execute','--file','scripts/migration-v39-product-packaging.sql','--schema','prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});assert.equal(await qty(),200);
 });
 test('full inventory upgrade remains repeatable and retains the packaging-safe checks',async()=>{
  await convert('piece');await purchase();
  const inv=await sell([{qty:1,unit:'packet'}]);const line=await db.invoiceItem.findFirstOrThrow({where:{invoice_id:inv.id}});
  await giveBack(inv.id,line.id,1);assert.equal(await qty(),200);
  for(let i=0;i<2;i++)execFileSync(process.execPath,['scripts/upgrade-inventory.cjs'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});
  assert.equal(await qty(),200);assert.equal(await db.invoiceReturnItem.count(),1);
  await sell([{qty:1,unit:'packet'}]);assert.equal(await qty(),190);
 });
});
