export type ReturnHistoryItem = { unit?: string; id: string; product_name: string; description: string; qty: string; amount: string; stock_restored_qty: string };
export type ReturnHistoryEntry = {
  id: string; type: "sales" | "supplier"; return_date: string; created_at: string; reason: string; amount: string; created_by_name: string;
  invoice_number: string; party: string; invoice_date: string; scope: "Whole invoice" | "Remaining invoice" | "Selected items";
  items: ReturnHistoryItem[];
};
type Quantity = { id: string; qty: unknown };
/** Describe saved quantities, rather than guessing which form button was clicked. */
export function returnScope(original: Quantity[], selected: Quantity[], previous: Quantity[]): ReturnHistoryEntry["scope"] {
  const sum = (rows: Quantity[], id: string) => rows.filter(r => r.id === id).reduce((n, r) => n + Math.round(Number(r.qty) * 100), 0);
  const lines = original.filter(r => Number(r.qty) > 0);
  if (!lines.length) return "Selected items";
  if (lines.every(line => sum(selected, line.id) === Math.round(Number(line.qty) * 100))) return "Whole invoice";
  if (lines.every(line => sum(selected, line.id) + sum(previous, line.id) === Math.round(Number(line.qty) * 100))) return "Remaining invoice";
  return "Selected items";
}
