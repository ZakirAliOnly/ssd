"use client";
import { useEffect, useState } from "react";

export function ReturnPeriodSettings() {
  const [date, setDate] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/returns/period", { cache: "no-store" }), data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSaved(data.closedThrough); setDate(data.closedThrough ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the cutoff."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/returns/period", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closedThrough: date || null, reason }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setSaved(data.closedThrough); setReason(""); setConfirmed(false); setMessage("Return accounting cutoff saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not confirm cutoff. Reload before retrying."); }
    finally { setBusy(false); }
  }
  return <details className="my-4 rounded-lg border p-3 text-sm"><summary className="font-semibold cursor-pointer">Return accounting period — admin</summary>
    <p className="my-2">{saved ? `Returns through ${saved} are closed.` : "No return dates are closed."} This cutoff blocks backdated returns and reversals of returns in closed dates; it does not close other accounting modules.</p>
    {loading ? <p>Loading cutoff…</p> : <div className="space-y-3">
      <label className="block">Closed through (leave empty to reopen all return dates)<input type="date" max={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })} value={date} disabled={busy} onChange={e => { setDate(e.target.value); setConfirmed(false); }} className="block border rounded p-2" /></label>
      <label className="block">Reason<input value={reason} maxLength={1000} disabled={busy} onChange={e => setReason(e.target.value)} className="block w-full border rounded p-2" /></label>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I confirm this return-period change. It will be audited.</label>
      <button type="button" disabled={busy || !reason.trim() || !confirmed || !!error} className="border rounded px-3 py-2 disabled:opacity-50" onClick={() => void save()}>{busy ? "Saving…" : "Save return cutoff"}</button>
    </div>}
    {error && <p role="alert">{error} <button type="button" disabled={busy} className="underline" onClick={() => void load()}>Reload cutoff</button></p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
