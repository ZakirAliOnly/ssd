export type ReturnReportRow = {
  id: string; returnId: string; date: string; invoiceNumber: string; customer: string;
  product: string; description: string; unit: string; originalQty: number; returnedQty: number;
  invoiceBefore: number | null; invoiceAfter: number | null;
  stockBefore: number | null; stockAfter: number | null; stockUnit: string | null;
  amount: number; reversedAt: string | null; reason: string;
};

type PriorReturn = { id: string; created_at: Date; reversed_at: Date | null;
  items: { invoice_item_id: string; qty: unknown }[] };

/** Backdated return dates do not change the order in which quantities were returned. */
export function invoiceQuantityBefore(originalQty: unknown, itemId: string, current: Pick<PriorReturn, "id" | "created_at">, history: PriorReturn[]) {
  const prior = history.filter(record => (record.created_at < current.created_at
    || (+record.created_at === +current.created_at && record.id < current.id))
    && (!record.reversed_at || record.reversed_at > current.created_at));
  const returned = prior.flatMap(record => record.items).filter(item => item.invoice_item_id === itemId)
    .reduce((sum, item) => sum + Number(item.qty), 0);
  return Math.round((Number(originalQty) - returned) * 100) / 100;
}

export function validReturnReportRange(from: string, to: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return validDate(from) && validDate(to) && from <= to;
}
