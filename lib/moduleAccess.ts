export const MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "accounts", label: "Parties" },
  { id: "quick-invoice", label: "Walk-in Invoice" },
  { id: "returns", label: "Returns" },
  { id: "products", label: "Products" },
  { id: "supplier", label: "Suppliers / Purchase Invoices" },
  { id: "cashbook", label: "Cash Book" },
  { id: "head-accounts", label: "Head Accounts" },
  { id: "expense", label: "Expense" },
  { id: "workers", label: "Workers" },
  { id: "quote", label: "Quote" },
  { id: "delivery-challan", label: "Delivery Challan" },
  { id: "invoice-report", label: "Invoice Report" },
  { id: "reports", label: "Reports" },
  { id: "activity-log", label: "Activity Log" },
  { id: "payment-methods", label: "Payment Methods" },
] as const;

export const DEFAULT_MODULES = ["accounts", "quick-invoice"];
type AccessProfile = { role: string; modules?: string[] };
export function canAccessPath(profile: AccessProfile | null, path: string): boolean {
  if (!profile) return false;
  if (profile.role === "super_admin") return true;
  if (path === "/access-denied") return true;
  const moduleId = path.split("/")[1] === "invoices" ? "quick-invoice" : path.split("/")[1];
  return MODULES.some(item => item.id === moduleId) && (profile.modules ?? DEFAULT_MODULES).includes(moduleId);
}

export function firstAllowedPath(profile: AccessProfile): string {
  if (profile.role === "super_admin") return "/dashboard";
  const first = MODULES.find(item => (profile.modules ?? DEFAULT_MODULES).includes(item.id));
  return first ? `/${first.id}` : "/access-denied";
}

export function validateModules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(id => typeof id !== "string" || !MODULES.some(module => module.id === id))) {
    throw new Error("Select at least one valid module.");
  }
  return [...new Set(value)];
}

const BILLING = ["accounts", "quick-invoice"];
const TABLE_MODULES: Record<string, string[]> = {
  accounts: ["accounts"], head_accounts: ["head-accounts", "accounts"],
  products: ["products"], product_categories: ["products"],
  invoices: BILLING, invoice_items: BILLING, quick_invoices: BILLING, quick_invoice_items: BILLING,
  cashbook: ["cashbook", "accounts", "quick-invoice", "supplier", "expense", "workers"],
  expenses: ["expense", "accounts", "quick-invoice"],
  suppliers: ["supplier"], purchase_orders: ["supplier"], purchase_order_items: ["supplier"],
  workers: ["workers"], worker_advances: ["workers"], worker_payments: ["workers"], worker_extra_hours: ["workers"],
  quotation_products: ["quote"], quotations: ["quote", "accounts"], quotation_items: ["quote", "accounts"],
  payment_methods: ["payment-methods"], activity_log: ["activity-log"],
};
const READ_DEPENDENCIES: Record<string, string[]> = {
  products: [...BILLING, "supplier", "quote"], product_categories: BILLING,
  accounts: ["cashbook", "expense", "quote", "head-accounts", "invoice-report"], head_accounts: ["cashbook", "expense"],
  invoices: ["invoice-report", "delivery-challan", "quote", "supplier", "cashbook", "expense", "activity-log"],
  invoice_items: ["invoice-report", "delivery-challan", "quote"],
  quick_invoices: ["invoice-report"], quick_invoice_items: ["invoice-report"],
  suppliers: ["cashbook"], purchase_orders: ["cashbook", "activity-log"],
  worker_payments: ["activity-log"], quotations: ["activity-log"],
  cashbook: ["payment-methods", "activity-log"],
};

/** Module grants include data needed by that module's existing workflows. */
export function canAccessTable(profile: AccessProfile, table: string, operation: string): boolean {
  if (profile.role === "super_admin") return true;
  const modules = profile.modules ?? DEFAULT_MODULES;
  if (table === "stock_batches") return operation === "select" && canAccessTable(profile, "products", "select");
  if (operation === "insert" && table === "activity_log") return modules.length > 0;
  if (operation === "select") {
    if (table in TABLE_MODULES && modules.some(id => ["dashboard", "reports"].includes(id))) return true;
    if (table === "payment_methods") return modules.length > 0;
    if (READ_DEPENDENCIES[table]?.some(id => modules.includes(id))) return true;
  }
  return TABLE_MODULES[table]?.some(id => modules.includes(id)) ?? false;
}
