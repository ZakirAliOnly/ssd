"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/helpers";
import type { ReturnHistoryEntry } from "@/lib/returnHistory";

const button = "rounded-lg border border-[var(--gray-200)] px-3 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
export function ReverseReturn({ entry, onDone }: { entry: ReturnHistoryEntry; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const late = entry.needs_late_confirmation || Date.now() - new Date(entry.created_at).getTime() > 86400000;
  if (entry.reversed_at) return null;
  async function submit() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/returns/reverse", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, type: entry.type, reason, refundReviewed: reviewed, lateConfirmation: confirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not reverse this return.");
      setOpen(false); onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not confirm reversal. Reload history or retry the same return safely."); }
    finally { setSaving(false); }
  }
  return <div className="my-4">
    {!open ? <button type="button" className={`${button} text-[var(--red)]`} onClick={() => setOpen(true)}>Reverse Return</button> : <section aria-label="Confirm return reversal" className="rounded-lg border border-[var(--red)] p-4 space-y-3 text-sm">
      <h4 className="font-bold">Reverse return for {entry.invoice_number}?</h4>
      <p>This keeps the original record and cancels its {formatCurrency(Number(entry.amount))} credit. The invoice remains unchanged and these quantities become returnable again.</p>
      <ul className="list-disc pl-5">{entry.items.map(item => <li key={item.id}>{item.product_name}: {entry.type === "sales" ? "remove" : "restore"} {Number(item.stock_restored_qty)} base units.</li>)}</ul>
      <p>{entry.type === "sales" ? "Reversal is blocked if the original returned batches no longer have enough stock." : "Stock will be restored to the original purchase batches."} Closed return accounting periods cannot be reversed.</p>
      <label className="block font-semibold">Reason (required)<textarea value={reason} maxLength={1000} disabled={saving} onChange={e => setReason(e.target.value)} className="block w-full mt-1 border rounded-lg p-2" rows={2} /></label>
      <label className="flex gap-2 items-start"><input type="checkbox" checked={reviewed} disabled={saving} onChange={e => setReviewed(e.target.checked)} /><span>I checked separately recorded cash refunds and resolved any refund that must be corrected. This reversal changes no cash payment.</span></label>
      {late && <div className="border rounded-lg p-3 space-y-2"><p className="font-semibold">This return was created over 24 hours ago. Review the stock and credit changes above before continuing.</p>
        <label className="block">Additional confirmation: type REVERSE<input value={confirmation} disabled={saving} onChange={e => setConfirmation(e.target.value)} autoComplete="off" className="block border rounded-lg p-2 mt-1" /></label></div>}
      {error && <p role="alert" className="text-[var(--red)]">{error}</p>}
      <div className="flex gap-2"><button type="button" disabled={saving} className={button} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
        <button type="button" disabled={saving || !reason.trim() || !reviewed || !!late && confirmation !== "REVERSE"} className={`${button} bg-[var(--red)] text-white`} onClick={() => void submit()}>{saving ? "Reversing…" : "Confirm reversal"}</button></div>
    </section>}
  </div>;
}
