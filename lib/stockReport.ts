export interface StockReportProduct {
  id: string; code: string; name: string; cost_price: number; category: string; created_at: string;
  batches: { received_date: string; received_qty: number; remaining_qty: number; allocations: { qty: number; date: string; cost: number | null }[] }[];
  sales: { date: string; qty: number; deducted: number; revenue: number }[];
}
export interface StockReportRow {
  id: string; code: string; name: string; category: string; opening: number | null;
  received: number; sold: number; available: number | null; costPrice: number;
  revenue: number; cost: number; profit: number; warning: string | null;
}
const money = (value: number) => Math.round(value * 100) / 100;

/** Spread invoice discounts across all lines, including other categories. Taxes are excluded. */
export function stockSaleRevenue(amount: number, invoiceLineTotal: number, discountAmount: number): number {
  const discount = invoiceLineTotal > 0 ? Math.max(0, Math.min(1, discountAmount / invoiceLineTotal)) : 0;
  return amount * (1 - discount);
}

export function buildStockReport(products: StockReportProduct[], from: string, to: string): StockReportRow[] {
  return products.filter(p => p.created_at.slice(0, 10) <= to).map(p => {
    let opening = 0, received = 0, consumed = 0, cost = 0, costQty = 0;
    let incomplete = false;
    let historicalAllocated = 0;
    const sales = p.sales.filter(s => s.date >= from && s.date <= to);
    for (const batch of p.batches) {
      const allocated = batch.allocations.reduce((sum, a) => sum + a.qty, 0);
      // Manual reductions have no dated movement record. Never invent a historical balance.
      if (money(batch.received_qty - batch.remaining_qty) !== money(allocated)) incomplete = true;
      if (batch.received_date < from) opening += batch.received_qty;
      else if (batch.received_date <= to) received += batch.received_qty;
      for (const a of batch.allocations) {
        if (a.date <= to) historicalAllocated += a.qty;
        if (a.date < from) opening -= a.qty;
        else if (a.date <= to) {
          consumed += a.qty;
          cost += a.qty * (a.cost ?? p.cost_price);
          costQty += a.qty;
        }
      }
    }
    const sold = sales.reduce((sum, s) => sum + s.qty, 0);
    const deducted = sales.reduce((sum, s) => sum + s.deducted, 0);
    const historicalDeducted = p.sales.filter(s => s.date <= to).reduce((sum, s) => sum + s.deducted, 0);
    if (money(deducted) !== money(consumed) || money(historicalDeducted) !== money(historicalAllocated) || money(opening) < 0 || money(opening + received - consumed) < 0 || p.sales.some(s => s.date <= to && s.deducted !== s.qty)) incomplete = true;
    cost += Math.max(0, sold - costQty) * p.cost_price;
    const revenue = money(sales.reduce((sum, s) => sum + s.revenue, 0));
    return { id: p.id, code: p.code, name: p.name, category: p.category,
      opening: incomplete ? null : money(opening), received: money(received), sold: money(sold),
      available: incomplete ? null : money(opening + received - consumed),
      costPrice: p.cost_price, revenue, cost: money(cost), profit: money(revenue - cost),
      warning: incomplete ? "Historical balance unavailable: untracked sales or stock adjustments." : null };
  });
}
