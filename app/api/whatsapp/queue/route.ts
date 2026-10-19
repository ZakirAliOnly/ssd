import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbiddenWhatsApp, whatsappUser, whatsAppError } from "@/lib/whatsappApi";

export async function POST(req: NextRequest) {
  if (!await whatsappUser(req)) return forbiddenWhatsApp();
  const { id, action } = await req.json();
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || !["retry", "cancel"].includes(action)) return whatsAppError("Invalid queue action.");
  // Unknown/processing outcomes are intentionally never retried: WhatsApp may have
  // accepted them before a timeout. Reconcile in WhatsApp Manager instead.
  const result = await prisma.whatsAppMessage.updateMany({ where: { id, status: { in: action === "cancel" ? ["queued", "blocked", "failed"] : ["blocked"] } },
    data: action === "cancel" ? { status: "cancelled", reason: "Cancelled by administrator" }
      : { status: "queued", reason: "", available_at: new Date() } });
  if (!result.count) return whatsAppError("Only held messages can be retried. A message already sending or accepted cannot be recalled.", 409);
  return NextResponse.json({ ok: true });
}
