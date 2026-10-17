import { NextRequest, NextResponse } from "next/server";
import { settlePartyInvoices, partySettlementTransaction } from "@/lib/partyInvoiceSettlement";
import { prisma } from "@/lib/prisma";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { normalizeCategory, normalizeProduct, ProductValidationError } from "@/lib/productValidation";
import { purchaseLines, purchaseDate, receivePurchaseItems } from "@/lib/purchaseInventory";
import type { Prisma } from "@prisma/client";
import { applyStockChange, invoiceStockLines, InventoryError, createOpeningBatch, adjustProductStock } from "@/lib/inventory";
import { canAccessTable } from "@/lib/moduleAccess";

// Map Supabase snake_case table names → Prisma camelCase model accessors
const TABLE_MAP: Record<string, string> = {
  head_accounts: "headAccount",
  accounts: "account",
  products: "product",
  stock_batches: "stockBatch",
  product_categories: "productCategory",
  cashbook: "cashbook",
  invoices: "invoice",
  invoice_items: "invoiceItem",
  expenses: "expense",
  quick_invoices: "quickInvoice",
  quick_invoice_items: "quickInvoiceItem",
  quotation_products: "quotationProduct",
  quotations: "quotation",
  quotation_items: "quotationItem",
  suppliers: "supplier",
  purchase_orders: "purchaseOrder",
  purchase_order_items: "purchaseOrderItem",
  purchase_products: "purchaseProduct",
  workers: "worker",
  worker_advances: "workerAdvance",
  worker_payments: "workerPayment",
  worker_extra_hours: "workerExtraHours",
  laborers: "laborer",
  labor_tasks: "laborTask",
  labor_advances: "laborAdvance",
  payment_methods: "paymentMethod",
  activity_log: "activityLog",
};

// FK relations: maps (tableName, relationAlias) → prisma include key
// Supabase auto-discovers FK: accounts.head_id → head_accounts
// Prisma uses the relation field name declared in the schema
const RELATION_MAP: Record<string, Record<string, string>> = {
  products: { product_categories: "category" },
  accounts: { head_accounts: "head_account" },
  invoices: { invoice_items: "items" },
  quick_invoices: { quick_invoice_items: "items" },
  quotations: { quotation_items: "items", invoices: "source_invoice" },
  purchase_orders: { purchase_order_items: "items", suppliers: "supplier" },
  workers: { worker_advances: "advances", worker_payments: "payments" },
  laborers: { labor_tasks: "tasks", labor_advances: "advances" },
  labor_tasks: { laborers: "laborer" },
  worker_payments: { workers: "worker" },
  worker_advances: { workers: "worker" },
  invoice_items: { invoices: "invoice" },
};

type Filter = { type: string; col: string; val: unknown };
type Order  = { col: string; ascending: boolean };

interface DbRequest {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "save_invoice" | "save_purchase";
  purchaseId?: string;
  requestId?: string;
  items?: unknown[];
  invoiceId?: string;
  select?: string;
  filters?: Filter[];
  orders?: Order[];
  limit?: number | null;
  single?: boolean;
  data?: Record<string, unknown> | Record<string, unknown>[];
  selectAfterMutation?: string | null;
  count?: string | null;
  head?: boolean;
}

function parseSelectFields(select: string, table: string) {
  if (!select || select === "*") return undefined; // return all scalar fields

  // Check for relation patterns like "*, head_accounts(*)" or "id, name, head_accounts(name)"
  const relMap = RELATION_MAP[table] ?? {};
  const parts = select.split(",").map((s) => s.trim());

  const scalarFields: Record<string, true> = {};
  const includeFields: Record<string, unknown> = {};
  let hasWildcard = false;

  for (const part of parts) {
    const relMatch = part.match(/^(\w+)\(([^)]*)\)$/);
    if (relMatch) {
      const [, relName, relSelect] = relMatch;
      const prismaRel = relMap[relName];
      if (prismaRel) {
        if (relSelect === "*" || relSelect === "") {
          includeFields[prismaRel] = true;
        } else {
          const relFields = relSelect.split(",").map((s) => s.trim()).filter(Boolean);
          includeFields[prismaRel] = {
            select: Object.fromEntries(relFields.map((f) => [f, true])),
          };
        }
      }
    } else if (part === "*") {
      hasWildcard = true;
    } else if (part) {
      scalarFields[part] = true;
    }
  }

  if (Object.keys(includeFields).length === 0) {
    // No relations — just a column projection
    if (hasWildcard) return undefined;
    return { select: scalarFields };
  }

  // Has relations — use select + include pattern
  if (hasWildcard || Object.keys(scalarFields).length === 0) {
    return { include: includeFields };
  }
  return { select: { ...scalarFields, ...includeFields } };
}

