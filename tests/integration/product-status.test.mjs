// Exercise the exact Products request against Prisma, not a permissive DB mock.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server.js';
import { tsLoader } from '../helpers/load-ts.mjs';
const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
const schema='status_'+randomUUID().replaceAll('-','');url.searchParams.set('schema',schema);
const db=new PrismaClient({datasources:{db:{url:url.toString()}}}),userId=randomUUID();
const route=tsLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>({sub:userId,email:'admin@example.invalid',full_name:'Test'})}},{serverOnly:true})('app/api/db/route.ts');
const filter=(type,col,val)=>({type,col,val});
async function select(filters=[],extra={}){const r=await route.POST(new NextRequest('http://localhost/api/db',{method:'POST',headers:{cookie:'auth=yes','content-type':'application/json'},body:JSON.stringify({table:'products',operation:'select',select:'*, product_categories(*)',filters,orders:[{col:'name',ascending:true}],...extra})}));return {status:r.status,...await r.json()}}
async function names(filters){const r=await select(filters);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.error,null);return r.data.map(p=>p.name)}
describe('Product Boolean status filters against PostgreSQL',()=>{
 before(async()=>{execFileSync('./node_modules/.bin/prisma',['db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});await db.user.create({data:{id:userId,email:'admin@example.invalid',password_hash:'unused',role:'super_admin'}});const c=await db.productCategory.create({data:{name:'Test category',name_key:'test category'}});await db.product.createMany({data:[{code:'1',name:'Bromide active',is_active:true,category_id:c.id},{code:'2',name:'Bromide archived',is_active:false,category_id:c.id},{code:'3',name:'Other product',is_active:true,category_id:c.id}]})});
 after(async()=>{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect()});
 test('Products request for both statuses loads active and inactive records and category',async()=>{const r=await select([filter('in','is_active',[true,false])]);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.length,3);assert.equal(r.data[0].product_categories.name,'Test category')});
 test('ordinary product selectors retain the default active-only filter',async()=>{assert.deepEqual(await names(),['Bromide active','Other product'])});
 test('single Boolean values and explicit equality select the intended status',async()=>{assert.deepEqual(await names([filter('in','is_active',[false])]),['Bromide archived']);assert.deepEqual(await names([filter('in','is_active',[true])]),['Bromide active','Other product']);assert.deepEqual(await names([filter('eq','is_active',false)]),['Bromide archived'])});
 test('Boolean inclusion combines with product search and other predicates',async()=>{assert.deepEqual(await names([filter('in','is_active',[true,false]),filter('ilike','name','%Bromide%')]),['Bromide active','Bromide archived']);assert.deepEqual(await names([filter('in','is_active',[true,false]),filter('eq','code','2')]),['Bromide archived'])});
 test('empty selection matches nothing; duplicate Boolean values are harmless',async()=>{assert.deepEqual(await names([filter('in','is_active',[])]),[]);assert.deepEqual(await names([filter('in','is_active',[false,false])]),['Bromide archived'])});
 test('malformed Boolean filters fail with a validation error',async()=>{for(const values of [['false'],[1],null,'true']){const r=await select([filter('in','is_active',values)]);assert.equal(r.status,400);assert.match(r.error.message,/true or false/)} });
 test('numeric/string IN filters and exact counts keep their existing behavior',async()=>{assert.deepEqual(await names([filter('in','code',['1','3'])]),['Bromide active','Other product']);const r=await select([filter('in','is_active',[true,false])],{count:'exact',head:true});assert.equal(r.status,200);assert.equal(r.count,3)});
});
