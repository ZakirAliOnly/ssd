type AuditRow = {
  id: string; action: string; entity_type: string; title?: string; subtitle?: string;
  amount?: unknown; created_at: string; user_email?: string; user_name?: string;
};

/** Old mirror-replacement events have no reliable parent/edit details to backfill. */
export function isInternalItemDeletion(row: Pick<AuditRow, "action" | "entity_type">) {
  return row.action === "delete" && row.entity_type === "quick_invoice_item";
}

export function editActivityEntry(row: AuditRow) {
  if (row.action !== "update") return null;
  return {
    id: `edit-${row.id}`, eventType: "edit" as const,
    title: row.title || `${row.entity_type.replaceAll("_", " ")} Edited`,
    subtitle: row.subtitle || row.entity_type,
    amount: row.amount == null ? undefined : Number(row.amount), timestamp: row.created_at,
    badge: "Edited", userEmail: row.user_email, userName: row.user_name,
  };
}
