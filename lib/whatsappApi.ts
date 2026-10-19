import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

/** Nginx must preserve Host and overwrite X-Forwarded-Proto. Never trust X-Forwarded-Host. */
export function whatsAppOriginAllowed(req: NextRequest) {
  if (req.method === "GET") return true;
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // Authenticated non-browser callers may omit Origin.
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.slice(0, -1);
  if (!["http", "https"].includes(protocol) || !host || /[\s/@?#\\,]/.test(host)) return false;
  try {
    const expected = new URL(`${protocol}://${host}`).origin;
    return origin === expected;
  } catch { return false; }
}

export async function whatsappUser(req: NextRequest, admin = true) {
  if (!whatsAppOriginAllowed(req)) return null;
  const session = await verifyToken(req.cookies.get(COOKIE_NAME)?.value ?? "");
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  return user?.is_active && (!admin || user.role === "super_admin") ? user : null;
}

export const forbiddenWhatsApp = (req?: NextRequest) => NextResponse.json({
  error: req && !whatsAppOriginAllowed(req)
    ? "Request origin does not match this site. Check the HTTPS reverse-proxy settings."
    : "Administrator access required.",
}, { status: 403 });
export const whatsAppError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
