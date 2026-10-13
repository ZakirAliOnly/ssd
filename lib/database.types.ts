export type HeadAccountType = "Asset" | "Liability" | "Revenue" | "Expense";

export interface HeadAccount {
  id: string;
  code: string;
  name: string;
  type: HeadAccountType;
  bal: string;
  created_at: string;
}

export type AccountPartyType = "Client" | "Supplier";

export interface Account {
  id: string;
  name: string;
  head_id: string;
  /** Client vs Supplier — required by DB; may be missing on legacy rows until updated. */
  type?: AccountPartyType;
  phone: string;
  whatsapp: string;
  address: string;
  balance: number;
  bal_type: "debit" | "credit";
  status: "Active" | "Inactive";
  created_at: string;
  head_accounts?: HeadAccount;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  client_name: string;
  client_phone: string;
  client_address: string;
  client_ntn: string;
  client_email: string;
  invoice_date: string;
  due_date: string;
  payment_terms: string;
  reference: string;
  subtotal: number;
  discount_type: "pct" | "flat";
  discount_value: number;
  discount_amount: number;
  gst_pct: number;
  gst_amount: number;
  stax_pct: number;
  stax_amount: number;
  bra_pct: number;
  bra_amount: number;
  previous_balance: number;
  grand_total: number;
  amount_received: number;
  balance_due: number;
  payment_status: "unpaid" | "partial" | "paid";
  payment_method: string;
  job_name: string;
  job_location: string;
  job_start: string;
  job_end: string;
  job_notes: string;
  created_by_email: string;
  created_by_name: string;
  created_at: string;
}

export interface InvoiceItem {
  discount_pct?: number;
  product_id?: string | null;
  stock_deducted_qty?: number;
  id: string;
  invoice_id: string;
  category: string;
  description: string;
  width: number;
  height: number;
  sqft: number;
  rate: number;
  qty: number;
  amount: number;
}

/** Saved quotation — does not post to cashbook or invoices */
export interface Quotation {
  id: string;
  quote_number: string;
  party_name: string;
  quote_date: string;
  quote_time: string;
  cell: string;
  del_no: string;
  terms: string;
  recv_name: string;
  recv_date: string;
  deliver_name: string;
  source_invoice_id: string | null;
  grand_total: number;
  created_at: string;
}

export interface QuotationItem {
  id: string;
  quotation_id: string;
  product: string;
  description: string;
  width: number;
  height: number;
  sqft: number;
  rate: number;
  qty: number;
  amount: number;
}

export interface CashbookEntry {
  id: string;
  type: "in" | "out";
  description: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
  account_name?: string;
  created_at: string;
}

export interface Expense {
  id: string;
  /** Sequential human id, e.g. EXP-001 */
  expense_number?: string | null;
  /** Free-text category/label, e.g. "Material", "Glass" */
  category: string;
  /** Linked walk-in invoice (null if the invoice was deleted or standalone) */
  invoice_id?: string | null;
  invoice_number: string;
  description: string;
  amount: number;
  date: string;
  method: string;
  /** Once true, the project is locked — no more expenses can be added */
  completed?: boolean;
  /** Linked cashbook "out" entry that moved the cash */
  cashbook_entry_id?: string | null;
  created_by_email: string;
  created_by_name: string;
  created_at: string;
}

export interface QuickInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  created_at: string;
  items: QuickInvoiceItem[];
}

export interface Worker {
  id: string;
  name: string;
  phone: string;
  role: string;
  monthly_wage: number;
  /** Default Rs/hr pre-filled in the Extra hours modal; you can change it each time */
  hourly_overtime_rate?: number;
  /** Days used to derive daily wage for absence deduction (e.g. 26) */
  standard_working_days?: number;
  status: "Active" | "Inactive";
  created_at: string;
}

export interface WorkerAdvance {
  id: string;
  worker_id: string;
  amount: number;
  date: string;
  month: string;
  notes: string;
  cashbook_entry_id: string | null;
  created_at: string;
}

/** Manual extra-hour lines for a payroll month; payment_id set when wages are paid for that month. */
export interface WorkerExtraHours {
  id: string;
  worker_id: string;
  month: string;
  hours: number;
  rate_per_hour: number;
  amount: number;
  payment_id: string | null;
  created_at: string;
}

export interface WorkerPayment {
  id: string;
  worker_id: string;
  month: string;
  total_wage: number;
  advance_total: number;
  net_paid: number;
  paid_date: string;
  cashbook_entry_id: string | null;
  notes: string;
  overtime_hours?: number;
  overtime_amount?: number;
  absent_days?: number;
  absence_deduction?: number;
  created_at: string;
}

export interface QuickInvoiceItem {
  id: string;
  quick_invoice_id: string;
  product: string;
  width: number;
  height: number;
  total_size: number;
  rate_per_sqft: number;
  total: number;
  qty: number;
  grand_total: number;
}

export interface Laborer {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: "Active" | "Inactive";
  /** Advances taken without a job; applied first when adding a task */
  advance_balance: number;
  created_at: string;
}

export interface LaborAdvance {
  id: string;
  laborer_id: string;
  amount: number;
  date: string;
  notes: string;
  cashbook_entry_id: string | null;
  created_at: string;
}

export interface LaborTask {
  id: string;
  laborer_id: string;
  task_name: string;
  description: string;
  amount: number;
  advance: number;
  /** Subset of advance deducted from laborer.advance_balance when task was created */
  advance_from_balance: number;
  date: string;
  status: "pending" | "paid";
  cashbook_entry_id: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  /** Amount you already owed this supplier before POs here (payable; not cash until paid). */
  opening_balance?: number;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_phone: string;
  order_date: string;
  notes: string;
  subtotal: number;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  payment_status: "unpaid" | "partial" | "paid";
  payment_method: string;
  cashbook_entry_id: string | null;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  description: string;
  product_id: string | null;
  expiry_date: string | null;
  stock_received_qty: number;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
}
