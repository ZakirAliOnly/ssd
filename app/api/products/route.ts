import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { privateReadHeaders, readAccess, readPage } from "@/lib/readAccess";
import type { Prisma } from "@prisma/client";

const pickerFields = {
  id: true, code: true, name: true, description: true, sale_price: true, pricing_type: true,
  expiry_date: true, quantity: true, packaging_enabled: true, base_unit: true,
  pieces_per_packet: true, packets_per_box: true, packet_sale_price: true, box_sale_price: true,
  category: { select: { name: true } },
} satisfies Prisma.ProductSelect;
const listFields = { ...pickerFields, cost_price: true, category_id: true, created_at: true } satisfies Prisma.ProductSelect;

function productDto<T extends Record<string, unknown>>(product: T) {
  const { category, ...row } = product;
  const result: Record<string, unknown> = { ...row, product_categories: category };
  for (const key of ["quantity", "sale_price", "cost_price", "packet_sale_price", "box_sale_price"]) {
    if (key in result) result[key] = Number(result[key]);
  }
  return result;
}

export async function GET(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateReadHeaders });
  try {
    if (!await readAccess(request, ["products", "product_categories"])) return json({ error: "Product access required." }, 403);
    const params = request.nextUrl.searchParams;
    if (params.get("mode") === "next-code") {
      // Match the existing first-number convention without transferring the catalogue.
      const rows = await prisma.$queryRaw<{ code: string }[]>`
        SELECT ((COALESCE(MAX(substring(code from '[0-9]+')::numeric), 0) + 1)::text) AS code FROM products`;
      return json({ code: rows[0].code });
    }
    const picker = params.get("mode") === "picker";
    const q = (params.get("q") ?? "").trim().slice(0, 100);
    const where: Prisma.ProductWhereInput = q ? { OR: [
      { name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } },
      ...("uncategorized".includes(q.toLowerCase()) ? [{ category_id: null }] : []),
    ] } : {};
    if (picker) {
      const products = await prisma.product.findMany({ where, select: pickerFields, take: 20, orderBy: [{ name: "asc" }, { id: "asc" }] });
      return json({ products: products.map(productDto) });
    }
    const pageSize = 25;
    const result = await prisma.$transaction(async tx => {
      const count = await tx.product.count({ where });
      const page = Math.min(readPage(params.get("page")), Math.max(1, Math.ceil(count / pageSize)));
      const products = await tx.product.findMany({ where, select: listFields, take: pageSize, skip: (page - 1) * pageSize,
        orderBy: [{ name: "asc" }, { id: "asc" }] });
      return { products: products.map(productDto), count, page, pageSize };
    });
    return json(result);
  } catch (error) {
    console.error("Product read failed", error);
    return json({ error: "Could not load products. Please try again." }, 500);
  }
}
