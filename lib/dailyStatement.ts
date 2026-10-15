export type DailyActivity = {
  id: string; kind: "Sale" | "Purchase" | "Sales return" | "Supplier return";
  reference: string; party: string; amount: number; details: string;
};
export type DailyCashEntry = { id: string; type: string; amount: number; description: string; method: string; reference: string };
export type DailyExpense = { id: string; reference: string; description: string; category: string; amount: number; completed: boolean };
export type DailyStatementData = {
  date: string; activity: DailyActivity[]; cash: DailyCashEntry[]; expenses: DailyExpense[];
};
const money = (n: number) => Math.round(n * 100) / 100;
export function dailyCashEntries(entries: DailyCashEntry[]) {
  return entries.filter(e => e.method.trim().toLowerCase() !== "adjustment"
    && !/^(opening balance|balance adjustment)/i.test(e.description));
}
export function dailyStatementTotals(data: DailyStatementData) {
  const cash = dailyCashEntries(data.cash);
  const income = money(cash.filter(e => e.type === "in").reduce((sum, e) => sum + e.amount, 0));
  const cashOut = money(cash.filter(e => e.type === "out").reduce((sum, e) => sum + e.amount, 0));
  const activityTotal = (kind: DailyActivity["kind"]) => money(data.activity.filter(e => e.kind === kind).reduce((sum, e) => sum + e.amount, 0));
  return { income, cashOut, netCash: money(income - cashOut),
    expenses: money(data.expenses.reduce((sum, e) => sum + e.amount, 0)),
    sales: activityTotal("Sale"), purchases: activityTotal("Purchase"),
    salesReturns: activityTotal("Sales return"), supplierReturns: activityTotal("Supplier return") };
}