function buildWhere(filters: Filter[], table?: string): Record<string, unknown> {
  const dateFields = table ? DATE_FIELDS[table] : undefined;
  const isDateCol = (col: string) => !!dateFields && dateFields.includes(col);
  // Prisma @db.Date columns must be filtered with Date objects, not bare YYYY-MM-DD strings.
  const coerce = (col: string, v: unknown) =>
    isDateCol(col) && typeof v === "string" && v ? new Date(v) : v;

  const where: Record<string, unknown> = {};
  for (const f of filters) {
    switch (f.type) {
      case "eq":
        where[f.col] = coerce(f.col, f.val);
        break;
      case "neq":
        where[f.col] = { not: coerce(f.col, f.val) };
        break;
      case "in":
        where[f.col] = { in: (f.val as unknown[]).map((v) => coerce(f.col, v)) };
        break;
      case "ilike": {
        // Supabase ilike uses % wildcards; strip them for Prisma contains
        const pattern = String(f.val).replace(/%/g, "");
        where[f.col] = { contains: pattern, mode: "insensitive" };
        break;
      }
      case "is":
        where[f.col] = f.val; // null
        break;
      case "gte":
        where[f.col] = { gte: coerce(f.col, f.val) };
        break;
      case "lte":
        where[f.col] = { lte: coerce(f.col, f.val) };
        break;
    }
  }
  return where;
}

function buildOrderBy(orders: Order[]) {
  return orders.map((o) => ({ [o.col]: o.ascending ? "asc" : "desc" }));
}

// Date fields per table — Prisma @db.Date requires a Date object, not a bare string
const DATE_FIELDS: Record<string, string[]> = {
  products:        ["expiry_date"],
  stock_batches:   ["expiry_date", "received_date"],
  invoices:        ["invoice_date", "due_date", "job_start", "job_end"],
  cashbook:        ["date"],
  expenses:        ["date"],
  purchase_orders: ["order_date"],
  purchase_order_items: ["expiry_date"],
  quotations:      ["quote_date"],
  worker_advances: ["date"],
  worker_payments: ["paid_date"],
  labor_tasks:     ["date"],
  labor_advances:  ["date"],
};

function coerceDates(data: Record<string, unknown>, table: string): Record<string, unknown> {
  const fields = DATE_FIELDS[table];
  if (!fields) return data;
  const out = { ...data };
  for (const field of fields) {
    const v = out[field];
    if (typeof v === "string" && v) {
      out[field] = new Date(v);
    }
  }
  return out;
}

// Tables that carry created_by_email / created_by_name. The API stamps these
// from the verified JWT on every insert so the activity log can attribute each
// "Created" row to a specific user without trusting the client.
const CREATOR_TABLES = new Set([
  "invoices",
  "cashbook",
  "expenses",
  "quick_invoices",
  "quotations",
  "purchase_orders",
  "labor_tasks",
  "worker_payments",
]);

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

