"use client";

import { useState, useEffect, useCallback } from "react";
import { usePaymentMethods, getMethodBalance, type PaymentMethod } from "@/lib/paymentMethods";
import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency, formatDate, todayISO } from "@/lib/helpers";
import {
  Plus, Users, Wallet, TrendingDown, CheckCircle,
  X, Trash2, Pencil, ChevronDown, ChevronUp, Clock, Loader2,
} from "lucide-react";
import type { Worker, WorkerAdvance, WorkerExtraHours, WorkerPayment } from "@/lib/database.types";
import { useUser } from "@/lib/UserContext";

import { confirmDialog } from "@/components/ConfirmModal";
import { logActivity } from "@/lib/activityLog";
import { useSaving } from "@/lib/useSaving";




// ─── Helpers ────────────────────────────────────────────────────────────────

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString("en-PK", {
    month: "long",
    year: "numeric",
  });
}

/** One day’s wage for absence = full monthly salary ÷ 30 (fixed calendar divisor). */
const ABSENCE_DAYS_DIVISOR = 30;

function computeWageSettlement(
  w: Worker,
  advancesForMonth: WorkerAdvance[],
  overtimeHoursTotal: number,
  overtimeAmountTotal: number,
  payAbsentDays: string
) {
  const totalWage = Number(w.monthly_wage);
  const advanceTotal = advancesForMonth.reduce((s, a) => s + Number(a.amount), 0);
  const perDayRate = totalWage / ABSENCE_DAYS_DIVISOR;

  const otHours = Math.max(0, overtimeHoursTotal);
  const overtimeAmount = Math.round(overtimeAmountTotal * 100) / 100;

  const absentDays = Math.max(0, parseFloat(String(payAbsentDays).replace(/,/g, "")) || 0);
  const absenceDeduction = Math.round(absentDays * perDayRate * 100) / 100;

  const adjustedGross = totalWage + overtimeAmount - absenceDeduction;
  const netPaid = Math.max(0, adjustedGross - advanceTotal);

  return {
    totalWage,
    advanceTotal,
    perDayRate,
    otHours,
    overtimeAmount,
    absentDays,
    absenceDeduction,
    adjustedGross,
    netPaid,
    absenceDaysDivisor: ABSENCE_DAYS_DIVISOR,
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerWithData = Worker & {
  advances: WorkerAdvance[];
  payment: WorkerPayment | null;
  /** Unpaid extra-hour lines for the selected payroll month */
  pendingExtraHours: WorkerExtraHours[];
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const userProfile = useUser();
  const { methods: paymentMethods } = usePaymentMethods();
  const { saving, run } = useSaving();
  const [workers, setWorkers] = useState<WorkerWithData[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Worker modal
  const [showWorkerModal, setShowWorkerModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [wName, setWName] = useState("");
  const [wPhone, setWPhone] = useState("");
  const [wRole, setWRole] = useState("");
  const [wWage, setWWage] = useState("");
  const [wOvertimeRate, setWOvertimeRate] = useState("");
  const [wStatus, setWStatus] = useState<"Active" | "Inactive">("Active");

  // Advance modal
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceWorker, setAdvanceWorker] = useState<Worker | null>(null);
  const [aAmount, setAAmount] = useState("");
  const [aDate, setADate] = useState(todayISO());
  const [aNotes, setANotes] = useState("");
  const [aMethod, setAMethod] = useState<PaymentMethod>("Cash");

  // Pay wages modal
  const [showPayModal, setShowPayModal] = useState(false);
  const [payWorker, setPayWorker] = useState<WorkerWithData | null>(null);
  const [payDate, setPayDate] = useState(todayISO());
  const [payNotes, setPayNotes] = useState("");
  const [payAbsentDays, setPayAbsentDays] = useState("");
  /** Month this wage payment is recorded for (chosen in Pay modal). */
  const [payForMonth, setPayForMonth] = useState(currentMonth());
  const [payModalAdvances, setPayModalAdvances] = useState<WorkerAdvance[]>([]);
  const [payModalExtraHours, setPayModalExtraHours] = useState<WorkerExtraHours[]>([]);
  const [payModalPayment, setPayModalPayment] = useState<WorkerPayment | null>(null);

  // Extra hours modal (manual entries before payday)
  const [showExtraHoursModal, setShowExtraHoursModal] = useState(false);
  const [extraHoursWorker, setExtraHoursWorker] = useState<Worker | null>(null);
  const [ehHours, setEhHours] = useState("");
  const [ehRate, setEhRate] = useState("");
  const [payContextLoading, setPayContextLoading] = useState(false);
  const [payWageMethod, setPayWageMethod] = useState<PaymentMethod>("Cash");

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const [{ data: workerData }, { data: advanceData }, { data: paymentData }, { data: extraHourData }] =
      await Promise.all([
        db.from("workers").select("*").order("name"),
        db.from("worker_advances").select("*").eq("month", selectedMonth).order("date"),
        db.from("worker_payments").select("*").eq("month", selectedMonth),
        db.from("worker_extra_hours").select("*").eq("month", selectedMonth).is("payment_id", null),
      ]);

    if (!workerData) return;

    const workerRows = workerData as Worker[];
    const advRows = (advanceData || []) as WorkerAdvance[];
    const payRows = (paymentData || []) as WorkerPayment[];
    const extras = (extraHourData || []) as WorkerExtraHours[];
    const enriched: WorkerWithData[] = workerRows.map((w) => ({
      ...w,
      advances: advRows.filter((a) => a.worker_id === w.id),
      payment: payRows.find((p) => p.worker_id === w.id) || null,
      pendingExtraHours: extras.filter((e) => e.worker_id === w.id),
    }));

    setWorkers(enriched);
  }, [selectedMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activeWorkers = workers.filter((w) => w.status === "Active");
  const totalWageBill = activeWorkers.reduce((s, w) => s + Number(w.monthly_wage), 0);
  const totalAdvances = workers.reduce(
    (s, w) => s + w.advances.reduce((a, adv) => a + Number(adv.amount), 0),
    0
  );
  const totalPaid = workers.reduce(
    (s, w) => s + (w.payment ? Number(w.payment.net_paid) : 0),
    0
  );

  // ── Worker CRUD ────────────────────────────────────────────────────────────

  function openAddWorker() {
    setEditingWorker(null);
    setWName(""); setWPhone(""); setWRole(""); setWWage("");
    setWOvertimeRate(""); setWStatus("Active");
    setShowWorkerModal(true);
  }

  function openEditWorker(w: Worker) {
    setEditingWorker(w);
    setWName(w.name); setWPhone(w.phone); setWRole(w.role);
    setWWage(String(w.monthly_wage));
    setWOvertimeRate(
      w.hourly_overtime_rate != null && Number(w.hourly_overtime_rate) > 0
        ? String(w.hourly_overtime_rate)
        : ""
    );
    setWStatus(w.status);
    setShowWorkerModal(true);
  }

  async function handleSaveWorker() {
    if (!wName.trim()) { showToast("Enter worker name", "err"); return; }
    const wage = parseFloat(wWage);
    if (!wage || wage <= 0) { showToast("Enter monthly salary", "err"); return; }
    const otRate = parseFloat(wOvertimeRate.replace(/,/g, "")) || 0;
    const payload = {
      name: wName.trim(),
      phone: wPhone,
      role: wRole,
      monthly_wage: wage,
      hourly_overtime_rate: otRate,
      status: wStatus,
    };

    if (editingWorker) {
      const { error } = await db.from("workers").update(payload).eq("id", editingWorker.id);
      if (error) { showToast(error.message, "err"); return; }
      showToast("Worker updated", "ok");
    } else {
      const { error } = await db.from("workers").insert(payload);
      if (error) { showToast(error.message, "err"); return; }
      showToast("Worker added", "ok");
    }

    setShowWorkerModal(false);
    fetchData();
  }

  async function handleDeleteWorker(w: Worker) {
    const ok = await confirmDialog({
      title: "Delete worker?",
      message: `Delete worker "${w.name}"? This cannot be undone.`,
      details: "All of their advances, extra-hours entries, and salary payment records will be removed too.",
      tone: "danger",
    });
    if (!ok) return;
    await db.from("workers").delete().eq("id", w.id);
    await logActivity({
      action: "delete",
      entityType: "worker",
      entityId: w.id,
      title: "Worker Deleted",
      subtitle: w.name,
      amount: Number(w.monthly_wage ?? 0) || null,
      metadata: { role: w.role, status: w.status },
    });
    showToast("Worker deleted", "ok");
    fetchData();
  }

  // ── Advance ────────────────────────────────────────────────────────────────

  function openAddAdvance(w: Worker) {
    setAdvanceWorker(w);
    setAAmount(""); setADate(todayISO()); setANotes(""); setAMethod("Cash");
    setShowAdvanceModal(true);
  }

  async function handleSaveAdvance() {
    if (!advanceWorker) return;
    const amt = parseFloat(aAmount);
    if (!amt || amt <= 0) { showToast("Enter valid amount", "err"); return; }
    if (!aMethod || !aMethod.trim()) { showToast("Please select a payment method", "err"); return; }
    if (!paymentMethods.some((m) => m.name === aMethod)) {
      showToast("Select a valid payment method", "err"); return;
    }

    // Cap advance at monthly salary
    const workerData = workers.find((w) => w.id === advanceWorker.id);
    const existingAdvTotal = workerData?.advances.reduce((s, a) => s + Number(a.amount), 0) ?? 0;
    const remaining = Number(advanceWorker.monthly_wage) - existingAdvTotal;
    if (amt > remaining) {
      showToast(
        remaining <= 0
          ? `${advanceWorker.name} has already taken their full salary as advance`
          : `Max advance allowed: ${formatCurrency(remaining)} (Salary: ${formatCurrency(Number(advanceWorker.monthly_wage))})`,
        "err"
      );
      return;
    }

    const available = await getMethodBalance(aMethod);
    if (amt > available) {
      showToast(`Not enough funds in "${aMethod}" (available ${formatCurrency(available)}). Choose a different payment method.`, "err");
      return;
    }

    // Insert cashbook entry (out = money leaving cash)
    const { data: cbEntry, error: cbErr } = await db
      .from("cashbook")
      .insert({
        type: "out",
        description: `Advance — ${advanceWorker.name} (${monthLabel(selectedMonth)})`,
        amount: amt,
        date: aDate,
        account_name: "",
        method: aMethod,
        reference: "",
      })
      .select("id")
      .single();

    if (cbErr) { showToast(cbErr.message, "err"); return; }

    // Insert advance record
    const { error } = await db.from("worker_advances").insert({
      worker_id: advanceWorker.id,
      amount: amt,
      date: aDate,
      month: selectedMonth,
      notes: aNotes,
      cashbook_entry_id: cbEntry?.id || null,
    });

    if (error) { showToast(error.message, "err"); return; }

    showToast(`Advance of ${formatCurrency(amt)} recorded for ${advanceWorker.name}`, "ok");
    setShowAdvanceModal(false);
    fetchData();
  }

  async function handleDeleteAdvance(adv: WorkerAdvance, workerName: string) {
    const ok = await confirmDialog({
      title: "Delete advance?",
      message: `Delete this advance of ${formatCurrency(Number(adv.amount))} for ${workerName}?`,
      details: adv.cashbook_entry_id ? "The linked cashbook entry will also be removed." : undefined,
      tone: "danger",
    });
    if (!ok) return;

    // Remove cashbook entry if linked
    if (adv.cashbook_entry_id) {
      await db.from("cashbook").delete().eq("id", adv.cashbook_entry_id);
    }

    await db.from("worker_advances").delete().eq("id", adv.id);
    await logActivity({
      action: "delete",
      entityType: "worker_advance",
      entityId: adv.id,
      title: "Worker Advance Deleted",
      subtitle: `${workerName} — ${adv.month}`,
      amount: Number(adv.amount),
    });
    showToast("Advance deleted", "ok");
    fetchData();
  }

  // ── Pay Wages ──────────────────────────────────────────────────────────────

  const loadPayrollMonthContext = useCallback(async (workerId: string, month: string) => {
    setPayContextLoading(true);
    try {
      const [{ data: advData }, { data: payData }, { data: extraData }] = await Promise.all([
        db.from("worker_advances").select("*").eq("worker_id", workerId).eq("month", month).order("date"),
        db.from("worker_payments").select("*").eq("worker_id", workerId).eq("month", month).limit(1),
        db
          .from("worker_extra_hours")
          .select("*")
          .eq("worker_id", workerId)
          .eq("month", month)
          .is("payment_id", null)
          .order("created_at"),
      ]);
      setPayModalAdvances(advData ?? []);
      setPayModalExtraHours((extraData ?? []) as WorkerExtraHours[]);
      const row = payData && payData.length > 0 ? payData[0] : null;
      setPayModalPayment(row as WorkerPayment | null);
    } finally {
      setPayContextLoading(false);
    }
  }, []);

  function openPayWages(w: WorkerWithData) {
    setPayWorker(w);
    setPayForMonth(selectedMonth);
    setPayDate(todayISO());
    setPayNotes("");
    setPayAbsentDays("");
    setPayWageMethod("Cash");
    setPayModalAdvances([]);
    setPayModalExtraHours([]);
    setPayModalPayment(null);
    setShowPayModal(true);
    void loadPayrollMonthContext(w.id, selectedMonth);
  }

  function openAddExtraHours(w: Worker) {
    const row = workers.find((x) => x.id === w.id);
    if (row?.payment) {
      showToast(`Extra hours can only be added before wages are paid for ${monthLabel(selectedMonth)}`, "err");
      return;
    }
    setExtraHoursWorker(w);
    setEhHours("");
    setEhRate(
      w.hourly_overtime_rate != null && Number(w.hourly_overtime_rate) > 0
        ? String(w.hourly_overtime_rate)
        : ""
    );
    setShowExtraHoursModal(true);
  }

  async function handleSaveExtraHours() {
    if (!extraHoursWorker) return;
    const row = workers.find((x) => x.id === extraHoursWorker.id);
    if (row?.payment) {
      showToast("This worker is already paid for this month", "err");
      return;
    }
    const h = parseFloat(String(ehHours).replace(/,/g, ""));
    const r = parseFloat(String(ehRate).replace(/,/g, ""));
    if (!Number.isFinite(h) || h <= 0) {
      showToast("Enter extra hours (greater than zero)", "err");
      return;
    }
    if (!Number.isFinite(r) || r <= 0) {
      showToast("Enter rate per hour (greater than zero)", "err");
      return;
    }
    const amount = Math.round(h * r * 100) / 100;
    const { error } = await db.from("worker_extra_hours").insert({
      worker_id: extraHoursWorker.id,
      month: selectedMonth,
      hours: h,
      rate_per_hour: r,
      amount,
    });
    if (error) {
      showToast(error.message, "err");
      return;
    }
    showToast(`Added ${h}h @ ${formatCurrency(r)}/hr (${formatCurrency(amount)})`, "ok");
    setShowExtraHoursModal(false);
    fetchData();
  }

  async function handleDeleteExtraHoursEntry(entry: WorkerExtraHours, workerName: string) {
    if (entry.payment_id) {
      showToast("This entry is already tied to a payment and cannot be deleted here", "err");
      return;
    }
    const ok = await confirmDialog({
      title: "Remove extra hours?",
      message: `Remove ${entry.hours}h @ ${formatCurrency(Number(entry.rate_per_hour))}/hr (${formatCurrency(Number(entry.amount))}) for ${workerName}?`,
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await db.from("worker_extra_hours").delete().eq("id", entry.id);
    if (error) {
      showToast(error.message, "err");
      return;
    }
    await logActivity({
      action: "delete",
      entityType: "worker_extra_hours",
      entityId: entry.id,
      title: "Extra Hours Removed",
      subtitle: `${workerName} — ${entry.month}`,
      amount: Number(entry.amount),
    });
    showToast("Extra hours entry removed", "ok");
    fetchData();
  }

  async function handlePayWages() {
    if (!payWorker) return;
    if (payModalPayment) {
      showToast(`This worker is already marked paid for ${monthLabel(payForMonth)}`, "err");
      return;
    }

    const otHours = payModalExtraHours.reduce((s, e) => s + Number(e.hours), 0);
    const overtimeAmount =
      Math.round(payModalExtraHours.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;

    const {
      totalWage,
      advanceTotal,
      absentDays,
      absenceDeduction,
      netPaid,
    } = computeWageSettlement(payWorker, payModalAdvances, otHours, overtimeAmount, payAbsentDays);

    if (netPaid > 0) {
      if (!payWageMethod || !payWageMethod.trim()) {
        showToast("Please select a payment method", "err"); return;
      }
      if (!paymentMethods.some((m) => m.name === payWageMethod)) {
        showToast("Select a valid payment method", "err"); return;
      }
      const available = await getMethodBalance(payWageMethod);
      if (netPaid > available) {
        showToast(`Not enough funds in "${payWageMethod}" (available ${formatCurrency(available)}). Choose a different payment method.`, "err");
        return;
      }
    }

    let cashbookEntryId: string | null = null;
    if (netPaid > 0) {
      const { data: cbEntry, error: cbErr } = await db
        .from("cashbook")
        .insert({
          type: "out",
          description: `Wages — ${payWorker.name} (${monthLabel(payForMonth)})`,
          amount: netPaid,
          date: payDate,
          account_name: "",
          method: payWageMethod,
          reference: "",
        })
        .select("id")
        .single();

      if (cbErr) { showToast(cbErr.message, "err"); return; }
      cashbookEntryId = cbEntry?.id ?? null;
    }

    // Insert payment record
    const { data: insertedPay, error } = await db
      .from("worker_payments")
      .insert({
        worker_id: payWorker.id,
        month: payForMonth,
        total_wage: totalWage,
        advance_total: advanceTotal,
        net_paid: netPaid,
        paid_date: payDate,
        cashbook_entry_id: cashbookEntryId,
        notes: payNotes,
        overtime_hours: otHours,
        overtime_amount: overtimeAmount,
        absent_days: absentDays,
        absence_deduction: absenceDeduction,
      })
      .select("id")
      .single();

    if (error) { showToast(error.message, "err"); return; }

    if (insertedPay?.id && payModalExtraHours.length > 0) {
      const { error: linkErr } = await db
        .from("worker_extra_hours")
        .update({ payment_id: insertedPay.id })
        .eq("worker_id", payWorker.id)
        .eq("month", payForMonth)
        .is("payment_id", null);
      if (linkErr) {
        showToast(`Paid but could not link extra hours: ${linkErr.message}`, "err");
        fetchData();
        return;
      }
    }

    showToast(`Wages paid: ${formatCurrency(netPaid)} to ${payWorker.name}`, "ok");
    setShowPayModal(false);
    fetchData();
  }

  async function handleUndoPayment(w: WorkerWithData) {
    if (!w.payment) return;
    const ok = await confirmDialog({
      title: "Undo wage payment?",
      message: `Undo wage payment for ${w.name} (${monthLabel(selectedMonth)})? Net paid: ${formatCurrency(Number(w.payment.net_paid))}.`,
      details: w.payment.cashbook_entry_id ? "The linked cashbook entry will also be removed." : undefined,
      confirmText: "Undo payment",
      tone: "warn",
    });
    if (!ok) return;

    if (w.payment.cashbook_entry_id) {
      await db.from("cashbook").delete().eq("id", w.payment.cashbook_entry_id);
    }
    const paymentId = w.payment.id;
    const netPaid = Number(w.payment.net_paid);
    await db.from("worker_payments").delete().eq("id", paymentId);
    await logActivity({
      action: "delete",
      entityType: "worker_payment",
      entityId: paymentId,
      title: "Wage Payment Undone",
      subtitle: `${w.name} — ${monthLabel(selectedMonth)}`,
      amount: netPaid,
    });
    showToast("Payment undone", "ok");
    fetchData();
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  const inputStyle = { borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" };

  // Month options: last 12 months
  const monthOptions: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    monthOptions.push(d.toISOString().slice(0, 7));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Workers</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Manage employees, wages &amp; advances</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Month selector */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border-[1.5px] rounded-[9px] px-3 py-2 text-[12.5px] font-semibold outline-none cursor-pointer"
            style={inputStyle}
            title="Payroll month"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
          <button
            onClick={openAddWorker}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white"
            style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}
          >
            <Plus size={14} /> Add Worker
          </button>
        </div>
      </div>

      <div
        className="mb-4 rounded-[12px] border border-[var(--blue-light)] px-4 py-3 text-[12px]"
        style={{ background: "var(--blue-pale)", color: "var(--gray-900)" }}
      >
        <span className="font-bold" style={{ color: "var(--blue-deeper)" }}>Payroll month: </span>
        {monthLabel(selectedMonth)}. Advances and wage payments are stored per month — pick another month above to
        work on a different period (each month has its own advances, paid/unpaid state, and resets automatically).
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-5">
        <StatCard icon={<Users size={18} />} iconBg="var(--blue-light)" iconColor="var(--blue-deeper)"
          label="Active Workers" value={String(activeWorkers.length)} />
        <StatCard icon={<Wallet size={18} />} iconBg="var(--green-light)" iconColor="var(--green)"
          label="Monthly Wage Bill" value={formatCurrency(totalWageBill)} />
        <StatCard icon={<TrendingDown size={18} />} iconBg="var(--red-light)" iconColor="var(--red)"
          label="Advances This Month" value={formatCurrency(totalAdvances)} />
        <StatCard icon={<CheckCircle size={18} />} iconBg="var(--gray-100)" iconColor="var(--gray-500)"
          label="Wages Paid" value={formatCurrency(totalPaid)} />
      </div>

      {/* Workers list */}
      <div className="flex flex-col gap-3">
        {workers.length === 0 ? (
          <div className="bg-white rounded-[14px] border border-[var(--gray-100)] text-center py-12 text-[13px]"
            style={{ color: "var(--gray-800)", boxShadow: "var(--shadow-sm)" }}>
            No workers found. Add your first worker.
          </div>
        ) : (
          workers.map((w) => {
            const advTotal = w.advances.reduce((s, a) => s + Number(a.amount), 0);
            const extraHoursTotal = w.pendingExtraHours.reduce((s, e) => s + Number(e.hours), 0);
            const extraAmountTotal =
              Math.round(w.pendingExtraHours.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
            const netWage = Math.max(0, Number(w.monthly_wage) - advTotal);
            const isPaid = !!w.payment;
            const isExpanded = expandedId === w.id;
            const isActive = w.status === "Active";

            return (
              <div key={w.id} className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden"
                style={{ boxShadow: "var(--shadow-sm)" }}>
                {/* Worker row */}
                <div className="flex items-center gap-3 px-4 py-3.5 flex-wrap">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-white"
                    style={{ background: isActive ? "linear-gradient(135deg, var(--blue-deeper), var(--blue))" : "var(--gray-300)" }}>
                    {w.name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2)}
                  </div>

                  {/* Name + role */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-bold" style={{ color: "var(--gray-900)" }}>{w.name}</span>
                      {w.role && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}>
                          {w.role}
                        </span>
                      )}
                      {!isActive && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
                          Inactive
                        </span>
                      )}
                    </div>
                    {w.phone && (
                      <div className="text-[11.5px] mt-0.5" style={{ color: "var(--gray-800)" }}>{w.phone}</div>
                    )}
                  </div>

                  {/* Wage breakdown */}
                  <div className="hidden sm:flex items-center gap-5 text-right">
                    <div>
                      <div className="text-[10px] font-bold tracking-[1px] uppercase mb-0.5" style={{ color: "var(--gray-800)" }}>Monthly Wage</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: "var(--gray-900)" }}>{formatCurrency(Number(w.monthly_wage))}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold tracking-[1px] uppercase mb-0.5" style={{ color: "var(--gray-800)" }}>Advances</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: advTotal > 0 ? "var(--red)" : "var(--gray-400)" }}>
                        {advTotal > 0 ? `− ${formatCurrency(advTotal)}` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold tracking-[1px] uppercase mb-0.5" style={{ color: "var(--gray-800)" }}>Extra hrs</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: extraAmountTotal > 0 ? "var(--green)" : "var(--gray-400)" }}>
                        {extraAmountTotal > 0 ? (
                          <>
                            + {formatCurrency(extraAmountTotal)}
                            <span className="text-[10px] font-semibold ml-1" style={{ color: "var(--gray-800)" }}>({extraHoursTotal}h)</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold tracking-[1px] uppercase mb-0.5" style={{ color: "var(--gray-800)" }}>Net Payable</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: "var(--green)" }}>{formatCurrency(netWage)}</div>
                    </div>
                  </div>

                  {/* Status badge + actions */}
                  <div className="flex items-center gap-2 ml-auto sm:ml-0">
                    {isPaid ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1"
                          style={{ background: "var(--green-light)", color: "var(--green)" }}>
                          <CheckCircle size={11} /> Paid
                        </span>

                        <button onClick={() => handleUndoPayment(w)}
                          className="text-[10.5px] font-semibold px-2 py-1 rounded-[7px] border-[1.5px] cursor-pointer bg-white"
                          style={{ borderColor: "var(--gray-200)", color: "var(--gray-800)" }}
                          title="Undo payment">
                          Undo
                        </button>
                      </div>
                    ) : (
                      isActive && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button onClick={() => openPayWages(w)}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-[8px] border-none cursor-pointer text-white flex items-center gap-1"
                            style={{ background: "var(--blue)" }}>
                            <Wallet size={12} /> Pay Wages
                          </button>
                          <button
                            onClick={() => openAddExtraHours(w)}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-[8px] border-[1.5px] cursor-pointer flex items-center gap-1 bg-white"
                            style={{ borderColor: "var(--blue-light)", color: "var(--blue-deeper)" }}
                            title="Add extra hours (accumulates for this month)"
                          >
                            <Clock size={12} /> Extra hours
                          </button>
                        </div>
                      )
                    )}

                    {isActive && (
                      <button onClick={() => openAddAdvance(w)}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-[8px] border-[1.5px] cursor-pointer bg-white flex items-center gap-1"
                        style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                        <Plus size={11} /> Advance
                      </button>
                    )}

                    <button onClick={() => openEditWorker(w)}
                      className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white transition-all hover:bg-[var(--blue-pale)]"
                      style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                      <Pencil size={13} />
                    </button>

                    {userProfile?.isAdmin && (
                      <button onClick={() => handleDeleteWorker(w)}
                        className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white transition-all hover:bg-[var(--red-light)]"
                        style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}>
                        <Trash2 size={13} />
                      </button>
                    )}

                    <button
                      onClick={() => setExpandedId(isExpanded ? null : w.id)}
                      className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white"
                      style={{ borderColor: "var(--gray-200)", color: "var(--gray-800)" }}>
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Mobile wage row */}
                <div className="sm:hidden flex items-center gap-4 px-4 pb-3 border-t border-[var(--gray-100)] pt-3">
                  <div className="flex-1">
                    <div className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-800)" }}>Wage</div>
                    <div className="text-[12.5px] font-bold font-mono">{formatCurrency(Number(w.monthly_wage))}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-800)" }}>Advance</div>
                    <div className="text-[12.5px] font-bold font-mono" style={{ color: advTotal > 0 ? "var(--red)" : "var(--gray-400)" }}>
                      {advTotal > 0 ? `− ${formatCurrency(advTotal)}` : "—"}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-800)" }}>Extra</div>
                    <div className="text-[12.5px] font-bold font-mono" style={{ color: extraAmountTotal > 0 ? "var(--green)" : "var(--gray-400)" }}>
                      {extraAmountTotal > 0 ? `+${formatCurrency(extraAmountTotal)}` : "—"}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-bold tracking-[1px] uppercase" style={{ color: "var(--gray-800)" }}>Net</div>
                    <div className="text-[12.5px] font-bold font-mono" style={{ color: "var(--green)" }}>{formatCurrency(netWage)}</div>
                  </div>
                </div>

                {/* Expanded: advances list */}
                {isExpanded && (
                  <div className="border-t border-[var(--gray-100)] px-4 py-3">
                    {!isPaid && (
                      <>
                        <div className="text-[10.5px] font-bold tracking-[1.5px] uppercase mb-2" style={{ color: "var(--gray-800)" }}>
                          Extra hours — {monthLabel(selectedMonth)}
                        </div>
                        {w.pendingExtraHours.length === 0 ? (
                          <div className="text-[12px] py-2 mb-4" style={{ color: "var(--gray-800)" }}>
                            No extra hours yet. Use <b>Extra hours</b> next to Pay Wages to add entries (each save adds to the month total).
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 mb-4">
                            {w.pendingExtraHours.map((ex) => (
                              <div key={ex.id} className="flex items-center gap-3 px-3 py-2 rounded-[8px]"
                                style={{ background: "var(--green-light)" }}>
                                <Clock size={13} style={{ color: "var(--green)" }} />
                                <div className="flex-1">
                                  <span className="text-[12px] font-semibold" style={{ color: "var(--gray-900)" }}>
                                    {Number(ex.hours)}h × {formatCurrency(Number(ex.rate_per_hour))}/hr
                                  </span>
                                  <span className="text-[12px] font-bold font-mono ml-2" style={{ color: "var(--green)" }}>
                                    {formatCurrency(Number(ex.amount))}
                                  </span>
                                  <span className="text-[11px] ml-2" style={{ color: "var(--gray-800)" }}>
                                    {formatDate(ex.created_at)}
                                  </span>
                                </div>
                                {userProfile?.isAdmin && (
                                  <button
                                    onClick={() => handleDeleteExtraHoursEntry(ex, w.name)}
                                    className="w-6 h-6 rounded-[5px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white"
                                    style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </div>
                            ))}
                            <div className="flex justify-end pt-1">
                              <span className="text-[11.5px] font-bold" style={{ color: "var(--green)" }}>
                                Total: {extraHoursTotal}h — {formatCurrency(extraAmountTotal)}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="text-[10.5px] font-bold tracking-[1.5px] uppercase mb-2" style={{ color: "var(--gray-800)" }}>
                      Advances — {monthLabel(selectedMonth)}
                    </div>

                    {w.advances.length === 0 ? (
                      <div className="text-[12px] py-2" style={{ color: "var(--gray-800)" }}>No advances taken this month.</div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {w.advances.map((adv) => (
                          <div key={adv.id} className="flex items-center gap-3 px-3 py-2 rounded-[8px]"
                            style={{ background: "var(--red-light)" }}>
                            <Clock size={13} style={{ color: "var(--red)" }} />
                            <div className="flex-1">
                              <span className="text-[12px] font-semibold" style={{ color: "var(--gray-900)" }}>
                                {formatCurrency(Number(adv.amount))}
                              </span>
                              <span className="text-[11px] ml-2" style={{ color: "var(--gray-800)" }}>{formatDate(adv.date)}</span>
                              {adv.notes && (
                                <span className="text-[11px] ml-2" style={{ color: "var(--gray-800)" }}>— {adv.notes}</span>
                              )}
                            </div>
                            {userProfile?.isAdmin && (
                              <button onClick={() => handleDeleteAdvance(adv, w.name)}
                                className="w-6 h-6 rounded-[5px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white"
                                style={{ borderColor: "var(--gray-200)", color: "var(--red)" }}>
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        ))}

                        <div className="flex justify-end pt-1">
                          <span className="text-[11.5px] font-bold" style={{ color: "var(--red)" }}>
                            Total advances: {formatCurrency(advTotal)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Payment info if paid */}
                    {w.payment && (
                      <div className="mt-3 pt-3 border-t border-[var(--gray-100)]">
                        <div className="text-[10.5px] font-bold tracking-[1.5px] uppercase mb-2" style={{ color: "var(--gray-800)" }}>
                          Payment Record
                        </div>
                        <div className="flex flex-col gap-1.5 text-[12px]">
                          <div className="flex items-center gap-4 flex-wrap">
                            <span style={{ color: "var(--gray-700)" }}>Wage: <b>{formatCurrency(Number(w.payment.total_wage))}</b></span>
                            {Number(w.payment.overtime_amount) > 0 && (
                              <span style={{ color: "var(--green)" }}>
                                + Extra hours
                                {Number(w.payment.overtime_hours) > 0 ? ` (${w.payment.overtime_hours}h)` : ""}:{" "}
                                <b>{formatCurrency(Number(w.payment.overtime_amount))}</b>
                              </span>
                            )}
                            {Number(w.payment.absence_deduction) > 0 && (
                              <span style={{ color: "var(--red)" }}>
                                − Absence
                                {Number(w.payment.absent_days) > 0 ? ` (${w.payment.absent_days}d)` : ""}:{" "}
                                <b>{formatCurrency(Number(w.payment.absence_deduction))}</b>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            <span style={{ color: "var(--red)" }}>Advance deducted: <b>{formatCurrency(Number(w.payment.advance_total))}</b></span>
                            <span style={{ color: "var(--green)" }}>Net paid: <b>{formatCurrency(Number(w.payment.net_paid))}</b></span>
                            <span style={{ color: "var(--gray-800)" }}>on {formatDate(w.payment.paid_date)}</span>
                            {w.payment.notes && <span style={{ color: "var(--gray-800)" }}>— {w.payment.notes}</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Add/Edit Worker Modal ────────────────────────────────────────────── */}
      {showWorkerModal && (
        <Modal title={editingWorker ? "Edit Worker" : "Add Worker"} onClose={() => setShowWorkerModal(false)}>
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Full Name</label>
              <input value={wName} onChange={(e) => setWName(e.target.value)} placeholder="e.g. Ahmed Khan"
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Role / Position</label>
              <input value={wRole} onChange={(e) => setWRole(e.target.value)} placeholder="e.g. Printer Operator"
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Phone</label>
              <input value={wPhone} onChange={(e) => { if (e.target.value.length <= 11) setWPhone(e.target.value); }} placeholder="03XX XXXXXXX" maxLength={11}
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Monthly Wage (Rs)</label>
              <input value={wWage} onChange={(e) => setWWage(e.target.value)} type="number" placeholder="30000"
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                Default extra-hours rate (Rs/hr)
              </label>
              <input
                value={wOvertimeRate}
                onChange={(e) => setWOvertimeRate(e.target.value)}
                type="number"
                placeholder="Pre-fills Extra hours modal; 0 = type each time"
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Status</label>
              <div className="flex border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                {(["Active", "Inactive"] as const).map((s) => (
                  <button key={s} onClick={() => setWStatus(s)}
                    className="flex-1 py-2 text-[12.5px] font-semibold border-none cursor-pointer transition-all"
                    style={{
                      background: wStatus === s ? (s === "Active" ? "var(--blue)" : "var(--gray-400)") : "var(--gray-50)",
                      color: wStatus === s ? "#fff" : "var(--gray-500)",
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ModalFooter onCancel={() => setShowWorkerModal(false)} onSave={() => run(handleSaveWorker)} saveDisabled={saving}
            saveLabel={editingWorker ? "Update Worker" : "Add Worker"} />
        </Modal>
      )}

      {/* ── Add Advance Modal ────────────────────────────────────────────────── */}
      {showAdvanceModal && advanceWorker && (() => {
        const workerData = workers.find((w) => w.id === advanceWorker.id);
        const existingAdvTotal = workerData?.advances.reduce((s, a) => s + Number(a.amount), 0) ?? 0;
        const maxAllowed = Math.max(0, Number(advanceWorker.monthly_wage) - existingAdvTotal);

        return (
          <Modal
            title={`Add Advance — ${advanceWorker.name}`}
            subtitle={`Month: ${monthLabel(selectedMonth)}`}
            onClose={() => setShowAdvanceModal(false)}
          >
            {/* Salary limit info */}
            <div className="rounded-[10px] border border-[var(--gray-100)] overflow-hidden mb-3.5">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--gray-100)]">
                <span className="text-[12px]" style={{ color: "var(--gray-900)" }}>Monthly Salary</span>
                <span className="text-[12.5px] font-bold font-mono">{formatCurrency(Number(advanceWorker.monthly_wage))}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--gray-100)]">
                <span className="text-[12px]" style={{ color: "var(--gray-900)" }}>Already Advanced</span>
                <span className="text-[12.5px] font-bold font-mono" style={{ color: existingAdvTotal > 0 ? "var(--red)" : "var(--gray-400)" }}>
                  {existingAdvTotal > 0 ? `− ${formatCurrency(existingAdvTotal)}` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2" style={{ background: maxAllowed > 0 ? "var(--green-light)" : "var(--red-light)" }}>
                <span className="text-[12px] font-bold" style={{ color: maxAllowed > 0 ? "var(--green)" : "var(--red)" }}>Max Advance Allowed</span>
                <span className="text-[14px] font-extrabold font-mono" style={{ color: maxAllowed > 0 ? "var(--green)" : "var(--red)" }}>
                  {formatCurrency(maxAllowed)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Date</label>
                <input value={aDate} onChange={(e) => setADate(e.target.value)} type="date"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Amount (Rs)</label>
                <input value={aAmount} onChange={(e) => setAAmount(e.target.value)} type="number" placeholder="0" max={maxAllowed}
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
              </div>
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Notes (optional)</label>
                <input value={aNotes} onChange={(e) => setANotes(e.target.value)} placeholder="Reason for advance..."
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
              </div>
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Paid via</label>
                <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                  {paymentMethods.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAMethod(m.name)}
                      className="flex-1 min-w-[80px] py-2 text-[11px] font-semibold border-none cursor-pointer transition-all"
                      style={{
                        background: aMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                        color: aMethod === m.name ? "#fff" : "var(--gray-500)",
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-[10px] p-3" style={{ background: "var(--red-light)" }}>
              <div className="text-[11px] font-bold mb-1" style={{ color: "var(--red)" }}>Cashbook Impact</div>
              <div className="text-[12px]" style={{ color: "var(--gray-700)" }}>
                An <b>outgoing (Debit)</b> cashbook entry will be created for{" "}
                <b>{aAmount ? formatCurrency(parseFloat(aAmount) || 0) : "Rs 0"}</b> via <b>{aMethod}</b>.
              </div>
            </div>

            <ModalFooter onCancel={() => setShowAdvanceModal(false)} onSave={() => run(handleSaveAdvance)} saveDisabled={saving} saveLabel="Record Advance" />
          </Modal>
        );
      })()}

      {/* ── Extra hours Modal ───────────────────────────────────────────────── */}
      {showExtraHoursModal && extraHoursWorker && (
        <Modal
          title={`Extra hours — ${extraHoursWorker.name}`}
          subtitle={`Month: ${monthLabel(selectedMonth)} · Each save adds another line; totals roll up until you pay wages.`}
          onClose={() => setShowExtraHoursModal(false)}
        >
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                Hours
              </label>
              <input
                value={ehHours}
                onChange={(e) => setEhHours(e.target.value)}
                type="number"
                min={0}
                step={0.5}
                placeholder="e.g. 4"
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                Rate per hour (Rs)
              </label>
              <input
                value={ehRate}
                onChange={(e) => setEhRate(e.target.value)}
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 500"
                className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                style={inputStyle}
              />
            </div>
          </div>
          {ehHours && ehRate && Number.parseFloat(ehRate) > 0 && Number.parseFloat(ehHours) > 0 && (
            <div className="mt-3 rounded-[10px] p-3" style={{ background: "var(--green-light)" }}>
              <div className="text-[11px] font-bold mb-1" style={{ color: "var(--green)" }}>This entry</div>
              <div className="text-[13px] font-extrabold font-mono" style={{ color: "var(--gray-900)" }}>
                {formatCurrency(
                  Math.round((Number.parseFloat(ehHours) || 0) * (Number.parseFloat(String(ehRate).replace(/,/g, "")) || 0) * 100) / 100
                )}
              </div>
            </div>
          )}
          <ModalFooter
            onCancel={() => setShowExtraHoursModal(false)}
            onSave={() => run(handleSaveExtraHours)}
            saveDisabled={saving}
            saveLabel="Add entry"
            saveStyle={{ background: "var(--blue-deeper)" }}
          />
        </Modal>
      )}

      {/* ── Pay Wages Modal ──────────────────────────────────────────────────── */}
      {showPayModal && payWorker && (() => {
        const otH = payModalExtraHours.reduce((s, e) => s + Number(e.hours), 0);
        const otA = Math.round(payModalExtraHours.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
        const p = computeWageSettlement(payWorker, payModalAdvances, otH, otA, payAbsentDays);

        return (
          <Modal
            title={`Pay Wages — ${payWorker.name}`}
            subtitle="Choose the payroll month and confirm amounts below"
            onClose={() => setShowPayModal(false)}
          >
            <div className="mb-3.5">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase block mb-1.5" style={{ color: "var(--blue-deeper)" }}>
                Pay wages for month
              </label>
              <select
                value={payForMonth}
                disabled={payContextLoading}
                onChange={(e) => {
                  const m = e.target.value;
                  setPayForMonth(m);
                  setPayAbsentDays("");
                  void loadPayrollMonthContext(payWorker.id, m);
                }}
                className="w-full border-[1.5px] rounded-[9px] px-3 py-2.5 text-[13px] font-semibold outline-none cursor-pointer"
                style={inputStyle}
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
              <p className="text-[11px] mt-1.5" style={{ color: "var(--gray-800)" }}>
                The payment will be stored under this month. Advances loaded here are only those recorded for the same month.
              </p>
            </div>

            {payContextLoading && (
              <div className="flex items-center gap-2 text-[12px] mb-3" style={{ color: "var(--gray-800)" }}>
                <Loader2 size={14} className="animate-spin" /> Loading advances for this month…
              </div>
            )}

            {payModalPayment && !payContextLoading && (
              <div className="mb-3.5 rounded-[10px] border px-3 py-2.5 text-[12px] font-semibold" style={{ background: "var(--orange-light)", borderColor: "#FDBA74", color: "#9A3412" }}>
                Already paid for {monthLabel(payForMonth)} — net {formatCurrency(Number(payModalPayment.net_paid))} on {formatDate(payModalPayment.paid_date)}. Undo from the list for that month or pick another month.
              </div>
            )}

            <div className="rounded-[12px] border border-[var(--gray-100)] overflow-hidden mb-3.5">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--gray-100)]">
                <span className="text-[12.5px]" style={{ color: "var(--gray-900)" }}>Monthly wage</span>
                <span className="text-[13px] font-bold font-mono">{formatCurrency(p.totalWage)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--gray-100)]">
                <span className="text-[12.5px]" style={{ color: "var(--gray-900)" }}>
                  + Extra hours
                  {p.otHours > 0
                    ? ` (${p.otHours}h, ${payModalExtraHours.length} ${payModalExtraHours.length === 1 ? "entry" : "entries"})`
                    : ""}
                </span>
                <span className="text-[13px] font-bold font-mono" style={{ color: "var(--green)" }}>
                  + {formatCurrency(p.overtimeAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--gray-100)]">
                <span className="text-[12.5px]" style={{ color: "var(--gray-900)" }}>
                  − Absence
                  {p.absentDays > 0
                    ? ` (${p.absentDays} day${p.absentDays !== 1 ? "s" : ""} × ${formatCurrency(p.perDayRate)}/day, wage÷${p.absenceDaysDivisor})`
                    : ""}
                </span>
                <span className="text-[13px] font-bold font-mono" style={{ color: "var(--red)" }}>
                  − {formatCurrency(p.absenceDeduction)}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--gray-100)]" style={{ background: "var(--gray-50)" }}>
                <span className="text-[12px] font-bold" style={{ color: "var(--gray-800)" }}>Adjusted gross</span>
                <span className="text-[13px] font-bold font-mono">{formatCurrency(p.adjustedGross)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--gray-100)]">
                <span className="text-[12.5px]" style={{ color: "var(--gray-900)" }}>
                  Advances {payModalAdvances.length > 0 ? `(${payModalAdvances.length})` : ""}
                </span>
                <span className="text-[13px] font-bold font-mono" style={{ color: "var(--red)" }}>
                  − {formatCurrency(p.advanceTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "var(--green-light)" }}>
                <span className="text-[12.5px] font-bold" style={{ color: "var(--green)" }}>Net to pay</span>
                <span className="text-[15px] font-extrabold font-mono" style={{ color: "var(--green)" }}>
                  {formatCurrency(p.netPaid)}
                </span>
              </div>
            </div>

            <p className="text-[11px] mb-3.5 rounded-[10px] px-3 py-2.5" style={{ background: "var(--blue-pale)", color: "var(--gray-800)" }}>
              Extra hours are added from the list with the <b>Extra hours</b> button (hours and rate each time). Totals here include every entry for{" "}
              <b>{monthLabel(payForMonth)}</b> until you pay wages.
            </p>

            <div className="text-[10px] font-bold tracking-wide uppercase mb-2" style={{ color: "var(--gray-800)" }}>
              Absence
            </div>
            <div className="mb-3.5">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Absent days</label>
              <input
                value={payAbsentDays}
                onChange={(e) => setPayAbsentDays(e.target.value)}
                type="number"
                min={0}
                step={0.5}
                placeholder="0"
                className="mt-1 w-full border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono"
                style={inputStyle}
              />
            </div>
            <p className="text-[11px] mb-3.5" style={{ color: "var(--gray-800)" }}>
              One day&apos;s wage = monthly salary ÷ {ABSENCE_DAYS_DIVISOR} ({formatCurrency(p.perDayRate)} per day). Total absence deduction = absent days × that amount (shown above).
            </p>

            <div className="flex flex-col gap-1 mb-3.5">
              <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Paid via</label>
              <div className="flex flex-wrap border-[1.5px] rounded-[9px] overflow-hidden" style={{ borderColor: "var(--gray-200)" }}>
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={p.netPaid <= 0}
                    onClick={() => setPayWageMethod(m.name)}
                    className="flex-1 min-w-[80px] py-2 text-[11px] font-semibold border-none cursor-pointer transition-all disabled:opacity-50"
                    style={{
                      background: payWageMethod === m.name ? "var(--blue-deeper)" : "var(--gray-50)",
                      color: payWageMethod === m.name ? "#fff" : "var(--gray-500)",
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              {p.netPaid <= 0 && (
                <p className="text-[10px] m-0" style={{ color: "var(--gray-600)" }}>No cash movement — net to pay is zero (fully covered by advances / deductions).</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Payment Date</label>
                <input value={payDate} onChange={(e) => setPayDate(e.target.value)} type="date"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Notes (optional)</label>
                <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="e.g. Cash payment"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} />
              </div>
            </div>

            <div className="mt-3 rounded-[10px] p-3" style={{ background: "var(--green-light)" }}>
              <div className="text-[11px] font-bold mb-1" style={{ color: "var(--green)" }}>Cashbook Impact</div>
              <div className="text-[12px]" style={{ color: "var(--gray-700)" }}>
                {p.netPaid > 0 ? (
                  <>
                    An <b>outgoing</b> cashbook entry of <b>{formatCurrency(p.netPaid)}</b> via <b>{payWageMethod}</b> for this payroll month.
                  </>
                ) : (
                  <>No cashbook line — net pay is zero.</>
                )}
              </div>
            </div>

            <ModalFooter
              onCancel={() => setShowPayModal(false)}
              onSave={() => run(handlePayWages)}
              saveLabel={payModalPayment ? "Already paid" : `Pay ${formatCurrency(p.netPaid)}`}
              saveStyle={{ background: "var(--green)" }}
              saveDisabled={!!payModalPayment || payContextLoading || saving}
            />
          </Modal>
        );
      })()}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, iconBg, iconColor, label, value }: {
  icon: React.ReactNode; iconBg: string; iconColor: string; label: string; value: string;
}) {
  return (
    <div className="bg-white rounded-[14px] border border-[var(--gray-100)] p-4 transition-all hover:shadow-[var(--shadow)] hover:border-[var(--blue-light)] hover:-translate-y-0.5 cursor-default"
      style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start justify-between mb-3.5">
        <div className="w-10 h-10 rounded-[11px] flex items-center justify-center"
          style={{ background: iconBg, color: iconColor }}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-extrabold font-mono leading-none" style={{ color: "var(--gray-900)" }}>{value}</div>
      <div className="text-[11.5px] mt-1" style={{ color: "var(--gray-800)" }}>{label}</div>
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto"
      style={{ background: "rgba(10,30,50,.3)" }}
    >
      <div className="bg-white rounded-[20px] w-[480px] max-w-full overflow-hidden animate-slide-up"
        style={{ boxShadow: "var(--shadow-lg)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
          <div>
            <h2 className="text-[15px] font-bold">{title}</h2>
            {subtitle && <div className="text-[11.5px] mt-0.5" style={{ color: "var(--gray-800)" }}>{subtitle}</div>}
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
            style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
            <X size={12} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, onSave, saveLabel, saveStyle, saveDisabled }: {
  onCancel: () => void; onSave: () => void; saveLabel: string; saveStyle?: React.CSSProperties;
  saveDisabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-[var(--gray-100)]">
      <button onClick={onCancel}
        className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
        style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
        Cancel
      </button>
      <button onClick={onSave}
        disabled={saveDisabled}
        className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-45 disabled:cursor-not-allowed"
        style={saveStyle || { background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}>
        {saveDisabled ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
