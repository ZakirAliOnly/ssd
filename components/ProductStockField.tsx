"use client";

import { useId } from "react";
import { stockParts, unitLabel, type Packaging } from "@/lib/productUnits";

export function ProductStockField({ value, onChange, disabled = false, readOnly = false, packets = false, packaging }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; readOnly?: boolean; packets?: boolean; packaging?: Packaging;
}) {
  const id = useId();
  if (packaging?.packaging_enabled) {
    const { packs, loose, size } = stockParts(Number(value) || 0, packaging);
    const pack = unitLabel("packet", packaging.base_unit), base = packaging.base_unit || "Piece";
    const update = (kits: number, units: number) => {
      if (!Number.isInteger(kits) || kits < 0 || !Number.isFinite(units) || units < 0) return;
      onChange(String(Math.round((kits * size + units) * 100) / 100));
    };
    return <fieldset disabled={disabled} className="col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3 text-sm">
      <legend className="font-semibold">Stock quantity</legend>
      <label htmlFor={id}>Quantity ({pack.toLowerCase()}s)<input id={id} type="number" min="0" step="1" value={packs} readOnly={readOnly} onChange={e => update(Number(e.target.value), loose)} className="block w-full border rounded p-2 mt-1" /></label>
      <label htmlFor={`${id}-loose`}>Extra loose {base.toLowerCase()}s<input id={`${id}-loose`} type="number" min="0" step="0.01" value={loose} readOnly={readOnly} onChange={e => update(packs, Number(e.target.value))} className="block w-full border rounded p-2 mt-1" /></label>
      <p className="col-span-2 text-xs">{packs} {pack.toLowerCase()}s × {size} + {loose} loose = <strong>{Number(value) || 0} {base.toLowerCase()}s total</strong>. Purchases add stock; sales deduct the selected unit automatically.</p>
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
