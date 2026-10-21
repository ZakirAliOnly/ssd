"use client";
import { productUnits, unitLabel, baseUnitLabel, type Packaging } from "@/lib/productUnits";
export function InvoiceUnitSelect({ product, unit, factor, onChange, className, selling = false }: {
  product?: Packaging; unit?: string; factor?: number; onChange: (unit: string) => void; className?: string; selling?: boolean;
}) {
  const units = productUnits(product);
  const selected = unit ?? units[0].value;
  if (selling) {
    const options = units.some(row => row.value === selected)
      ? units
      : [{ value: selected, label: unitLabel(selected), factor: factor ?? 1 }, ...units];
    return <fieldset className="mt-2 min-w-0">
      <legend className="text-xs font-semibold" style={{ color: "var(--gray-800)" }}>Sell in</legend>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map(row => {
          const active = row.value === selected;
          return <button key={row.value} type="button" aria-pressed={active}
            title={active && factor != null && factor !== row.factor ? `${row.label} — saved size ${factor}` : row.label}
            onClick={() => { if (!active) onChange(row.value); }}
            className="min-h-9 rounded-[6px] border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--blue)] hover:brightness-95"
            style={{
              background: active ? "var(--blue-deeper)" : "white",
              color: active ? "white" : "var(--blue-deeper)",
              borderColor: active ? "var(--blue-deeper)" : "var(--gray-200)",
            }}>
            {unitLabel(row.value, product?.base_unit)}
          </button>;
        })}
      </div>
      {selected === "packet" && <p className="mt-1 text-xs" style={{ color: "var(--gray-800)" }}>
        1 kit = {factor ?? options.find(row => row.value === selected)?.factor ?? 1} {baseUnitLabel(product?.base_unit)}
      </p>}
    </fieldset>;
  }
  return <label className="block mt-1 text-xs">{selling ? "Sell in" : "Unit"}<select aria-label={selling ? "Sell in" : "Selling or purchase unit"} className={className || "block w-full rounded border border-gray-300 p-2 bg-white"} value={selected} onChange={e => onChange(e.target.value)}>
    {!units.some(row => row.value === selected) && <option value={selected}>{unitLabel(selected)} (saved: {factor ?? 1} base units)</option>}
    {units.map(row => <option key={row.value} value={row.value}>{row.label}{row.value === selected && factor != null && factor !== row.factor ? ` — saved size ${factor}` : ""}</option>)}
  </select></label>;
}
