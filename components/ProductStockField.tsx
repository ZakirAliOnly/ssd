"use client";

import { useId, useState } from "react";
import { stockParts, unitLabel, type Packaging } from "@/lib/productUnits";

export function ProductStockField({ value, onChange, disabled = false, readOnly = false, packets = false, packaging }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; readOnly?: boolean; packets?: boolean; packaging?: Packaging;
}) {
  const id = useId();
  const [draft, setDraft] = useState<{ baseValue: string; size: number; input: string } | null>(null);
  if (packaging?.packaging_enabled) {
    const { size } = stockParts(Number(value) || 0, packaging);
    const pack = unitLabel("packet", packaging.base_unit), base = packaging.base_unit || "Piece";
    const kits = draft?.baseValue === value && draft.size === size ? draft.input : String(Number(((Number(value) || 0) / size).toFixed(10)));
    const update = (input: string) => {
      const count = Number(input);
      if (!Number.isFinite(count) || count < 0) return;
      const baseValue = String(Math.round(count * size * 100) / 100);
      setDraft({ baseValue, size, input });
      onChange(baseValue);
    };
    return <fieldset disabled={disabled} className="col-span-2 rounded-lg border border-gray-200 p-3 text-sm">
      <legend className="font-semibold">Stock quantity</legend>
      <label htmlFor={id}>Quantity ({pack.toLowerCase()}s)<input id={id} type="number" min="0" max={2147483647 / size} step="any" value={kits} readOnly={readOnly} onChange={e => update(e.target.value)} aria-describedby={`${id}-help`} className="block w-full border rounded p-2 mt-1" /></label>
      <p id={`${id}-help`} className="mt-2 text-xs">Enter {pack.toLowerCase()} quantity only. Each {pack.toLowerCase()} contains {size} {base.toLowerCase()}s. Calculated stock: <strong>{Number(value) || 0} {base.toLowerCase()}s total</strong>. After loose sales, the {pack.toLowerCase()} balance can be fractional.</p>
    </fieldset>;
  }
  return (
    <div className="flex flex-col gap-1 col-span-2">
      <label htmlFor={id} className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>{packets ? "Stock quantity (packets)" : "Stock quantity"}</label>
      <input id={id} type="number" min="0" max="2147483647" step="0.01" required value={value} disabled={disabled} readOnly={readOnly}
        onChange={event => onChange(event.target.value)} aria-describedby={`${id}-help`}
        className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--blue)]"
        style={{ borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" }} />
      <p id={`${id}-help`} className="text-xs" style={{ color: "var(--gray-800)" }}>{readOnly ? "Purchase invoices add stock; sales reduce it. Stock cannot be edited here." : packets ? "Available stock in packets. Packet sales deduct packets; loose sales deduct equivalent pieces." : "Available stock in units. Purchases add stock; sales reduce it automatically."}</p>
    </div>
  );
}
