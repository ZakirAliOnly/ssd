import { db } from "@/lib/db";

export type ActivityAction = "create" | "update" | "delete";

export type ActivityEntityType =
  | "account"
  | "head_account"
  | "invoice"
  | "invoice_return"
  | "supplier_return"
  | "quick_invoice"
  | "cashbook"
  | "expense"
  | "quotation"
  | "worker"
  | "worker_advance"
  | "worker_extra_hours"
  | "worker_payment"
  | "laborer"
  | "labor_task"
  | "labor_advance"
  | "supplier"
  | "purchase_order"
  | "product";

export interface ActivityLogInput {
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId?: string;
  title?: string;
  subtitle?: string;
  amount?: number | null;
  metadata?: Record<string, unknown>;
}

export async function logActivity(input: ActivityLogInput): Promise<void> {
  // Deletions are audited atomically by /api/db, including calls from any screen.
  if (input.action === "delete") return;
  try {
    await db.from("activity_log").insert({
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? "",
      title: input.title ?? "",
      subtitle: input.subtitle ?? "",
      amount: input.amount ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : "",
    });
  } catch (e) {
    console.error("[activityLog] failed to log:", e);
  }
}