// Atomically assign the next sequential po_number on insert. The client must
// not send po_number — whatever it sends is discarded. We compute max(suffix)+1
// across ALL existing rows, then retry on P2002 if a concurrent insert beat us
// to that number.
async function createPurchaseOrderWithUniquePoNumber(
  data: Record<string, unknown>,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string } & Record<string, unknown>> {
  const stripped = { ...data };
  delete stripped.po_number;

  const MAX_ATTEMPTS = 12;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await client.purchaseOrder.findMany({ select: { po_number: true } });
    let max = 0;
    for (const r of rows) {
      const m = /(\d+)$/.exec(r.po_number);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    const candidate = `PO${String(max + 1).padStart(3, "0")}`;
    try {
      return (await client.purchaseOrder.create({
        // The generic /api/db route hands us a Record<string, unknown>; the
        // Prisma create input is fully typed, but here we trust the caller's
        // shape (matched to the schema) — the ergonomic alternative would be
        // duplicating field validation. Same pattern as the generic
        // `model.create({ data: stampedRow })` below.
        data: { ...stripped, po_number: candidate } as unknown as Parameters<typeof prisma.purchaseOrder.create>[0]["data"],
      })) as { id: string } & Record<string, unknown>;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002") {
        if (client !== prisma) throw err;
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Failed to assign unique po_number after retries");
}

// Atomically assign the next sequential invoice_number ("SSD0xx") on insert.
// The client must not send invoice_number — whatever it sends is discarded.
// Walk-in and party invoices share ONE number sequence spread across both the
// `invoices` and `quick_invoices` tables, so max(suffix)+1 is computed across
// both. Retries on P2002 if a concurrent insert (from another tab/user) beat
// us to that number — this is what actually fixes the race that let two
// invoices collide on the same client-computed number.
async function createInvoiceWithUniqueNumber(
  data: Record<string, unknown>,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string } & Record<string, unknown>> {
  const stripped = { ...data };
  delete stripped.invoice_number;

  const MAX_ATTEMPTS = 12;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [invRows, qiRows] = await Promise.all([
      client.invoice.findMany({ select: { invoice_number: true } }),
      client.quickInvoice.findMany({ select: { invoice_number: true } }),
    ]);
    let max = 0;
    for (const r of [...invRows, ...qiRows]) {
      const m = /(\d+)$/.exec(r.invoice_number);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    const candidate = `SSD${String(max + 1).padStart(3, "0")}`;
    try {
      return (await client.invoice.create({
        data: { ...stripped, invoice_number: candidate } as unknown as Parameters<typeof prisma.invoice.create>[0]["data"],
      })) as { id: string } & Record<string, unknown>;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002") {
        if (client !== prisma) throw err;
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Failed to assign unique invoice_number after retries");
}

function stampUserFields(
  row: Record<string, unknown>,
  table: string,
  user: AuthUser,
): Record<string, unknown> {
  if (table === "activity_log") {
    return {
      ...row,
      user_id:    user.id,
      user_email: user.email,
      user_name:  user.name,
    };
  }
  if (CREATOR_TABLES.has(table)) {
    const out: Record<string, unknown> = { ...row };
    if (out.created_by_email == null || out.created_by_email === "") out.created_by_email = user.email;
    if (out.created_by_name  == null || out.created_by_name  === "") out.created_by_name  = user.name;
    return out;
  }
  return row;
}

// Recursively convert Decimal/BigInt/Date to plain JS values for JSON.
// `dateOnlyFields` are @db.Date columns that must round-trip as YYYY-MM-DD,
// not full ISO datetimes — string comparisons in callers depend on this.
function serialize(val: unknown, dateOnlyFields?: Set<string>, parentKey?: string): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "bigint") return Number(val);
  if (val !== null && typeof val === "object" && "toNumber" in (val as object)) {
    return (val as { toNumber: () => number }).toNumber();
  }
  if (val instanceof Date) {
    if (parentKey && dateOnlyFields?.has(parentKey)) {
      return val.toISOString().slice(0, 10);
    }
    return val.toISOString();
  }
  if (Array.isArray(val)) return val.map((v) => serialize(v, dateOnlyFields));
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = serialize(v, dateOnlyFields, k);
    }
    return out;
  }
  return val;
}

function serializeForTable(data: unknown, table: string): unknown {
  const fields = DATE_FIELDS[table];
  return serialize(data, fields ? new Set(fields) : undefined);
}

// Rename Prisma relation field names back to Supabase table names in response
// e.g. { head_account: {...} } → { head_accounts: {...} }
function renameRelations(data: unknown, table: string): unknown {
  if (!data || typeof data !== "object") return data;
  const relMap = RELATION_MAP[table] ?? {};
  const reverseMap: Record<string, string> = {};
  for (const [supabaseName, prismaName] of Object.entries(relMap)) {
    reverseMap[prismaName] = supabaseName;
  }
  if (Object.keys(reverseMap).length === 0) return data;

  if (Array.isArray(data)) return data.map((row) => renameRelations(row, table));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const newKey = reverseMap[k] ?? k;
    out[newKey] = v;
  }
  return out;
}

