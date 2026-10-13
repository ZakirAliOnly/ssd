/** Display historical area-priced lines as per-unit prices without changing totals. */
export function invoiceUnitRate(line: { qty?: unknown; rate?: unknown; amount?: unknown; total?: unknown; discount_pct?: unknown }): number {
  if (Number(line.discount_pct) > 0) return Number(line.rate) || 0;
  const qty = Number(line.qty);
  const amount = line.amount ?? line.total;
  if (qty > 0 && amount !== undefined && Number.isFinite(Number(line.rate)) && invoiceLineTotal(Number(line.rate), qty) === Number(amount)) return Number(line.rate);
  if (qty > 0 && amount !== undefined && Number.isFinite(Number(amount))) return Number(amount) / qty;
  return Number(line.rate) || 0;
}

export function invoiceLineTotal(rate: number, qty: number, discountPct = 0): number {
  return Math.round(Number(rate) * Number(qty) * (1 - Math.min(100, Math.max(0, discountPct)) / 100) * 100) / 100;
}
