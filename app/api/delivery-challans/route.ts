import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/moduleAccess";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const auth = token ? await verifyToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { role: true, modules: true, is_active: true } });
  if (!user?.is_active || !canAccessPath(user, "/delivery-challan")) return NextResponse.json({ error: "Delivery challan access required." }, { status: 403 });
  try {
    const { invoiceId } = await request.json();
    if (typeof invoiceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
      return NextResponse.json({ error: "Select a valid invoice." }, { status: 400 });
    }
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const id = await prisma.$transaction(async tx => {
      // Serialize assignments so repeated loads and simultaneous users cannot consume duplicate numbers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(35001)`;
      const existing = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM delivery_challans WHERE invoice_id = ${invoiceId}::uuid`;
      if (existing.length) return existing[0].id;
      const created = await tx.$queryRaw<{ id: number }[]>`INSERT INTO delivery_challans (invoice_id) VALUES (${invoiceId}::uuid) RETURNING id`;
      return created[0].id;
    });
    return NextResponse.json({ number: `DC${String(id).padStart(3, "0")}` });
  } catch (error) {
    console.error("Delivery challan numbering failed", error);
    return NextResponse.json({ error: "Could not assign delivery challan number. Please try again." }, { status: 500 });
  }
}