export async function POST(req: NextRequest) {
  // Auth guard — all DB operations require a valid session
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ data: null, error: { message: "Unauthorized" } }, { status: 401 });
  }
  const currentUser = await prisma.user.findUnique({
    where: { id: payload.sub }, select: { role: true, modules: true, is_active: true },
  });
  if (!currentUser?.is_active) {
    return NextResponse.json({ data: null, error: { message: "Unauthorized" } }, { status: 401 });
  }
  const authUser: AuthUser = {
    id:    payload.sub,
    email: payload.email,
    name:  payload.full_name || payload.email.split("@")[0],
  };

  const body = (await req.json()) as DbRequest;
  const { table, operation, filters = [], orders = [], limit, single, data, selectAfterMutation, count, head } = body;
  const select = body.select ?? "*";

  const forbidden = () => NextResponse.json({ data: null, error: { message: "You do not have access to this module." } }, { status: 403 });
  const balanceCacheUpdate = table === "accounts" && operation === "update" && data && !Array.isArray(data)
    && currentUser.modules.some(id => ["cashbook", "quick-invoice"].includes(id))
    && Object.keys(data).length > 0 && Object.keys(data).every(key => ["balance", "bal_type"].includes(key));
  if (!balanceCacheUpdate && !canAccessTable(currentUser, table, operation)) return forbidden();
  // Relation selections must not bypass the related table's permissions.
  for (const selection of [select, selectAfterMutation ?? ""]) {
    for (const relation of selection.matchAll(/([a-z_]+)\s*\(/g)) {
      if (!canAccessTable(currentUser, relation[1], "select")) return forbidden();
    }
  }
  if (currentUser.role !== "super_admin" && operation !== "select" && data) {
    // All module writes use scalar fields. Prevent nested Prisma writes to other
    // modules or relation-based updates that bypass their permission checks.
    const rows = Array.isArray(data) ? data : [data];
    if (rows.some(row => Object.values(row).some(value => value !== null && typeof value === "object"))) return forbidden();
  }

  const modelName = TABLE_MAP[table];
  if (!modelName) {
    return NextResponse.json({ data: null, error: { message: `Unknown table: ${table}` } }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelName];

  try {
    let result: unknown;
    if (operation === "save_purchase") {
      if (table !== "purchase_orders" || !data || Array.isArray(data)) throw new InventoryError("Invalid purchase save request.");
      const id = body.purchaseId ?? body.requestId;
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new InventoryError("Invalid purchase ID. Reload the app.");
      const items = purchaseLines(body.items);
      const orderDate = purchaseDate(data.order_date)!;
      const total = Math.round(items.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
      if (total <= 0 || total > 9999999999.99) throw new InventoryError("Enter a valid purchase total greater than zero.");
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const saved = await prisma.$transaction(async tx => {
            await tx.$queryRawUnsafe('SELECT id FROM purchase_orders WHERE id = $1::uuid FOR UPDATE', id);
            if (body.purchaseId) {
              const returns = await tx.supplierReturn.findMany({ where: { purchase_order_id: id }, take: 1 });
              if (returns.length) throw new InventoryError("This supplier invoice has returns and cannot be edited. Its original items must remain unchanged.");
            }
            const previous = await tx.purchaseOrder.findUnique({ where: { id } });
            if (!body.purchaseId && previous) return { ...previous, items: await tx.purchaseOrderItem.findMany({ where: { purchase_order_id: id } }) }; // Never receive twice.
            if (body.purchaseId && !previous) throw new InventoryError("Purchase invoice not found.");
            const supplierId = previous?.supplier_id ?? String(data.supplier_id ?? "");
            if (!/^[0-9a-f-]{36}$/i.test(supplierId ?? "")) throw new InventoryError("Select a supplier.");
            const supplier = await tx.supplier.findUnique({ where: { id: supplierId! } });
            if (!supplier) throw new InventoryError("This supplier no longer exists.");
            const paid = previous ? Number(previous.amount_paid) : Number(data.amount_paid ?? 0);
            if (!Number.isFinite(paid) || paid < 0 || paid > total) throw new InventoryError("Purchase total cannot be lower than the amount already paid.");
            const balance = Math.round((total - paid) * 100) / 100;
            const header = { order_date: orderDate, notes: String(data.notes ?? ""), subtotal: total, grand_total: total,
              balance_due: balance, payment_status: balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid" };
            const purchase = previous
              ? await tx.purchaseOrder.update({ where: { id }, data: header })
              : await createPurchaseOrderWithUniquePoNumber(stampUserFields({ ...header, id, supplier_id: supplier.id,
                  supplier_name: supplier.name, supplier_phone: supplier.phone, amount_paid: paid,
                  payment_method: String(data.payment_method ?? "Cash") }, table, authUser), tx);
            const savedItems = await receivePurchaseItems(tx, purchase.id, items, orderDate);
            return { ...purchase, items: savedItems };
          }, { timeout: 20000 });
          return NextResponse.json({ data: serializeForTable(saved, table), error: null });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (attempt < 4 && ["P2034", "P2002"].includes(code ?? "")) continue;
          throw error;
        }
      }
    }
    if (operation === "save_invoice") {
      if (table !== "invoices" || !data || Array.isArray(data)) throw new InventoryError("Invalid invoice save request.");
      if (body.invoiceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.invoiceId)) throw new InventoryError("Invalid invoice ID.");
      const items = invoiceStockLines(body.items);
      const header = coerceDates(data, "invoices");
      if ("items" in header || "id" in header) throw new InventoryError("Invalid invoice fields.");
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const saved = await prisma.$transaction(async tx => {
            // Updating the header locks the invoice before reading its old items.
            if (body.invoiceId) {
              await tx.$queryRawUnsafe('SELECT id FROM invoices WHERE id = $1::uuid FOR UPDATE', body.invoiceId);
              const returns = await tx.invoiceReturn.findMany({ where: { invoice_id: body.invoiceId }, take: 1 });
              if (returns.length) throw new InventoryError("This invoice has returns and cannot be edited. Its original items must remain unchanged.");
            }
            const invoice = body.invoiceId
              ? await tx.invoice.update({ where: { id: body.invoiceId }, data: header as Prisma.InvoiceUpdateInput })
              : await createInvoiceWithUniqueNumber(stampUserFields(header, "invoices", authUser), tx);
            const previous = body.invoiceId ? await tx.invoiceItem.findMany({ where: { invoice_id: invoice.id } }) : [];
            for (const line of items) {
              if (line.product_id || !line.category) continue;
              const matching = await tx.product.findMany({ where: { name: line.category }, select: { id: true }, take: 2 });
              if (matching.length > 1) throw new InventoryError("Select the product again so its stock can be identified.");
              if (matching.length === 1) line.product_id = matching[0].id;
            }
            const stockLines = await applyStockChange(tx, previous.map(line => ({ ...line, qty: Number(line.qty), stock_deducted_qty: Number(line.stock_deducted_qty) })), items, invoice.id);
            await tx.invoiceItem.deleteMany({ where: { invoice_id: invoice.id } });
            await tx.invoiceItem.createMany({ data: items.map((line, index) => ({ ...line, invoice_id: invoice.id, stock_deducted_qty: stockLines[index].stock_deducted_qty })) as Prisma.InvoiceItemCreateManyInput[] });
            if (!invoice.is_walk_in) await settlePartyInvoices(tx, String(invoice.client_name ?? ""));
            return await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
          }, { timeout: 15000 });
          return NextResponse.json({ data: serializeForTable(saved, "invoices"), error: null });
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (attempt < 4 && (code === "P2034" || (!body.invoiceId && code === "P2002"))) continue;
          throw err;
        }
      }
    }
    const prepareData = async (row: Record<string, unknown>, inserting: boolean) => {
      if (table === "stock_batches" || table === "purchase_order_items" || (table === "purchase_orders" && inserting)) throw new InventoryError("Reload the app to save purchases together with their stock batches.");
      if (table === "purchase_orders" && Object.keys(row).some(key => !["amount_paid", "balance_due", "payment_status", "cashbook_entry_id"].includes(key))) throw new InventoryError("Save purchase changes together with stock batches.");
      if (table === "products" && !inserting && "expiry_date" in row) throw new InventoryError("Change expiry in the purchase invoice for that batch.");
      if (table === "invoice_items") throw new InventoryError("Reload the app to save invoice items together with stock.");
      if (table === "invoices" && "items" in row) throw new InventoryError("Save invoice items together with stock.");
      if (table === "product_categories") return normalizeCategory(row);
      if (table !== "products") return row;
      const normalized = normalizeProduct(row, inserting);
      if (typeof normalized.category_id === "string") {
        const category = await prisma.productCategory.findUnique({ where: { id: normalized.category_id }, select: { id: true } });
        if (!category) throw new ProductValidationError("This category no longer exists. Select another category.");
      }
      return normalized;
    };

    if (operation === "select") {
      const where = buildWhere(filters, table);
      const orderBy = buildOrderBy(orders);
      const selectArgs = parseSelectFields(select, table);

      if (count === "exact" && head) {
        // COUNT query
        const cnt = await model.count({ where });
        return NextResponse.json({ data: null, error: null, count: cnt });
      }

      const queryArgs: Record<string, unknown> = { where, orderBy };
      if (limit != null) queryArgs.take = limit;
      if (selectArgs) {
        if ("select" in selectArgs) queryArgs.select = selectArgs.select;
        if ("include" in selectArgs) queryArgs.include = selectArgs.include;
      }

      if (single) {
        result = await model.findFirst(queryArgs);
        if (!result) {
          return NextResponse.json({ data: null, error: { message: "No rows found", code: "PGRST116" } });
        }
        result = serializeForTable(renameRelations(result, table), table);
        return NextResponse.json({ data: result, error: null });
      }

      result = await model.findMany(queryArgs);
      result = serializeForTable(renameRelations(result, table), table);
      return NextResponse.json({ data: result, error: null });
    }

    if (operation === "insert") {
      if (Array.isArray(data)) {
        if (table === "cashbook") {
          const rows = await Promise.all(data.map(async row => coerceDates(stampUserFields(await prepareData(row, true), table, authUser), table)));
          await partySettlementTransaction(prisma, async tx => {
            await tx.cashbook.createMany({ data: rows as Prisma.CashbookCreateManyInput[] });
            for (const name of new Set(rows.map(row => String(row.account_name ?? "")))) await settlePartyInvoices(tx, name);
          });
          return NextResponse.json({ data: null, error: null });
        }
        if (table === "products") {
          const rows = await Promise.all(data.map(async row => coerceDates(await prepareData(row, true), table)));
          await prisma.$transaction(async tx => {
            for (const row of rows) {
              const product = await tx.product.create({ data: row as Prisma.ProductUncheckedCreateInput });
              await createOpeningBatch(tx, product);
            }
          });
          return NextResponse.json({ data: null, error: null });
        }
        await model.createMany({
          data: await Promise.all(data.map(async (row) => coerceDates(stampUserFields(await prepareData(row, true), table, authUser), table))),
        });
        return NextResponse.json({ data: null, error: null });
      }
      const stampedRow = coerceDates(stampUserFields(await prepareData(data ?? {}, true), table, authUser), table);
      const inserted =
        table === "cashbook"
          ? await partySettlementTransaction(prisma, async tx => {
              const entry = await tx.cashbook.create({ data: stampedRow as Prisma.CashbookUncheckedCreateInput });
              await settlePartyInvoices(tx, entry.account_name);
              return entry;
            })
          : table === "products"
          ? await prisma.$transaction(async tx => {
              const product = await tx.product.create({ data: stampedRow as Prisma.ProductUncheckedCreateInput });
              await createOpeningBatch(tx, product);
              return product;
            })
          : table === "purchase_orders"
          ? await createPurchaseOrderWithUniquePoNumber(stampedRow)
          : table === "invoices"
          ? await createInvoiceWithUniqueNumber(stampedRow)
          : await model.create({ data: stampedRow });
      if (selectAfterMutation !== null && selectAfterMutation !== undefined) {
        // caller wants the inserted row back
        const fields = parseSelectFields(selectAfterMutation || "*", table);
        const fetchArgs: Record<string, unknown> = { where: { id: (inserted as { id: string }).id } };
        if (fields) {
          if ("select" in fields) fetchArgs.select = fields.select;
          if ("include" in fields) fetchArgs.include = fields.include;
        }
        const row = await model.findUnique(fetchArgs);
        if (single) {
          result = serializeForTable(renameRelations(row, table), table);
          return NextResponse.json({ data: result, error: null });
        }
        result = serializeForTable(renameRelations(row, table), table);
        return NextResponse.json({ data: [result], error: null });
      }
      result = serializeForTable(inserted, table);
      return NextResponse.json({ data: result, error: null });
    }

    if (operation === "update") {
      const where = buildWhere(filters, table);
      const updateData = await prepareData((data ?? {}) as Record<string, unknown>, false);
      if (table === "purchase_orders") {
        await prisma.$transaction(async tx => {
          const purchases = await tx.purchaseOrder.findMany({ where, orderBy: { id: "asc" } });
          for (const purchase of purchases) {
            await tx.$queryRawUnsafe('SELECT id FROM purchase_orders WHERE id = $1::uuid FOR UPDATE', purchase.id);
            const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchase.id } });
            const returns = await tx.supplierReturn.findMany({ where: { purchase_order_id: purchase.id } });
            const credit = returns.reduce((sum, item) => sum + Number(item.amount), 0);
            const paid = Number((updateData as Record<string, unknown>).amount_paid ?? fresh.amount_paid);
            if (!Number.isFinite(paid) || paid < 0 || Math.abs(paid - Math.round(paid * 100) / 100) > 0.00000001
              || (paid > Number(fresh.amount_paid) && paid > Math.max(0, Number(fresh.grand_total) - credit))) throw new InventoryError("Payment exceeds the supplier invoice balance after returns.");
            const due = Math.round((Number(fresh.grand_total) - credit - paid) * 100) / 100;
            await tx.purchaseOrder.update({ where: { id: fresh.id }, data: { ...coerceDates(updateData, table), amount_paid: paid,
              balance_due: due, payment_status: due <= 0 ? "paid" : paid > 0 || credit > 0 ? "partial" : "unpaid" } });
          }
        });
        return NextResponse.json({ data: null, error: null });
      }
      if (table === "invoices") {
        await prisma.$transaction(async tx => {
          const invoices = await tx.invoice.findMany({ where, select: { id: true, client_name: true }, orderBy: { id: "asc" } });
          for (const invoice of invoices) await tx.$queryRawUnsafe('SELECT id FROM invoices WHERE id = $1::uuid FOR UPDATE', invoice.id);
          const returns = await tx.invoiceReturn.findMany({ where: { invoice_id: { in: invoices.map(invoice => invoice.id) } }, take: 1 });
          if (returns.length) throw new InventoryError("This invoice has returns and cannot be edited. Record further payments separately in Cash Book.");
          await tx.invoice.updateMany({ where: { id: { in: invoices.map(invoice => invoice.id) } }, data: coerceDates(updateData, table) });
          for (const name of new Set([...invoices.map(i => i.client_name), String((updateData as Record<string, unknown>).client_name ?? "")])) await settlePartyInvoices(tx, name);
        });
        return NextResponse.json({ data: null, error: null });
      }
      if (table === "cashbook") {
        await partySettlementTransaction(prisma, async tx => {
          const entries = await tx.cashbook.findMany({ where, select: { id: true, account_name: true }, orderBy: { id: "asc" } });
          for (const entry of entries) await tx.$queryRawUnsafe('SELECT id FROM cashbook WHERE id = $1::uuid FOR UPDATE', entry.id);
          const returns = await tx.invoiceReturn.findMany({ where: { credit_entry_id: { in: entries.map(entry => entry.id) } }, take: 1 });
          const supplierReturns = await tx.supplierReturn.findMany({ where: { credit_entry_id: { in: entries.map(entry => entry.id) } }, take: 1 });
          if (returns.length || supplierReturns.length) throw new InventoryError("Return credits cannot be edited. Record a separate adjustment if needed.");
          await tx.cashbook.updateMany({ where: { id: { in: entries.map(entry => entry.id) } }, data: coerceDates(updateData, table) });
          for (const name of new Set([...entries.map(e => e.account_name), String((updateData as Record<string, unknown>).account_name ?? "")])) await settlePartyInvoices(tx, name);
        });
        return NextResponse.json({ data: null, error: null });
      }
      if (table === "products" && "quantity" in updateData) {
        const { quantity, expected_quantity, ...fields } = updateData;
        await prisma.$transaction(async tx => {
          const products = await tx.product.findMany({ where, orderBy: { id: "asc" } });
          if (products.length !== 1) throw new InventoryError("Select one product to adjust its stock.");
          const id = products[0].id;
          await tx.$queryRawUnsafe('SELECT id FROM products WHERE id = $1::uuid FOR UPDATE', id);
          const product = await tx.product.findUniqueOrThrow({ where: { id } });
          if (Number(product.quantity) !== Number(expected_quantity)) throw new InventoryError("Stock changed while you were editing. Reopen the product and try again.");
          await adjustProductStock(tx, product, Number(quantity));
          await tx.product.update({ where: { id }, data: coerceDates(fields, table) as Prisma.ProductUncheckedUpdateInput });
        });
        return NextResponse.json({ data: null, error: null });
      }
      await model.updateMany({ where, data: coerceDates(updateData, table) });
      return NextResponse.json({ data: null, error: null });
    }

    if (operation === "delete") {
      const where = buildWhere(filters, table);
      if (table === "cashbook") {
        await partySettlementTransaction(prisma, async tx => {
          const entries = await tx.cashbook.findMany({ where, select: { id: true, account_name: true }, orderBy: { id: "asc" } });
          for (const entry of entries) await tx.$queryRawUnsafe('SELECT id FROM cashbook WHERE id = $1::uuid FOR UPDATE', entry.id);
          const returns = await tx.invoiceReturn.findMany({ where: { credit_entry_id: { in: entries.map(entry => entry.id) } }, take: 1 });
          const supplierReturns = await tx.supplierReturn.findMany({ where: { credit_entry_id: { in: entries.map(entry => entry.id) } }, take: 1 });
          if (returns.length || supplierReturns.length) throw new InventoryError("Return credits cannot be deleted. Return history must remain intact.");
          await tx.cashbook.deleteMany({ where: { id: { in: entries.map(entry => entry.id) } } });
          for (const name of new Set(entries.map(e => e.account_name))) await settlePartyInvoices(tx, name);
        });
        return NextResponse.json({ data: null, error: null });
      }
      if (table === "purchase_orders") {
        if (currentUser.role !== "super_admin") return forbidden();
        await prisma.$transaction(async tx => {
          const purchases = await tx.purchaseOrder.findMany({ where, orderBy: { id: "asc" } });
          for (const purchase of purchases) {
            await tx.$queryRawUnsafe('SELECT id FROM purchase_orders WHERE id = $1::uuid FOR UPDATE', purchase.id);
            const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchase.id } });
            const returns = await tx.supplierReturn.findMany({ where: { purchase_order_id: purchase.id }, take: 1 });
            if (returns.length) throw new InventoryError("Purchase invoices with returns cannot be deleted.");
            const payments = await tx.cashbook.findMany({ where: { reference: purchase.id }, take: 1 });
            if (Number(fresh.amount_paid) > 0 || fresh.cashbook_entry_id || payments.length) throw new InventoryError("This purchase invoice has payments and cannot be deleted. Resolve its payments first.");
            const items = await tx.purchaseOrderItem.findMany({ where: { purchase_order_id: purchase.id } });
            const batches = await tx.stockBatch.findMany({ where: { purchase_item_id: { in: items.map(item => item.id) } } });
            const allocations = await tx.stockAllocation.findMany({ where: { batch_id: { in: batches.map(batch => batch.id) } }, take: 1 });
            if (allocations.length) throw new InventoryError("This purchase has sale history and cannot be deleted.");
            await receivePurchaseItems(tx, purchase.id, [], fresh.order_date);
            await tx.purchaseOrder.delete({ where: { id: purchase.id } });
            await tx.activityLog.create({ data: { action: "delete", entity_type: "purchase_order", entity_id: purchase.id,
              title: "Purchase Invoice Deleted", subtitle: fresh.po_number, amount: fresh.grand_total,
              user_email: authUser.email, user_name: authUser.name } });
          }
        }, { timeout: 15000 });
        return NextResponse.json({ data: null, error: null });
      }
      if (["purchase_order_items", "stock_batches"].includes(table)) throw new InventoryError("Purchase batches cannot be deleted directly. Edit the purchase invoice instead.");
      if (table === "products") {
        await prisma.$transaction(async tx => {
          const products = await tx.product.findMany({ where, select: { id: true }, orderBy: { id: "asc" } });
          for (const product of products) await tx.$queryRawUnsafe('SELECT id FROM products WHERE id = $1::uuid FOR UPDATE', product.id);
          const batches = await tx.stockBatch.findMany({ where: { product_id: { in: products.map(product => product.id) } } });
          const allocations = await tx.stockAllocation.findMany({ where: { batch_id: { in: batches.map(batch => batch.id) } }, take: 1 });
          if (batches.some(batch => batch.purchase_item_id) || allocations.length) throw new InventoryError("This product has purchase or sale history and cannot be deleted.");
          // An unused opening batch can be removed when its product is cancelled.
          await tx.stockBatch.deleteMany({ where: { id: { in: batches.map(batch => batch.id) } } });
          await tx.product.deleteMany({ where: { id: { in: products.map(product => product.id) } } });
        });
        return NextResponse.json({ data: null, error: null });
      }
      if (table === "invoice_items" || table === "invoices") {
        await prisma.$transaction(async tx => {
          const matches = table === "invoices"
            ? await tx.invoice.findMany({ where, select: { id: true } })
            : await tx.invoiceItem.findMany({ where, select: { invoice_id: true } });
          const ids = matches.map(row => "id" in row ? row.id : row.invoice_id).filter((id): id is string => !!id);
          const parties = await tx.invoice.findMany({ where: { id: { in: ids } }, select: { client_name: true } });
          for (const id of [...new Set(ids)].sort()) await tx.$queryRawUnsafe('SELECT id FROM invoices WHERE id = $1::uuid FOR UPDATE', id);
          const returns = await tx.invoiceReturn.findMany({ where: { invoice_id: { in: ids } }, take: 1 });
          if (returns.length) throw new InventoryError("Invoices with returns cannot be deleted. Return history must remain intact.");
          const itemWhere = table === "invoices" ? { invoice_id: { in: ids } } : where;
          const lines = await tx.invoiceItem.findMany({ where: itemWhere });
          for (const id of [...new Set(ids)].sort()) await applyStockChange(tx, lines.filter(line => line.invoice_id === id).map(line => ({ ...line, qty: Number(line.qty), stock_deducted_qty: Number(line.stock_deducted_qty) })), [], id);
          if (table === "invoices") await tx.invoice.deleteMany({ where: { id: { in: ids } } });
          else await tx.invoiceItem.deleteMany({ where: { id: { in: lines.map(line => line.id) } } });
          for (const name of new Set(parties.map(p => p.client_name))) await settlePartyInvoices(tx, name);
        }, { timeout: 15000 });
        return NextResponse.json({ data: null, error: null });
      }
      await model.deleteMany({ where });
      return NextResponse.json({ data: null, error: null });
    }

    return NextResponse.json({ data: null, error: { message: "Unknown operation" } }, { status: 400 });
  } catch (err) {
    if (err instanceof ProductValidationError || err instanceof InventoryError) {
      return NextResponse.json({ data: null, error: { message: err.message } }, { status: 400 });
    }
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2003" && table === "products") {
      return NextResponse.json({ data: null, error: { message: "This product is used in an invoice and cannot be deleted." } }, { status: 409 });
    }
    // P2002 = Prisma unique-constraint violation. Surface a clear message +
    // the conflicting field so the client can show something actionable
    // instead of a raw Prisma stack trace (e.g. duplicate invoice_number
    // from two invoices being created around the same time).
    if (code === "P2002") {
      const target = (err as { meta?: { target?: string[] | string } })?.meta?.target;
      const field = Array.isArray(target) ? target[0] : target;
      const message = field
        ? `Duplicate value for "${field}" — this ${field.replace(/_/g, " ")} already exists. Please refresh and try again.`
        : "Duplicate value — this record already exists. Please refresh and try again.";
      console.error(`[/api/db] ${table}.${operation} duplicate:`, field);
      return NextResponse.json({ data: null, error: { message, code: "P2002" } }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[/api/db] ${table}.${operation} error:`, message);
    return NextResponse.json({ data: null, error: { message } }, { status: 500 });
  }
}
