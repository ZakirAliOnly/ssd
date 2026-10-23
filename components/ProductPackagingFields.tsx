"use client";

import { unitLabel, type Packaging } from "@/lib/productUnits";
export const emptyPackaging = { packaging_enabled: false, base_unit: "Vial", pieces_per_packet: 1, packets_per_box: 1, packet_sale_price: 0, box_sale_price: 0 };
export function ProductPackagingFields({ value, onChange, locked = false, disabled = false, piecePrice = "", onPiecePriceChange, packetPrice = "", onPacketPriceChange, packetPriceOverridden = false, onResetPacketPrice }: {
  value: Packaging; onChange: (value: typeof emptyPackaging) => void; locked?: boolean; disabled?: boolean; packetEntry?: boolean; piecePrice?: string; onPiecePriceChange?: (price: string) => void; packetPrice?: string | number; onPacketPriceChange?: (price: string) => void; packetPriceOverridden?: boolean; onResetPacketPrice?: () => void;
}) {
  const config = { ...emptyPackaging, ...value };
  const loose = config.base_unit || "Vial", pack = unitLabel("packet", loose);
  const field = "block w-full mt-1 rounded-lg border border-gray-300 p-2 text-sm bg-white";
  return <fieldset disabled={disabled} className="col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-3 text-sm">
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!value.packaging_enabled} disabled={locked}
      onChange={e => onChange({ ...config, packaging_enabled: e.target.checked })} /> Sell loose units and full kits / packets</label>
    {value.packaging_enabled && <>
      <div className="grid grid-cols-2 gap-3">
        <label>Loose unit<select className={field} value={config.base_unit} onChange={e => onChange({ ...config, base_unit: e.target.value })}>
          <option value="Vial">Vial</option><option value="Piece">Piece</option><option value="Kit">Kit</option>
          {!["Piece", "Kit", "Vial"].includes(config.base_unit) && <option value={config.base_unit}>{config.base_unit}</option>}
        </select></label>
        <label>{loose === "Vial" ? "Vials per kit / box" : `${loose}s per packet`}<input type="number" min={1} max={1000000} step={1} className={field} value={config.pieces_per_packet} onChange={e => onChange({ ...config, pieces_per_packet: Number(e.target.value) })} /></label>
        <label>Price per {loose.toLowerCase()} (Rs)<input type="number" min={0} step="0.01" className={field} value={piecePrice} placeholder="0" onChange={e => onPiecePriceChange?.(e.target.value)} /></label>
        <div><label>{pack} selling price (Rs)<input type="number" min={0} step="0.01" className={field} value={packetPrice} placeholder="0" onChange={e => onPacketPriceChange?.(e.target.value)} /></label>
          {packetPriceOverridden && <button type="button" className="mt-1 text-xs underline text-left" onClick={onResetPacketPrice}>Use calculated price</button>}
        </div>
      </div>
      <p className="text-xs">1 {pack.toLowerCase()} = {config.pieces_per_packet} {loose.toLowerCase()}s. {pack} price = {config.pieces_per_packet} × {Number(piecePrice) || 0} = {Math.round(config.pieces_per_packet * (Number(piecePrice) || 0) * 100) / 100}. You can override the selling price.</p>
      <details><summary className="cursor-pointer text-xs">Outer box settings (optional)</summary><div className="grid grid-cols-2 gap-3 mt-2">
        <label>{pack}s per outer box<input type="number" min={1} max={1000000} step={1} className={field} value={config.packets_per_box} onChange={e => onChange({ ...config, packets_per_box: Number(e.target.value) })} /></label>
        <label>Outer box selling price (Rs)<input type="number" min={0} step="0.01" className={field} value={config.box_sale_price || ""} placeholder="Calculated from loose price" onChange={e => onChange({ ...config, box_sale_price: Number(e.target.value) })} /></label>
      </div></details>
    </>}
  </fieldset>;
}
