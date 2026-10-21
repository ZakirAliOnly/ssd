"use client";

import type { Packaging } from "@/lib/productUnits";
export const emptyPackaging = { packaging_enabled: false, base_unit: "Piece", pieces_per_packet: 1, packets_per_box: 1, packet_sale_price: 0, box_sale_price: 0 };
export function ProductPackagingFields({ value, onChange, locked = false, disabled = false, packetEntry = false, piecePrice = "", onPiecePriceChange, packetPrice = "", onPacketPriceChange, packetPriceOverridden = false, onResetPacketPrice }: {
  value: Packaging; onChange: (value: typeof emptyPackaging) => void; locked?: boolean; disabled?: boolean; packetEntry?: boolean; piecePrice?: string; onPiecePriceChange?: (price: string) => void; packetPrice?: string | number; onPacketPriceChange?: (price: string) => void; packetPriceOverridden?: boolean; onResetPacketPrice?: () => void;
}) {
  const config = { ...emptyPackaging, ...value };
  const field = "block w-full mt-1 rounded-lg border border-gray-300 p-2 text-sm bg-white";
  return <fieldset disabled={disabled} className="col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-3 text-sm">
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!value.packaging_enabled} disabled={locked}
      onChange={e => onChange({ ...config, packaging_enabled: e.target.checked })} /> {packetEntry ? "Sell loose pieces and packets" : "Sell loose pieces, packets and boxes"}</label>
    {value.packaging_enabled && <>
      <div className="grid grid-cols-2 gap-3">
        <label>Unit<select className={field} value={config.base_unit} onChange={e => onChange({ ...config, base_unit: e.target.value })}>
          <option value="Piece">Per piece</option><option value="Kit">Per kit</option><option value="Vial">Per vial</option>
          {!["Piece", "Kit", "Vial"].includes(config.base_unit) && <option value={config.base_unit}>Per {config.base_unit}</option>}
        </select></label>
        <label>Pieces per packet<input type="number" min={1} max={1000000} step={1} className={field} value={config.pieces_per_packet} onChange={e => onChange({ ...config, pieces_per_packet: Number(e.target.value) })} /></label>
        {!packetEntry && <>
        <label>Packets per box<input type="number" min={1} max={1000000} step={1} className={field} value={config.packets_per_box} onChange={e => onChange({ ...config, packets_per_box: Number(e.target.value) })} /></label>
        <p className="self-center text-xs">1 box = {config.pieces_per_packet * config.packets_per_box} {config.base_unit}. Use 1 to leave a packaging level unused.</p>
        <label>Packet selling price (Rs)<input type="number" min={0} step="0.01" className={field} value={config.packet_sale_price || ""} placeholder="Base price × size" onChange={e => onChange({ ...config, packet_sale_price: Number(e.target.value) })} /></label>
        <label>Box selling price (Rs)<input type="number" min={0} step="0.01" className={field} value={config.box_sale_price || ""} placeholder="Base price × size" onChange={e => onChange({ ...config, box_sale_price: Number(e.target.value) })} /></label>
        </>}
        {packetEntry && <><label>Piece selling price (Rs)<input type="number" min={0} step="0.01" className={field} value={piecePrice} placeholder="0" onChange={e => onPiecePriceChange?.(e.target.value)} /></label>
        <div><label>Packet selling price (Rs)<input type="number" min={0} step="0.01" className={field} value={packetPrice} placeholder="0" onChange={e => onPacketPriceChange?.(e.target.value)} /></label>
          {packetPriceOverridden && <button type="button" className="mt-1 text-xs underline text-left" onClick={onResetPacketPrice}>Use calculated price</button>}
        </div></>}
      </div>
      <p className="text-xs">{packetEntry ? "Enter the piece selling price here. Packet selling price is calculated from pieces per packet; you can change it. Stock and cost are per packet." : `Stock and cost are kept in ${config.base_unit}. Prices below are per ${config.base_unit}. Saved documents keep their conversion.`}</p>
    </>}
  </fieldset>;
}
