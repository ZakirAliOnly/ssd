"use client";

import { useId } from "react";

export function ProductStockField({ value, onChange, disabled = false, readOnly = false, packets = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; readOnly?: boolean; packets?: boolean;
}) {
  const id = useId();
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
