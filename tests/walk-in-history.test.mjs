import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { tsLoader } from './helpers/load-ts.mjs';
const records=Array.from({length:64},(_,i)=>({id:String(i).padStart(3,'0'),invoice_number:'SSD'+i,client_name:'Walk '+i,is_walk_in:true,
 invoice_date:new Date(i<20?'2024-02-29T00:00:00Z':'2026-10-23T00:00:00Z'),created_at:new Date(Date.UTC(2026,9,23,0,0,i)),
 grand_total:'100.50',amount_received:'20.25',balance_due:'80.25',previous_balance:'0',subtotal:'100.50',discount_amount:'0',discount_value:'0',payment_status:['paid','unpaid','partial'][i%3]}));
records.push({...records[0],id:'party',is_walk_in:false});
function fixture({authorized=true,active=true,modules=['quick-invoice'],rows=records}={}) {
 const queries=[];
 const filtered=where=>rows.filter(r=>r.is_walk_in===where.is_walk_in&&(!where.payment_status||r.payment_status===where.payment_status)&&(!where.invoice_date||r.invoice_date>=where.invoice_date.gte&&r.invoice_date<where.invoice_date.lt));
 const tx={invoice:{count:async({where})=>filtered(where).length,findMany:async args=>{
  queries.push(args);return filtered(args.where).sort((a,b)=>Number(b.created_at)-Number(a.created_at)||b.id.localeCompare(a.id)).slice(args.skip,args.skip+args.take);
 }}};
 const prisma={user:{findUnique:async()=>({role:'sub_user',modules,is_active:active})},$transaction:async(work,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return work(tx);}};
 const route=tsLoader({'@/lib/prisma':{prisma},'@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>authorized?{sub:'user'}:null}}, {serverOnly:true})('app/api/invoices/walk-in-history/route.ts');
 const call=async(query='')=>{const response=await route.GET(new NextRequest('http://localhost/api/invoices/walk-in-history'+query,{headers:{cookie:'auth=test'}}));return {status:response.status,headers:response.headers,body:await response.json()};};
 return {call,queries};
}
test('history pages all 64 walk-in invoices in stable pages of 15, beyond the old 50 limit',async()=>{
 const {call,queries}=fixture();const ids=[];
 for(let page=1;page<=5;page++){const {status,body,headers}=await call('?page='+page);assert.equal(status,200);assert.equal(headers.get('cache-control'),'no-store');assert.equal(body.total,64);assert.equal(body.totalPages,5);assert.equal(body.pageSize,15);assert.equal(body.invoices.length,page===5?4:15);ids.push(...body.invoices.map(i=>i.id));}
 assert.equal(new Set(ids).size,64);assert.ok(ids.includes('000'));assert.ok(!ids.includes('party'));assert.equal(queries[4].skip,60);assert.deepEqual(queries[0].orderBy,[{created_at:'desc'},{id:'desc'}]);
});
test('month/year and each payment status filter before counting and paging',async()=>{
 for(const status of ['paid','unpaid','partial']){const {call,queries}=fixture();const {body}=await call('?month=2024-02&status='+status);const expected=records.filter(r=>r.is_walk_in&&r.invoice_date.getUTCFullYear()===2024&&r.payment_status===status);assert.equal(body.total,expected.length);assert.ok(body.invoices.every(i=>i.payment_status===status));assert.equal(queries[0].where.invoice_date.gte.toISOString(),'2024-02-01T00:00:00.000Z');assert.equal(queries[0].where.invoice_date.lt.toISOString(),'2024-03-01T00:00:00.000Z');}
});
test('December bounds and typed JSON values keep dates and money usable by existing actions',async()=>{
 const row={...records[0],invoice_date:new Date('2025-12-31T00:00:00Z')};const {call,queries}=fixture({rows:[row]});const {body}=await call('?month=2025-12');assert.equal(queries[0].where.invoice_date.lt.toISOString(),'2026-01-01T00:00:00.000Z');assert.equal(body.invoices[0].invoice_date,'2025-12-31');assert.equal(body.invoices[0].grand_total,100.5);assert.equal(body.invoices[0].balance_due,80.25);
});
test('out-of-range pages clamp after deletions and empty filters retain page 1',async()=>{
 const {call}=fixture();assert.equal((await call('?page=999')).body.page,5);const empty=await call('?page=5&month=2020-01');assert.equal(empty.body.page,1);assert.equal(empty.body.totalPages,1);assert.equal(empty.body.total,0);assert.deepEqual(empty.body.invoices,[]);
});
test('invalid filters and page values are rejected without fetching invoices',async()=>{
 const {call,queries}=fixture();for(const query of ['?page=0','?page=-1','?page=1.5','?page=abc','?page=9007199254740992','?month=2024-13','?month=2024-2','?month=0000-01','?status=unknown'])assert.equal((await call(query)).status,400,query);assert.equal(queries.length,0);
});
test('history requires authentication, an active user and walk-in permission',async()=>{
 for(const [options,status] of [[{authorized:false},401],[{active:false},401],[{modules:['products']},403]])assert.equal((await fixture(options).call()).status,status);
});
