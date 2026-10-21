// Uses a temporary schema on a local PostgreSQL instance, never the production database.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server.js';
import { tsLoader } from '../helpers/load-ts.mjs';

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Tests require a local database');
const schema = 'page_loading_' + randomUUID().replaceAll('-', '');
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const userId = randomUUID();
let role = 'super_admin', modules = [], active = true, authenticated = true;
const load = tsLoader({
  '@/lib/prisma': { prisma: db },
  '@/lib/auth': { COOKIE_NAME: 'auth', verifyToken: async () => authenticated ? { sub: userId } : null },
}, { serverOnly: true });
const products = load('app/api/products/route.ts');
const walk = load('app/api/walk-in/route.ts');
async function get(route, query = '') {
  const response = await route.GET(new NextRequest('http://localhost/api/test?' + query, { headers: { cookie: 'auth=test' } }));
  return { status: response.status, headers: response.headers, ...await response.json() };
}
async function setUser(nextRole, nextModules = [], nextActive = true) {
  role = nextRole; modules = nextModules; active = nextActive;
  await db.user.update({ where: { id: userId }, data: { role, modules, is_active: active } });
}
before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe',
  });
  await db.user.create({ data: { id: userId, email: 'page-test@example.invalid', password_hash: 'unused', role } });
  const category = await db.productCategory.create({ data: { name: 'Diagnostic Kits', name_key: 'diagnostic kits' } });
  await db.product.createMany({ data: Array.from({ length: 61 }, (_, index) => ({
    name: `Product ${String(index).padStart(3, '0')}`, code: index === 60 ? 'KIT.987' : String(index + 1),
    category_id: category.id, description: index === 60 ? 'Special distant match' : '',
    sale_price: 12.5, cost_price: 7, quantity: 23.5, packaging_enabled: true, pieces_per_packet: 10, packet_sale_price: 120,
  })) });
  await db.product.create({ data: { name: 'Uncategorized item', code: 'no-number' } });
  await db.invoice.createMany({ data: Array.from({ length: 31 }, (_, index) => ({
    invoice_number: `TEST${index}`, client_name: 'Walk-in', is_walk_in: true,
    invoice_date: new Date(index < 2 ? '2026-10-20' : '2026-10-19'),
    grand_total: 10.25, amount_received: 3.1, balance_due: 7.15,
    created_at: new Date('2026-10-20T00:00:00Z'),
  })) });
  await db.invoice.create({ data: { invoice_number: 'PARTY', client_name: 'Party', invoice_date: new Date('2026-10-20'), grand_total: 9999 } });
});
after(async () => {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await db.$disconnect();
});

test('product pages are bounded, complete and stable even for tied names', async () => {
  const one = await get(products), two = await get(products, 'page=2'), three = await get(products, 'page=3');
  assert.equal(one.status, 200); assert.equal(one.count, 62);
  assert.deepEqual([one.products.length, two.products.length, three.products.length], [25, 25, 12]);
  assert.equal(new Set([...one.products, ...two.products, ...three.products].map(p => p.id)).size, 62);
  assert.equal(typeof one.products[0].quantity, 'number');
  assert.match(one.headers.get('cache-control'), /no-store/);
});
test('search finds code, description and category matches beyond the first page', async () => {
  for (const q of ['kit.987', 'DISTANT']) {
    const result = await get(products, new URLSearchParams({ q }));
    assert.equal(result.count, 1); assert.equal(result.products[0].code, 'KIT.987');
  }
  assert.equal((await get(products, 'q=diagnostic')).count, 61);
  assert.equal((await get(products, 'q=uncategorized')).count, 1);
  assert.equal((await get(products, 'q=nonexistent')).count, 0);
});
test('picker requests are bounded and omit cost data while preserving packaging prices', async () => {
  const result = await get(products, 'mode=picker');
  assert.equal(result.products.length, 20);
  assert.equal('cost_price' in result.products[0], false);
  assert.equal(result.products[0].pieces_per_packet, 10);
  assert.equal(result.products[0].packet_sale_price, 120);
  const match = await get(products, 'mode=picker&q=987');
  assert.equal(match.products[0].code, 'KIT.987');
});
test('next code considers the entire catalogue, including prefixed numeric codes', async () => {
  assert.equal((await get(products, 'mode=next-code')).code, '988');
});
test('invalid and out-of-range pages return a valid page with no skipped tail', async () => {
  assert.equal((await get(products, 'page=-1')).page, 1);
  assert.equal((await get(products, 'page=NaN')).page, 1);
  assert.equal((await get(products, 'page=999999999')).page, 3);
  assert.equal((await get(walk, 'page=999')).page, 2);
});
test('walk-in pagination excludes party invoices and has deterministic ordering', async () => {
  const first = await get(walk), last = await get(walk, 'page=2');
  assert.equal(first.count, 31); assert.equal(first.invoices.length, 25); assert.equal(last.invoices.length, 6);
  assert.equal(new Set([...first.invoices, ...last.invoices].map(i => i.id)).size, 31);
  assert.ok([...first.invoices, ...last.invoices].every(i => i.invoice_number !== 'PARTY'));
  assert.equal(first.invoices[0].invoice_date.length, 10);
});
test('summary aggregates all walk-in history independently of pagination', async () => {
  const { summary } = await get(walk, 'mode=summary&today=2026-10-20');
  assert.equal(summary.todayInvoices, 2); assert.equal(summary.todaySales, 20.5);
  assert.equal(summary.todayReceived, 6.2); assert.equal(summary.todayPending, 14.3);
  assert.equal(summary.totalInvoices, 31); assert.equal(summary.totalSales, 317.75);
  assert.equal(summary.totalReceived, 96.1); assert.equal(summary.totalPending, 221.65);
  assert.equal((await get(walk, 'mode=summary&today=2026-02-31')).status, 400);
});
test('read access follows module dependencies and disallows unrelated or inactive users', async () => {
  await setUser('sub_user', ['quick-invoice']);
  assert.equal((await get(products, 'mode=picker')).status, 200);
  assert.equal((await get(walk)).status, 200);
  assert.equal((await get(walk, 'mode=summary')).status, 403);
  await setUser('sub_user', ['workers']);
  assert.equal((await get(products)).status, 403); assert.equal((await get(walk)).status, 403);
  await setUser('super_admin', [], false);
  assert.equal((await get(products)).status, 403); assert.equal((await get(walk)).status, 403);
  await setUser('super_admin'); authenticated = false;
  assert.equal((await get(products)).status, 403); assert.equal((await get(walk)).status, 403);
  authenticated = true;
});
