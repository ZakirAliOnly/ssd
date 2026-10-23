import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { tsLoader } from './helpers/load-ts.mjs';
const load=tsLoader({}, {serverOnly:true});
const {partyBalanceOverview,partyInvoiceBalances}=load('lib/partyOverview.ts');
const {computePartySignedBalance}=load('lib/partyBalance.ts');
const inv=(id,name,total,received=0,extra={})=>({id,client_name:name,is_walk_in:false,grand_total:total,amount_received:received,invoice_date:'2026-10-23',created_at:'2026-10-23T10:00:00Z',invoice_number:id,...extra});
const cash=(id,name,amount,type='in',extra={})=>({id,account_name:name,amount,type,date:'2026-10-23',created_at:'2026-10-23T11:00:00Z',description:'Receipt',method:'Cash',reference:'',...extra});
const accounts=[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Empty'}];
const invoices=[inv('i1','Alpha',100,20),inv('i2','Beta',200,40),inv('walk','Alpha',5000,0,{is_walk_in:true})];
const entries=[cash('opening','ALPHA',50,'in',{description:'Opening balance'}),cash('receipt','alpha',20,'in',{reference:'i1'}),cash('adjust','Alpha',10,'out',{method:'Adjustment'}),cash('refund','Beta',5,'out'),cash('return','Beta',15,'in')];
test('indexed overview exactly matches ledger balances, including receipts once, credits and walk-ins',()=>{
 const actual=partyBalanceOverview(accounts,invoices,entries);
 for(const a of accounts)assert.equal(actual[a.id],computePartySignedBalance(a.name,invoices,entries));
 assert.equal(actual.a,120);assert.equal(actual.b,150);assert.equal(actual.c,0);
});
test('reprinted invoice reconciles the reported example without rewriting the saved snapshot',()=>{
 const invoice={grand_total:28950,amount_received:0,previous_balance:127250};
 assert.deepEqual(partyInvoiceBalances(invoice),{previous:127250,total:156200});
 assert.deepEqual(partyInvoiceBalances(invoice,128950),{previous:100000,total:128950});
 assert.equal(invoice.previous_balance,127250);
 assert.deepEqual(partyInvoiceBalances({grand_total:100,amount_received:0,previous_balance:-200}),{previous:-200,total:-100});
 assert.deepEqual(partyInvoiceBalances(invoice,0),{previous:-28950,total:0});
});
test('overview groups large ledgers without dropping duplicate-name accounts or mutating rows',()=>{
 const many=Array.from({length:3000},(_,i)=>inv('i'+i,'Party '+(i%300),12.25,2.25));
 const parties=Array.from({length:300},(_,i)=>({id:'p'+i,name:'Party '+i}));
 const snapshot=JSON.stringify(many);const result=partyBalanceOverview([...parties,{id:'duplicate',name:'Party 0'}],many,[]);
 assert.equal(Object.keys(result).length,301);assert.ok(Object.values(result).every(v=>v===100));assert.equal(JSON.stringify(many),snapshot);
});
function routeFor(profile={role:'super_admin',is_active:true},authorized=true){
 const calls=[];const tx={account:{findMany:async()=>accounts.map(a=>({...a,head_account:null}))},headAccount:{findMany:async()=>[]},invoice:{findMany:async args=>{calls.push(args);return invoices;}},cashbook:{findMany:async()=>entries}};
 const prisma={user:{findUnique:async()=>profile},$transaction:async(work,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return work(tx);}};
 return {calls,route:tsLoader({'@/lib/prisma':{prisma},'@/lib/auth':{COOKIE_NAME:'auth',verifyToken:async()=>authorized?{sub:'admin'}:null}}, {serverOnly:true})('app/api/accounts/overview/route.ts')};
}
const request=()=>new NextRequest('http://localhost/api/accounts/overview',{headers:{cookie:'auth=test'}});
test('overview requires an active authenticated user with Parties permission',async()=>{
 for(const [profile,authorized,status] of [[{is_active:true,role:'super_admin'},false,401],[{is_active:false,role:'super_admin'},true,401],[{is_active:true,role:'sub_user',modules:['products']},true,403]])assert.equal((await routeFor(profile,authorized).route.GET(request())).status,status);
});
test('overview returns only accounts, heads and ledger-derived balances without transaction downloads',async()=>{
 const {route,calls}=routeFor();const response=await route.GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.deepEqual(Object.keys(body).sort(),['accounts','balances','heads']);assert.equal(body.balances.a,120);assert.equal(body.accounts[0].head_accounts,null);assert.equal(calls[0].select.previous_balance,undefined);assert.equal(calls[0].where.is_walk_in,false);
});

test('targeted party reads return ledger data in the same read-only snapshot',async()=>{
 const {route,calls}=routeFor();
 const response=await route.GET(new NextRequest('http://localhost/api/accounts/overview?party=Alpha',{headers:{cookie:'auth=test'}}));
 assert.equal(response.status,200);const body=await response.json();
 assert.ok(Array.isArray(body.invoices));assert.ok(Array.isArray(body.cashbook));assert.equal(body.invoices[0].invoice_date,'2026-10-23');assert.equal(body.cashbook[0].date,'2026-10-23');
 assert.equal(calls[0].where.client_name,'Alpha');assert.equal(calls[0].select,undefined);
});
test('live balance refuses a failed read rather than treating it as zero',async()=>{
 const previous=globalThis.fetch;
 try {
  globalThis.fetch=async()=>({ok:false,json:async()=>({error:'Database unavailable'})});
  const {fetchPartySignedBalance}=load('lib/partyBalanceLive.ts');
  await assert.rejects(()=>fetchPartySignedBalance('Alpha'),/Database unavailable/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({accounts:[{balance:999,bal_type:'credit'}],invoices,cashbook:entries})});
  const fresh=await fetchPartySignedBalance('Alpha');assert.equal(fresh.signed,120);assert.equal(fresh.cachedSigned,999);assert.equal(fresh.drift,879);
 }finally{globalThis.fetch=previous;}
});
