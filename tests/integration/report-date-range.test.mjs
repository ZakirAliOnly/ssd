import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server.js';
import { tsLoader } from '../helpers/load-ts.mjs';
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
const schema = 'date_range_' + randomUUID().replaceAll('-',''); url.searchParams.set('schema',schema);
const db = new PrismaClient({datasources:{db:{url:url.toString()}}}), userId=randomUUID();
const route=tsLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>({sub:userId,email:'test@example.invalid',full_name:'Test'})}},{serverOnly:true})('app/api/db/route.ts');
const f=(type,val,col='invoice_date')=>({type,col,val});
async function select(filters,table='invoices',extra={}){
 const r=await route.POST(new NextRequest('http://localhost/api/db',{method:'POST',headers:{cookie:'auth=test','content-type':'application/json'},body:JSON.stringify({table,operation:'select',filters,orders:[{col:table==='invoices'?'invoice_date':'date',ascending:true}],...extra})}));
 const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;
}
const dates=async filters=>(await select(filters)).data.map(r=>r.invoice_date);
describe('Shared report range filters on PostgreSQL',()=>{
 before(async()=>{
  execFileSync('./node_modules/.bin/prisma',['db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});
  await db.user.create({data:{id:userId,email:'test@example.invalid',password_hash:'unused',role:'super_admin'}});
  for(const date of ['2026-10-31','2026-11-01','2026-11-15','2026-11-25','2026-11-26']){
   await db.invoice.create({data:{invoice_number:date,client_name:date==='2026-11-15'?'Other':'AS Enterprises',invoice_date:new Date(date),grand_total:100,balance_due:100}});
   await db.cashbook.create({data:{type:'in',description:'Test',date:new Date(date),amount:100}});
  }
 });
 after(async()=>{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect()});
 test('both inclusive bounds exclude older and later invoices',async()=>assert.deepEqual(await dates([f('gte','2026-11-01'),f('lte','2026-11-25')]),['2026-11-01','2026-11-15','2026-11-25']));
 test('filter order does not discard either bound',async()=>assert.deepEqual(await dates([f('lte','2026-11-25'),f('gte','2026-11-01')]),['2026-11-01','2026-11-15','2026-11-25']));
 test('same-day and reversed ranges work',async()=>{assert.deepEqual(await dates([f('gte','2026-11-15'),f('lte','2026-11-15')]),['2026-11-15']);assert.deepEqual(await dates([f('gte','2026-11-25'),f('lte','2026-11-01')]),[])});
 test('single bounds and no bounds remain supported',async()=>{assert.equal((await dates([f('gte','2026-11-25')])).length,2);assert.equal((await dates([f('lte','2026-11-01')])).length,2);assert.equal((await dates([])).length,5)});
 test('range composes with client filters and exact counts',async()=>{const r=await select([f('gte','2026-11-01'),f('lte','2026-11-25'),f('eq','AS Enterprises','client_name')], 'invoices',{count:'exact'});assert.equal(r.data.length,2);assert.equal(r.data.reduce((s,i)=>s+i.grand_total,0),200);const count=await select([f('gte','2026-11-01'),f('lte','2026-11-25'),f('eq','AS Enterprises','client_name')],'invoices',{count:'exact',head:true});assert.equal(count.count,2)});
 test('shared cashbook date ranges retain both bounds too',async()=>{const r=await select([f('gte','2026-11-01','date'),f('lte','2026-11-25','date')],'cashbook');assert.deepEqual(r.data.map(r=>r.date),['2026-11-01','2026-11-15','2026-11-25'])});
 test('numeric bounds and equality are not overwritten',async()=>{assert.equal((await select([f('gte',50,'grand_total'),f('lte',99,'grand_total')])).data.length,0);assert.equal((await select([f('eq','2026-11-15'),f('gte','2026-11-01'),f('lte','2026-11-25')])).data.length,1)});
});
