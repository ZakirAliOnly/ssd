"use client";
import { productUnits, unitLabel, type Packaging } from "@/lib/productUnits";
export function InvoiceUnitSelect({ product, unit, factor, onChange, className, selling = false }: {
  product?: Packaging; unit?: string; factor?: number; onChange: (unit: string) => void; className?: string; selling?: boolean;
}) {
  const units = productUnits(product);
  const selected = unit ?? units[0].value;
  return <label className="block mt-1 text-xs">{selling ? "Sell in" : "Unit"}<select aria-label={selling ? "Sell in" : "Selling or purchase unit"} className={className || "block w-full rounded border border-gray-300 p-2 bg-white"} value={selected} onChange={e => onChange(e.target.value)}>
    {!units.some(row => row.value === selected) && <option value={selected}>{unitLabel(selected)} (saved: {factor ?? 1} base units)</option>}
    {units.map(row => <option key={row.value} value={row.value}>{row.label}{row.value === selected && factor != null && factor !== row.factor ? ` — saved size ${factor}` : ""}</option>)}
  </select></label>;
}
