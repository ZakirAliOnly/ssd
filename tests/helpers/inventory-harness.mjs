import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import * as inventory from "../../lib/inventory.ts";
import * as productValidation from "../../lib/productValidation.ts";
import * as moduleAccess from "../../lib/moduleAccess.ts";

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = compile("../../app/api/db/route.ts");
const purchaseModule = { exports: {} };
new Function("require", "module", "exports", compile("../../lib/purchaseInventory.ts"))(
  name => name === "./inventory" ? inventory : require(name), purchaseModule, purchaseModule.exports);
const returnModule = { exports: {} };
new Function("require", "module", "exports", compile("../../lib/invoiceReturns.ts"))(
  name => name === "./inventory" ? inventory : require(name), returnModule, returnModule.exports);
const supplierReturnModule = { exports: {} };
new Function("require", "module", "exports", compile("../../lib/supplierReturns.ts"))(
  name => name === "./inventory" ? inventory : name === "./invoiceReturns" ? returnModule.exports : require(name), supplierReturnModule, supplierReturnModule.exports);

/** Rollback-capable adapter exercising the real route and batch algorithms. */
export function harness(profile = { role: "super_admin", modules: [], is_active: true }, openingQty = 10) {
  const productId = randomUUID(), supplierId = randomUUID(), openingId = randomUUID();
  let ticks = 0;
  let state = {
    products: [{ id: productId, code: "001", name: "Sign", quantity: openingQty, expiry_date: new Date("2027-12-31"), created_at: new Date("2026-01-01") }],
    batches: openingQty ? [{ id: openingId, product_id: productId, purchase_item_id: null,
      received_qty: openingQty, remaining_qty: openingQty, expiry_date: new Date("2027-12-31"), received_date: new Date("2026-01-01"), created_at: new Date("2026-01-01") }] : [],
    allocations: [], invoices: [], invoiceItems: [], purchases: [], purchaseItems: [],
    returns: [], returnItems: [], returnAllocations: [], cashbook: [], activity: [],
    supplierReturns: [], supplierReturnItems: [],
    suppliers: [{ id: supplierId, name: "Supplier", phone: "" }],
  };
  let transactions = 0;
  const rowBatch = row => state.batches.find(batch => batch.id === row.batch_id);
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, expected]) => {
      if (key === "OR") return expected.some(condition => matches(row, condition));
      if (key === "batch") return matches(rowBatch(row) ?? {}, expected);
      if (key === "invoice_id_batch_id") return matches(row, expected);
      if (expected && typeof expected === "object") {
        if (expected.contains != null) return String(row[key]).toLowerCase().includes(expected.contains.toLowerCase());
        if (expected.in) return expected.in.includes(row[key]);
        if (expected.gte != null) return row[key] >= expected.gte;
        if (expected.gt != null) return row[key] > expected.gt;
      }
      return row[key] === expected;
    });
  }
  function apply(row, data) {
    for (const [field, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "decrement" in value) row[field] -= value.decrement;
      else if (value && typeof value === "object" && "increment" in value) row[field] += value.increment;
      else row[field] = value;
    }
  }
  function model(key) {
    const hydrate = (row, include) => ({ ...row,
      ...(key === "purchases" && include?.items ? { items: state.purchaseItems.filter(item => item.purchase_order_id === row.id).map(item => ({ ...item,
        stock_batch: state.batches.find(batch => batch.purchase_item_id === item.id) ?? null,
        return_items: state.supplierReturnItems.filter(entry => entry.purchase_item_id === item.id),
      })) } : {}),
      ...(key === "purchases" && include?.returns ? { returns: state.supplierReturns.filter(entry => entry.purchase_order_id === row.id).map(entry => ({ ...entry, items: state.supplierReturnItems.filter(item => item.return_id === entry.id) })) } : {}),
      ...(key === "invoices" && include?.items ? { items: state.invoiceItems.filter(item => item.invoice_id === row.id).map(item => ({ ...item,
        product: state.products.find(product => product.id === item.product_id) ?? null,
        return_items: state.returnItems.filter(entry => entry.invoice_item_id === item.id),
      })) } : {}),
      ...(key === "invoices" && include?.returns ? { returns: state.returns.filter(entry => entry.invoice_id === row.id).map(entry => ({ ...entry, items: state.returnItems.filter(item => item.return_id === entry.id) })) } : {}),
      ...(key === "allocations" && include?.returns ? { returns: state.returnAllocations.filter(entry => entry.stock_allocation_id === row.id) } : {}),
    });
    const api = {
      async findMany({ where, select, include, orderBy, take } = {}) {
        let rows = state[key].filter(row => matches(row, where));
        const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        rows.sort((a, b) => {
          for (const sort of order) {
            const [field, direction] = Object.entries(sort)[0];
            const left = a[field] instanceof Date ? a[field].getTime() : a[field];
            const right = b[field] instanceof Date ? b[field].getTime() : b[field];
            if (left === right) continue;
            return (left < right ? -1 : 1) * (direction === "desc" ? -1 : 1);
          }
          return 0;
        });
        if (take) rows = rows.slice(0, take);
        return rows.map(row => select ? Object.fromEntries(Object.keys(select).map(field => [field, hydrate(row, select)[field]]))
          : { ...hydrate(row, include), ...(include?.stock_batch ? { stock_batch: state.batches.find(batch => batch.purchase_item_id === row.id) ?? null } : {}) });
      },
      async findUnique({ where, include }) { const row = state[key].find(row => matches(row, where)); return row ? hydrate(row, include) : null; },
      async count({ where } = {}) { return state[key].filter(row => matches(row, where)).length; },
      async findUniqueOrThrow(args) { const row = await api.findUnique(args); if (!row) throw new Error("Not found"); return row; },
      async create({ data }) {
        const row = { id: randomUUID(), created_at: new Date(Date.UTC(2026, 9, 6) + ticks++),
          ...(key === "purchaseItems" ? { stock_received_qty: 0 } : {}),
          ...(key === "batches" ? { purchase_item_id: null } : {}), ...data };
        if (key === "invoices") Object.assign(row, { discount_amount: 0, amount_received: 0, is_walk_in: false, ...row });
        state[key].push(row); return { ...row };
      },
      async update({ where, data }) { const row = state[key].find(row => matches(row, where)); if (!row) throw new Error("Not found"); apply(row, data); return { ...row }; },
      async updateMany({ where, data }) {
        const rows = state[key].filter(row => matches(row, where));
        for (const row of rows) apply(row, data);
        return { count: rows.length };
      },
      async upsert({ where, create, update }) { return await api.findUnique({ where }) ? api.update({ where, data: update }) : api.create({ data: create }); },
      async createMany({ data }) { for (const row of data) await api.create({ data: row }); },
      async delete({ where }) { const row = await api.findUniqueOrThrow({ where }); await api.deleteMany({ where }); return row; },
      async deleteMany({ where }) {
        const rows = state[key].filter(row => matches(row, where));
        state[key] = state[key].filter(row => !matches(row, where));
        if (key === "invoices") {
          state.invoiceItems = state.invoiceItems.filter(row => !rows.some(invoice => invoice.id === row.invoice_id));
          state.allocations = state.allocations.filter(row => !rows.some(invoice => invoice.id === row.invoice_id));
        }
        return { count: rows.length };
      },
    };
    return api;
  }
  const prisma = {
    product: model("products"), invoice: model("invoices"), invoiceItem: model("invoiceItems"), stockBatch: model("batches"),
    stockAllocation: model("allocations"), purchaseOrder: model("purchases"), purchaseOrderItem: model("purchaseItems"), supplier: model("suppliers"),
    quickInvoice: { findMany: async () => [] }, user: { findUnique: async () => profile }, $queryRawUnsafe: async () => [],
    invoiceReturn: model("returns"), invoiceReturnItem: model("returnItems"), returnStockAllocation: model("returnAllocations"),
    cashbook: model("cashbook"), activityLog: model("activity"),
    supplierReturn: model("supplierReturns"), supplierReturnItem: model("supplierReturnItems"),
  };
  prisma.$transaction = async callback => {
    if (Array.isArray(callback)) return Promise.all(callback);
    transactions++;
    const before = structuredClone(state);
    try { return await callback(prisma); } catch (error) { state = before; throw error; }
  };
  const module = { exports: {} };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/prisma": { prisma }, "@/lib/auth": { COOKIE_NAME: "auth", verifyToken: async () => ({ sub: randomUUID(), email: "test@example.com", full_name: "Test" }) },
    "@/lib/inventory": inventory, "@/lib/productValidation": productValidation, "@/lib/moduleAccess": moduleAccess,
    "@/lib/purchaseInventory": purchaseModule.exports,
    "@/lib/invoiceReturns": returnModule.exports,
    "@/lib/supplierReturns": supplierReturnModule.exports,
  };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] ?? require(name), module, module.exports);
  const returnRoute = { exports: {} };
  new Function("require", "module", "exports", compile("../../app/api/returns/route.ts"))(name => dependencies[name] ?? require(name), returnRoute, returnRoute.exports);
  const returnCall = body => returnRoute.exports.POST({ cookies: { get: () => ({ value: "test" }) }, json: async () => body });
  const returnGet = params => returnRoute.exports.GET({ cookies: { get: () => ({ value: "test" }) }, nextUrl: new URL(`http://localhost/api/returns?${new URLSearchParams(params)}`) });
  const call = body => module.exports.POST({ cookies: { get: () => ({ value: "test" }) }, json: async () => body });
  const save = (qty, invoiceId, total = qty * 100) => call({ table: "invoices", operation: "save_invoice", invoiceId,
    data: { client_name: "Test", invoice_date: "2026-10-06", grand_total: total },
    items: [{ product_id: productId, category: "Sign", qty, rate: 100, amount: total }] });
  const purchase = (qty, options = {}) => call({ table: "purchase_orders", operation: "save_purchase",
    purchaseId: options.purchaseId, requestId: options.requestId ?? randomUUID(),
    data: { supplier_id: supplierId, order_date: options.date ?? "2026-10-06", amount_paid: options.paid ?? 0 },
    items: [{ id: options.lineId, product_id: productId, description: "Sign", qty, rate: 100, expiry_date: options.expiryDate === undefined ? "2027-01-01" : options.expiryDate }] });
  return { call, save, purchase, returnCall, returnGet, planReturn: returnModule.exports.planInvoiceReturn,
    productId, supplierId, openingId, state: () => state, transactions: () => transactions };
}
