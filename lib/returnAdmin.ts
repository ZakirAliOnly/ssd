import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";

export async function returnAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return null;
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user?.is_active || user.role !== "super_admin") return null;
  return { email: user.email, name: user.full_name || user.email.split("@")[0] };
}
