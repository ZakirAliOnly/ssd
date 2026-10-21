"use client";

import { ProductPackagingFields, emptyPackaging } from "@/components/ProductPackagingFields";
import { type Packaging } from "@/lib/productUnits";
import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { ProductCategorySelect } from "@/components/ProductCategorySelect";
import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { useSaving } from "@/lib/useSaving";
import { ProductStockField } from "@/components/ProductStockField";
import { ProductExpiryField } from "@/components/ProductExpiryField";

export type CreatedProduct = Packaging & {
  id: string;
  name: string;
  sale_price: number;
  description?: string | null;
  pricing_type?: string | null;
  category_id?: string | null;
  quantity?: number;
  expiry_date?: string | null;
};

// Generates the next sequential numeric product code based on existing products.
export function nextProductCode(existing: { code: string | null }[]): string {
  let max = 0;
  for (const p of existing) {
    const m = String(p.code ?? "").match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1);
}

export function ProductCreateModal({
  initialName,
  existingProducts,
  serverCode = false,
  onClose,
  onCreated,
}: {
  initialName: string;
  existingProducts: { id: string; code: string | null; name: string; sale_price: number; description?: string | null; pricing_type?: string | null }[];
  serverCode?: boolean;
  onClose: () => void;
  onCreated: (p: CreatedProduct) => void;
}) {
  const [packaging, setPackaging] = useState({ ...emptyPackaging });
  const [fName, setFName] = useState(initialName);
  const [fCode, setFCode] = useState(() => serverCode ? "" : nextProductCode(existingProducts));
  const [codeLoading, setCodeLoading] = useState(serverCode);
  const [codeError, setCodeError] = useState("");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fCost, setFCost] = useState("");
  const [fSale, setFSale] = useState("");
  const [packetPrice, setPacketPrice] = useState<string | null>(null);
  const [fQuantity, setFQuantity] = useState("0");
  const [fNonExpiry, setFNonExpiry] = useState(true);
  const [fExpiryDate, setFExpiryDate] = useState("");
  const { saving, run } = useSaving();

  useEffect(() => {
    if (!serverCode) return;
    const controller = new AbortController();
    void fetch("/api/products?mode=next-code", { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (!controller.signal.aborted) setFCode(current => current || body.code);
    }).catch(() => {
      if (!controller.signal.aborted) setCodeError("Could not generate a code. Close and reopen this form to retry.");
    }).finally(() => { if (!controller.signal.aborted) setCodeLoading(false); });
    return () => controller.abort();
  }, [serverCode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  function handleNameChange(name: string) {
    setFName(name);
  }

  const packetEntry = packaging.packaging_enabled;
  const entryFactor = packetEntry ? packaging.pieces_per_packet : 1;
  const calculatedPacketPrice = Math.round((Number(fSale) || 0) * entryFactor * 100) / 100;
  const effectivePacketPrice = packetPrice === null ? calculatedPacketPrice : Number(packetPrice);

  async function handleSave() {
    if (codeLoading || codeError) { showToast(codeError || "Wait for the product code", "err"); return; }
    if (!fNonExpiry && !fExpiryDate) { showToast("Enter the expiry date", "err"); return; }
    const quantity = Math.round(Number(fQuantity) * entryFactor * 100) / 100;
    if (!fQuantity.trim() || !Number.isFinite(quantity) || Math.abs(Number(fQuantity) - Math.round(Number(fQuantity) * 100) / 100) > 0.00000001 || quantity < 0 || quantity > 2147483647) {
      showToast("Enter stock quantity of zero or more with up to two decimal places", "err"); return;
    }
    if (!fCategoryId) { showToast("Select a category", "err"); return; }
    const trimmed = fName.trim();
    if (!trimmed) { showToast("Enter product name", "err"); return; }
    if (packetEntry && (!Number.isInteger(entryFactor) || entryFactor < 1 || entryFactor > 1000000)) { showToast("Enter whole pieces per packet between 1 and 1,000,000", "err"); return; }
    if (packetEntry && packetPrice !== null && (!packetPrice.trim() || !Number.isFinite(Number(packetPrice)) || Number(packetPrice) < 0)) { showToast("Enter a packet selling price of zero or more", "err"); return; }
    let code = fCode.trim() || (serverCode ? "" : nextProductCode(existingProducts));
    if (!code) {
      try {
        const response = await fetch("/api/products?mode=next-code");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        code = body.code;
      } catch { showToast("Could not generate a product code. Try again.", "err"); return; }
    }
    const payload = {
      code,
      name: trimmed,
      description: fDescription.trim(),
      cost_price: (parseFloat(fCost) || 0) / entryFactor,
      sale_price: parseFloat(fSale) || 0,
      ...packaging,
      ...(packetEntry ? { packets_per_box: 1, box_sale_price: 0, packet_sale_price: effectivePacketPrice } : {}),
      pricing_type: "standalone",
      category_id: fCategoryId,
      quantity,
      expiry_date: fNonExpiry ? null : fExpiryDate,
    };
    try {
      const { data, error } = await db.from("products").insert(payload).select("id").single();
      if (error || !data?.id) { showToast(error?.message || "Could not save product", "err"); return; }
      showToast("Product saved", "ok");
      onCreated({ ...packaging, packet_sale_price: payload.packet_sale_price, packets_per_box: payload.packets_per_box, box_sale_price: payload.box_sale_price, id: String(data.id), name: payload.name, sale_price: payload.sale_price, description: payload.description, pricing_type: payload.pricing_type, category_id: payload.category_id, quantity: payload.quantity, expiry_date: payload.expiry_date });
    } catch {
      showToast("Could not save product. Please try again.", "err");
    }
  }

  const inputStyle = { borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" };

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto"
      style={{ background: "rgba(10,30,50,.45)" }}
      onClick={() => { if (!saving) onClose(); }}
    >
      <div className="bg-white rounded-[20px] w-[480px] max-w-full overflow-hidden animate-slide-up"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
          <h2 className="text-[15px] font-bold">Add Product</h2>
          <button onClick={onClose} disabled={saving}
            className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer disabled:opacity-50"
            style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
            <X size={12} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
              Product Name <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input value={fName} onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Billboard Print, Shop Sign Acrylic"
              className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none" style={inputStyle} autoFocus />
          </div>

          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
              Description <span className="font-normal normal-case" style={{ color: "var(--gray-800)" }}>(optional)</span>
            </label>
            <textarea
              value={fDescription}
              onChange={(e) => setFDescription(e.target.value)}
              placeholder="e.g. Outdoor vinyl, UV print, lamination options…"
              rows={3}
              className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none resize-y min-h-[72px]"
              style={inputStyle}
            />
          </div>

          <ProductCategorySelect value={fCategoryId} onChange={setFCategoryId} disabled={saving} />
          <ProductPackagingFields packetPrice={packetPrice ?? calculatedPacketPrice} onPacketPriceChange={setPacketPrice} packetPriceOverridden={packetPrice !== null} onResetPacketPrice={() => setPacketPrice(null)} piecePrice={fSale} onPiecePriceChange={setFSale} packetEntry={true} value={packaging} onChange={setPackaging} disabled={saving} />
              <ProductStockField packets={packetEntry} value={fQuantity} onChange={setFQuantity} disabled={saving} />
          <ProductExpiryField nonExpiry={fNonExpiry} date={fExpiryDate} onNonExpiryChange={setFNonExpiry} onDateChange={setFExpiryDate} disabled={saving} />
              <div className="col-span-2 text-xs" style={{ color: "var(--gray-800)" }}>{packetEntry ? "Stock and cost are per packet; piece and packet selling prices are separate" : packaging.packaging_enabled ? `Stock, cost and base sale price use ${packaging.base_unit}` : "Standalone (fixed price per unit)"}</div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Item Code</label>
            <input value={fCode} disabled={codeLoading} onChange={(e) => setFCode(e.target.value)}
              placeholder="Auto-generated"
              className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono font-bold"
              style={{ ...inputStyle, background: "var(--blue-pale)", color: "var(--blue-deeper)" }} />
            {codeLoading && <span role="status" className="text-xs text-[var(--gray-800)]">Preparing code…</span>}
            {codeError && <span role="alert" className="text-xs text-[var(--red)]">{codeError}</span>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
              {packetEntry ? "Packet cost price (Rs)" : "Cost Price (Rs)"}
            </label>
            <input type="number" value={fCost} onChange={(e) => setFCost(e.target.value)}
              placeholder="0" min="0" step="0.01"
              className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
          </div>

          {!packetEntry && <div className="flex flex-col gap-1 col-span-2">
            <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
              Sale Price (Rs)
            </label>
            <input type="number" value={fSale} onChange={(e) => setFSale(e.target.value)}
              placeholder="0" min="0" step="0.01"
              className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
              </div>}

          {fCost && fSale && (packetEntry ? effectivePacketPrice : parseFloat(fSale)) > 0 && (
            <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-[9px]"
              style={{ background: "var(--green-light)", border: "1.5px solid rgba(14,173,106,.2)" }}>
              <span className="text-[11px] font-semibold" style={{ color: "var(--green)" }}>
                Margin: {Math.round((((packetEntry ? effectivePacketPrice : parseFloat(fSale)) - parseFloat(fCost)) / (packetEntry ? effectivePacketPrice : parseFloat(fSale))) * 100)}% —
                Rs {Math.round((packetEntry ? effectivePacketPrice : parseFloat(fSale)) - parseFloat(fCost))} profit per {packetEntry ? "packet" : "unit"}
              </span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white disabled:opacity-50"
            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
            Cancel
          </button>
          <button onClick={() => void run(handleSave)} disabled={saving || !fCategoryId || codeLoading || !!codeError}
            className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60 inline-flex items-center gap-1.5"
            style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save Product"}
          </button>
        </div>
      </div>
    </div>
  );
}
