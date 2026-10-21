import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessTable } from "@/lib/moduleAccess";

/** Read endpoints use the same active-user and dependency grants as /api/db. */
export async function readAccess(request: NextRequest, tables: string[]) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return null;
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  return user?.is_active && tables.every(table => canAccessTable(user, table, "select")) ? user : null;
}

export function readPage(value: string | null) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1;
}

export const privateReadHeaders = { "Cache-Control": "private, no-store" };
