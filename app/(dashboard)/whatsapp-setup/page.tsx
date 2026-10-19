"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, Link2, MessageCircle, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useUser } from "@/lib/UserContext";

type Settings = { connected: boolean; displayPhone: string; enabled: boolean; invoice: boolean; received: boolean; supplier: boolean; delaySeconds: number; workerSeenAt: string | null };
type Job = { id: string; kind: string; recipient_name: string; phone: string; body: string; status: string; reason: string; attempts: number; created_at: string; available_at: string };
type Contact = { phone: string; name: string; opted_in_at: string | null; opted_out_at: string | null; consent_source: string; last_inbound_at: string | null };
type Data = { settings: Settings | null; connection: { workerRunning: boolean; state: string; error: string; qr: string; qrExpiresAt: string | null }; messages: Job[]; contacts: Contact[] };
const defaults: Settings = { connected: false, displayPhone: "", enabled: false, invoice: true, received: true, supplier: true, delaySeconds: 15, workerSeenAt: null };
const labels: Record<string, string> = { invoice: "Invoice saved / printed", payment_received: "Payment received · Parties", supplier_payment: "Payment paid · Supplier" };
const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white";
const button = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-sky-800 text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

async function api(path: string, method = "GET", body?: object) {
  const response = await fetch(`/api/whatsapp/${path}`, { method, headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Request failed. Please try again.");
  return json;
}

export default function WhatsAppSetupPage() {
  const user = useUser();
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [contact, setContact] = useState({ phone: "", name: "", source: "", optedIn: false });
  const [filter, setFilter] = useState("all");
  const refresh = useCallback(async (reset = false) => {
    const result: Data = await api("settings");
    setData(result);
    if (reset) setForm(result.settings ?? defaults);
  }, []);

  useEffect(() => {
    if (user?.role !== "super_admin") return;
    void refresh(true).catch(err => setError(err.message));
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [refresh, user?.role]);

  async function action(name: string, work: () => Promise<void>) {
    setBusy(name); setError(""); setNotice("");
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong"); }
    finally { setBusy(""); }
  }

  function connect() {
    void action("connect", async () => {
      await api("connect", "POST"); await refresh();
      setNotice("Starting WhatsApp. Scan the QR code when it appears.");
    });
  }

  if (user?.role !== "super_admin") return <p>Administrator access is required to manage WhatsApp.</p>;
  const connected = data?.settings?.connected;
  const workerRecent = data?.connection.workerRunning;
  const jobs = data?.messages.filter(job => filter === "all" || job.status === filter) ?? [];

  return <div className="max-w-6xl mx-auto space-y-6 text-gray-900">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="text-green-700" /> WhatsApp Setup</h1>
        <p className="mt-1 text-sm text-gray-600">Send invoices and payment receipts from your business number.</p></div>
      <button className="flex items-center gap-2 text-sm font-medium p-2" onClick={() => void action("refresh", () => refresh())} disabled={!!busy}><RefreshCw size={16} /> Refresh</button>
    </div>
    {error && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>}
    {!data ? <p>Loading WhatsApp settings…</p> : <>
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap"><h2 className="text-lg font-bold">1. Connect your business</h2>
          <span className={`text-xs font-semibold rounded-full px-3 py-1 ${connected ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{connected ? `Connected · ${data.settings?.displayPhone}` : "Not connected"}</span></div>
        <p className="text-sm text-gray-600">Open WhatsApp on your phone → Linked devices → Link a device, then scan the QR code below. Messages will be sent from that linked number.</p>
        <div className="flex flex-wrap gap-3">
          <button className={button} onClick={connect} disabled={!!busy || connected || !workerRecent || ["starting", "authenticated", "disconnecting"].includes(data.connection.state)}><Link2 size={16} />{["starting", "authenticated"].includes(data.connection.state) ? "Connecting…" : connected ? "WhatsApp connected" : data.connection.state === "qr" ? "Refresh QR code" : "Connect / show QR code"}</button>
          {(connected || ["starting", "qr", "authenticated", "error"].includes(data.connection.state) || data.settings?.displayPhone) && <button className="flex items-center gap-2 text-sm text-red-700 border border-red-200 rounded-lg px-3 py-2" disabled={!!busy} onClick={() => {
            if (window.confirm("Disconnect WhatsApp and cancel pending messages? A message already sending cannot be recalled.")) void action("disconnect", async () => { await api("settings", "DELETE"); await refresh(true); setNotice("Sending paused. The worker will remove the saved session. You can also unlink this device from your phone."); });
          }}><Unplug size={16} /> Disconnect</button>}
        </div>
        <p className="text-sm" role="status">Connection: <strong>{data.connection.state}</strong>{connected && ` · +${data.settings?.displayPhone}`}</p>
        {data.connection.qr && data.connection.qrExpiresAt && new Date(data.connection.qrExpiresAt).getTime() > Date.now() && <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.connection.qr} width={280} height={280} className="max-w-full h-auto" alt="WhatsApp linking QR code — scan with Linked devices on your phone" />
          <p className="text-xs text-gray-500">This code refreshes automatically. Keep it private.</p>
        </div>}
        {data.connection.state === "qr" && (!data.connection.qr || !data.connection.qrExpiresAt || new Date(data.connection.qrExpiresAt).getTime() <= Date.now()) && <p className="text-sm text-gray-600">Waiting for a fresh QR code…</p>}
        {data.connection.error && <p role="alert" className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">{data.connection.error}</p>}
        {!workerRecent && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">WhatsApp worker is offline</p>
          <p className="mt-1">Start the Baileys worker on your server to generate a QR code and process messages.</p>
          <details className="mt-2"><summary className="cursor-pointer">Server setup</summary><p className="mt-2">Run npm run whatsapp:worker from the app directory with the session encryption key configured. See docs/whatsapp-setup.md. No Meta API credentials are needed.</p></details>
        </div>}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-lg font-bold">2. Automatic messages</h2>
        <label className="flex items-center gap-3 font-semibold"><input type="checkbox" checked={form.enabled} disabled={!connected} onChange={e => setForm({ ...form, enabled: e.target.checked })} className="h-5 w-5" /> Enable automatic sending</label>
        <div className="grid gap-3 sm:grid-cols-3">
          {([['invoice', 'Invoice saved / printed', 'Parties and walk-in customers'], ['received', 'Payment received', 'Parties'], ['supplier', 'Payment paid', 'Suppliers']] as const).map(([key, title, subtitle]) => <label key={key} className="flex items-start gap-3 border border-gray-200 rounded-lg p-3">
            <input type="checkbox" className="h-5 w-5 mt-0.5" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} />
            <span className="text-sm font-medium">{title}<span className="block text-xs font-normal text-gray-500 mt-1">{subtitle}</span></span>
          </label>)}
        </div>
        <div className="flex flex-wrap items-end gap-4"><label className="text-sm font-medium">Delay between messages (seconds)<input type="number" min={10} max={3600} value={form.delaySeconds} onChange={e => setForm({ ...form, delaySeconds: Number(e.target.value) })} className={`${field} mt-1 max-w-52 block`} /></label>
          <button className={button} disabled={!!busy} onClick={() => void action("save", async () => { await api("settings", "PATCH", form); await refresh(true); setNotice("Automatic message settings saved."); })}>Save settings</button></div>
        <p className="text-xs text-gray-500">One notification per saved transaction. Printing or editing an existing invoice does not send it again. Missing numbers and missing consent are held for review. The original WhatsApp buttons remain available for manual sending.</p>
        <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900 flex gap-2"><ShieldCheck size={20} className="shrink-0" /><p>Messages use your existing invoice and receipt text, sent through the linked Baileys session. Only message recipients who have agreed to receive these updates. This unofficial connection can break when WhatsApp changes; delays do not guarantee compliance or prevent account restrictions.</p></div>
        <p className="flex items-center gap-2 text-sm"><Clock3 size={16} /> Queue worker: <strong>{workerRecent ? "Running" : "Not running / not yet configured"}</strong></p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-lg font-bold">3. Recipient consent</h2>
        <p className="text-sm text-gray-600">Record permission to receive invoices and receipts on WhatsApp. A saved phone number alone is not consent. Recipients can reply STOP to opt out or START to opt in. An ordinary inbound message does not automatically grant consent.</p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void action("contact", async () => {
          await api("contacts", "POST", contact); setContact({ phone: "", name: "", source: "", optedIn: false }); await refresh(); setNotice("Consent record saved. Review held messages before retrying them.");
        }); }}>
          <label className="text-sm">Name<input className={`${field} mt-1`} value={contact.name} maxLength={150} onChange={e => setContact({ ...contact, name: e.target.value })} /></label>
          <label className="text-sm">WhatsApp number<input className={`${field} mt-1`} placeholder="03xxxxxxxxx or +country code…" required value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
          <label className="text-sm sm:col-span-2">When and how permission was given / withdrawn<input className={`${field} mt-1`} required minLength={3} maxLength={500} placeholder="e.g. Customer opted in on the order form today" value={contact.source} onChange={e => setContact({ ...contact, source: e.target.value })} /></label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={contact.optedIn} onChange={e => setContact({ ...contact, optedIn: e.target.checked })} /> This recipient agreed to receive these messages</label>
          <div className="sm:text-right"><button className={button} disabled={!!busy}><CheckCircle2 size={16} />{contact.optedIn ? "Record consent" : "Record opt-out"}</button></div>
        </form>
        <details><summary className="text-sm font-medium cursor-pointer">Recent consent records ({data.contacts.length}, latest 100)</summary>
          <div className="mt-3 space-y-2">{data.contacts.map(row => <div key={row.phone} className="text-sm flex flex-wrap justify-between gap-2 border-t pt-2"><span>{row.name || row.phone} · +{row.phone}<small className="block text-gray-500">{row.consent_source}</small></span><span>{row.opted_in_at && !row.opted_out_at ? "Consented" : "No consent / opted out"}</span></div>)}</div>
        </details>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-bold">Message queue</h2><label className="text-sm">Status <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-gray-300 rounded-lg p-2 ml-2">{["all", "queued", "blocked", "processing", "accepted", "sent", "delivered", "read", "failed", "unknown", "cancelled"].map(status => <option key={status}>{status}</option>)}</select></label></div>
        <p className="text-xs text-gray-500">Latest 100 messages. Accepted means the Baileys submitted the message; sent/delivered/read reflect WhatsApp acknowledgements when available. Unknown outcomes are never automatically retried.</p>
        {jobs.length === 0 && <p className="text-sm text-gray-500 py-5 text-center">No messages to display. New eligible transactions appear here when automation is enabled.</p>}
        <div className="space-y-3">{jobs.map(job => <article key={job.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold break-words">{job.recipient_name} {job.phone && <span className="font-normal text-gray-500">· +{job.phone}</span>}</p><p className="text-xs text-gray-500">{labels[job.kind]} · {new Date(job.created_at).toLocaleString()} · {job.attempts} attempts</p></div><span className="self-start text-xs font-semibold rounded-full bg-gray-100 px-3 py-1">{job.status}</span></div>
          {job.reason && <p className="text-xs text-amber-800">{job.reason}</p>}
          <details><summary className="text-xs cursor-pointer text-sky-800">Message preview</summary><pre className="text-xs whitespace-pre-wrap break-words mt-2 bg-gray-50 rounded p-3">{job.body}</pre></details>
          <div className="flex gap-3">{job.status === "blocked" && <button className="text-xs text-sky-800 font-semibold py-2" disabled={!!busy} onClick={() => void action(job.id, async () => { await api("queue", "POST", { id: job.id, action: "retry" }); await refresh(); })}>Retry after fixing issue</button>}
            {["queued", "blocked", "failed"].includes(job.status) && <button className="text-xs text-red-700 py-2" disabled={!!busy} onClick={() => void action(job.id, async () => { await api("queue", "POST", { id: job.id, action: "cancel" }); await refresh(); })}>Cancel</button>}</div>
        </article>)}</div>
      </section>
    </>}
  </div>;
}
