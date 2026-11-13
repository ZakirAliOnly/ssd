import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";
import { buildSupplierStatements } from "@/lib/supplierStatement";
import type { Supplier, PurchaseOrder, CashbookEntry } from "@/lib/database.types";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active || !canAccessPath(user, "/supplier")) return NextResponse.json({ error: "Supplier access required." }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Choose a valid supplier." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      const supplier = await tx.supplier.findUnique({ where: { id } });
      if (!supplier) return null;
      const names = { equals: supplier.name, mode: "insensitive" as const };
      const [namedSuppliers, customers] = await Promise.all([
        tx.supplier.findMany({ where: { name: names } }),
        tx.account.findMany({ where: { name: names }, select: { name: true } }),
      ]);
      const purchases = await tx.purchaseOrder.findMany({ where: { OR: [{ supplier_id: id },
        ...(namedSuppliers.length === 1 ? [{ supplier_id: null, supplier_name: names }] : [])] }, orderBy: [{ order_date: "asc" }, { created_at: "asc" }, { id: "asc" }] });
      const cashbook = await tx.cashbook.findMany({ where: { OR: [
        { account_name: names }, { reference: { in: [id, ...purchases.map(p => p.id)] } },
        { id: { in: purchases.map(p => p.cashbook_entry_id).filter((v): v is string => !!v) } },
      ] } });
      // Reuse the reports' reference-aware rules, including double-counting and
      // paid-opening reconstruction, rather than a second name-only calculator.
      const statement = buildSupplierStatements(
        JSON.parse(JSON.stringify(namedSuppliers)) as Supplier[],
        JSON.parse(JSON.stringify(purchases)) as PurchaseOrder[],
        JSON.parse(JSON.stringify(cashbook)) as CashbookEntry[],
        "0001-01-01", "9999-12-31", customers.map(c => c.name),
      ).find(s => s.supplier.id === id)!;
      const purchaseIds = new Set(purchases.map(p => p.id));
      return { rows: statement.rows.map((row, index) => ({ date: row.date,
        sortAt: `${row.date}T${String(index).padStart(12, "0")}`, doc: row.reference,
        desc: row.description, method: row.method, debit: row.debit, credit: row.credit,
        ...(purchaseIds.has(row.id) ? { purchaseOrderId: row.id } : {}) })),
        purchaseIds: [...purchaseIds], warning: statement.warning, closing: statement.closing };
    }, { isolationLevel: "RepeatableRead" });
    return result ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  } catch (error) {
    console.error("Supplier ledger failed", error);
    return NextResponse.json({ error: "Could not load supplier ledger. Please retry." }, { status: 500 });
  }
}
