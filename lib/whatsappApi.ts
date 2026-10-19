import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

export async function whatsappUser(req: NextRequest, admin = true) {
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) return null;
    if (req.headers.get("sec-fetch-site") === "cross-site") return null;
  }
  const session = await verifyToken(req.cookies.get(COOKIE_NAME)?.value ?? "");
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  return user?.is_active && (!admin || user.role === "super_admin") ? user : null;
}

export const forbiddenWhatsApp = () => NextResponse.json({ error: "Administrator access required." }, { status: 403 });
export const whatsAppError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
