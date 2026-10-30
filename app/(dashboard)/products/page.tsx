"use client";

import { ProductPackagingFields, emptyPackaging } from "@/components/ProductPackagingFields";
import { stockParts, unitSalePrice, unitLabel, type Packaging } from "@/lib/productUnits";
import { useState, useEffect, useCallback, useRef } from "react";
import { ProductCategoryModal } from "@/components/ProductCategoryModal";
import { ProductCategorySelect } from "@/components/ProductCategorySelect";
import { ProductStockField } from "@/components/ProductStockField";
import { ProductBatchList } from "@/components/ProductBatchList";
import { ProductExpiryField } from "@/components/ProductExpiryField";
import { db } from "@/lib/db";
import { showToast } from "@/components/Toast";
import { formatCurrency } from "@/lib/helpers";
import { Plus, Pencil, Trash2, Package, Search, X } from "lucide-react";
import { DT } from "@/lib/dataTableStyles";
import { useUser } from "@/lib/UserContext";
import { useSaving } from "@/lib/useSaving";


interface Product extends Packaging {
  id: string;
  is_active: boolean;
  code: string;
  name: string;
  description?: string | null;
  cost_price: number;
  sale_price: number;
  quantity: number;
  expiry_date?: string | null;
  category_id?: string | null;
  product_categories?: { id: string; name: string } | null;
  created_at: string;
}

/** CR-16 — sequential numeric product codes ("1", "2", …) so they're easy to type into invoice/PO line pickers. */
function generateCode(_name: string, existing: Product[]): string {
  let max = 0;
  for (const p of existing) {
    const m = String(p.code ?? "").match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1);
}

export default function ProductsPage() {
  const userProfile = useUser();
  const { saving, run } = useSaving();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [fActive, setFActive] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [packaging, setPackaging] = useState({ ...emptyPackaging });
  const stockEntryFactor = useRef(1);
  const [fName, setFName] = useState("");
  const [fCode, setFCode] = useState("");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fCost, setFCost] = useState("");
  const [fSale, setFSale] = useState("");
  const [packetPrice, setPacketPrice] = useState<string | null>(null);
  const [fQuantity, setFQuantity] = useState("0");
  const [conversionUnit, setConversionUnit] = useState("piece");
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const converting = !!editingId && packaging.packaging_enabled && !products.find(p => p.id === editingId)?.packaging_enabled;
  const conversionFactor = conversionUnit === "piece" ? 1 : packaging.pieces_per_packet * (conversionUnit === "box" ? packaging.packets_per_box : 1);
  const effectiveCost = converting ? Number(products.find(p => p.id === editingId)?.cost_price || 0) / Math.max(1, conversionFactor) * packaging.pieces_per_packet : Number(fCost) || 0;
  const [originalQuantity, setOriginalQuantity] = useState(0);
  const [fNonExpiry, setFNonExpiry] = useState(true);
  const [fExpiryDate, setFExpiryDate] = useState("");

  const fetchProducts = useCallback(async () => {
    try {
      const { data, error } = await db.from("products").select("*, product_categories(*)").in("is_active", [true, false]).order("name");
      setLoadError(error?.message ?? "");
      if (data) setProducts(data);
    } catch {
      setLoadError("Could not load products. Please try again.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void db.from("products").select("*, product_categories(*)").in("is_active", [true, false]).order("name").then(({ data, error }) => {
      if (!active) return;
      setLoadError(error?.message ?? "");
      if (data) setProducts(data);
    }).catch(() => {
      if (active) setLoadError("Could not load products. Please try again.");
    });
    return () => { active = false; };
  }, []);

  function openAdd() {
    setFActive(true);
    stockEntryFactor.current = 1;
    setPacketPrice(null);
    setPackaging({ ...emptyPackaging });
    setConversionUnit("piece");
    setConversionConfirmed(false);
    setFNonExpiry(true);
    setFExpiryDate("");
    setFQuantity("0");
    setEditingId(null);
    setFCategoryId("");
    setFName(""); setFCode(""); setFDescription(""); setFCost(""); setFSale("");
    setShowModal(true);
  }

  function openEdit(p: Product) {
    setFActive(p.is_active !== false);
    setPacketPrice(p.packaging_enabled && Number(p.packet_sale_price) > 0 && Number(p.packet_sale_price) !== Math.round(Number(p.sale_price) * Number(p.pieces_per_packet) * 100) / 100 ? String(p.packet_sale_price) : null);
    setPackaging({ ...emptyPackaging, packaging_enabled: !!p.packaging_enabled, base_unit: p.base_unit || "Piece", pieces_per_packet: p.pieces_per_packet || 1, packets_per_box: p.packets_per_box || 1, packet_sale_price: Number(p.packet_sale_price || 0), box_sale_price: Number(p.box_sale_price || 0) });
    setConversionUnit("piece"); setConversionConfirmed(false);
    setOriginalQuantity(p.quantity ?? 0);
    setFQuantity(String(p.quantity ?? 0));
    setFNonExpiry(!p.expiry_date);
    setFExpiryDate(p.expiry_date?.slice(0, 10) ?? "");
    setEditingId(p.id);
    setFCategoryId(p.category_id ?? "");
    setFName(p.name);
    setFCode(p.code);
    setFDescription(p.description?.trim() ? p.description : "");
    setFCost(String(Number(p.cost_price) * (p.packaging_enabled ? Number(p.pieces_per_packet) || 1 : 1)));
    setFSale(String(p.sale_price));
    setShowModal(true);
  }

  function handleNameChange(name: string) {
    setFName(name);
    if (!editingId) {
      setFCode(generateCode(name, products));
    }
  }

  const packetEntry = packaging.packaging_enabled;
  const entryFactor = packetEntry ? packaging.pieces_per_packet : 1;
  const calculatedPacketPrice = Math.round((Number(fSale) || 0) * entryFactor * 100) / 100;
  const effectivePacketPrice = packetPrice === null ? calculatedPacketPrice : Number(packetPrice);

  async function handleSave() {
    if (!fNonExpiry && !fExpiryDate) { showToast("Enter the expiry date", "err"); return; }
    if (converting && !conversionConfirmed) { showToast("Review and confirm the existing stock conversion", "err"); return; }
    const quantity = Number(fQuantity);
    if (!fQuantity.trim() || !Number.isFinite(quantity) || Math.abs(Number(fQuantity) - Math.round(Number(fQuantity) * 100) / 100) > 0.00000001 || quantity < 0 || quantity > 2147483647) {
      showToast("Enter stock quantity of zero or more with up to two decimal places", "err"); return;
    }
    if (!fCategoryId) { showToast("Select a category", "err"); return; }
    if (!fName.trim()) { showToast("Enter product name", "err"); return; }

    if (packetEntry && (!Number.isInteger(entryFactor) || entryFactor < 1 || entryFactor > 1000000)) { showToast("Enter whole loose units per kit / packet between 1 and 1,000,000", "err"); return; }
    if (packetEntry && packetPrice !== null && (!packetPrice.trim() || !Number.isFinite(Number(packetPrice)) || Number(packetPrice) < 0)) { showToast("Enter a kit / packet selling price of zero or more", "err"); return; }
    const payload = {
      is_active: fActive,
      code: fCode || generateCode(fName, products),
      name: fName.trim(),
      description: fDescription.trim(),
      cost_price: (parseFloat(fCost) || 0) / entryFactor,
      sale_price: parseFloat(fSale) || 0,
      ...packaging,
      ...(packetEntry ? { packet_sale_price: effectivePacketPrice } : {}),
      pricing_type: "standalone",
      category_id: fCategoryId,
      ...(converting ? { conversion_unit: conversionUnit, expected_quantity: originalQuantity } : !editingId ? { quantity } : quantity !== originalQuantity ? { quantity, expected_quantity: originalQuantity } : {}),
      ...(!editingId ? { expiry_date: fNonExpiry ? null : fExpiryDate } : {}),
    };

    if (editingId) {
      const { error } = await db.from("products").update(payload).eq("id", editingId);
      if (error) { showToast(error.message, "err"); return; }
      showToast("Product updated", "ok");
    } else {
      const { error } = await db.from("products").insert(payload);
      if (error) { showToast(error.message, "err"); return; }
      showToast("Product saved", "ok");
    }
    setShowModal(false);
    fetchProducts();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this product?")) return;
    const { error } = await db.from("products").delete().eq("id", id);
    if (error) { showToast(error.message, "err"); return; }
    showToast("Product deleted", "ok");
    fetchProducts();
  }

  const inputStyle = { borderColor: "var(--gray-200)", background: "var(--gray-50)", color: "var(--gray-900)" };
  const searchQuery = search.trim().toLowerCase();
  const filteredProducts = products.filter((product) =>
    (statusFilter === "all" || (product.is_active !== false) === (statusFilter === "active")) &&
    [product.name, product.code, product.description, product.product_categories?.name ?? "Uncategorized"]
      .some((value) => value?.toLowerCase().includes(searchQuery))
  );

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Products</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Enter stock in kits. Vials per kit and vial price calculate total vials and kit price.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setShowCategoryModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-[1.5px] text-[12.5px] font-semibold cursor-pointer bg-white hover:bg-[var(--blue-pale)]"
          style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
          <Plus size={14} /> Category
        </button>
        <button onClick={openAdd}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border-none text-[12.5px] font-semibold cursor-pointer text-white"
          style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))", boxShadow: "0 2px 10px rgba(2,132,199,.28)" }}>
          <Plus size={14} /> Add Product
        </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[14px] border border-[var(--gray-100)] overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="px-5 py-4 border-b border-[var(--gray-100)] flex items-center justify-between">
          <span className="text-lg sm:text-xl font-extrabold tracking-tight" style={{ color: "var(--gray-900)" }}>Product List</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--blue-pale)", color: "var(--blue-deeper)" }}>
            {filteredProducts.length} items
          </span>
        </div>

        <div className="px-5 py-3 border-b border-[var(--gray-100)] flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">Status<select aria-label="Filter products by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 bg-white"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select></label>
          <div className="relative w-full sm:max-w-md">
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--gray-800)" }} />
            <input
              type="search"
              aria-label="Search products"
              placeholder="Search by name, code, description or category…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }}
              className="w-full border-[1.5px] border-[var(--gray-200)] rounded-[9px] pl-9 pr-10 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)] placeholder:text-[var(--gray-800)] [&::-webkit-search-cancel-button]:appearance-none"
              style={{ background: "var(--gray-50)", color: "var(--gray-900)" }}
            />
            {search && (
              <button type="button" aria-label="Clear product search" onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-[6px] cursor-pointer hover:bg-[var(--blue-pale)] focus-visible:outline-2 focus-visible:outline-[var(--blue)]"
                style={{ color: "var(--gray-800)" }}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {loadError ? (
          <p role="alert" className="p-5 text-sm" style={{ color: "var(--red)" }}>
            {loadError} <button type="button" className="underline cursor-pointer" onClick={() => void fetchProducts()}>Retry</button>
          </p>
        ) : products.length === 0 ? (
          <div className="py-14 text-center">
            <Package size={32} className="mx-auto mb-2" style={{ color: "var(--gray-200)" }} />
            <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No products yet. Add your first product.</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-14 px-5 text-center" role="status">
            <Search size={32} aria-hidden="true" className="mx-auto mb-2" style={{ color: "var(--gray-400)" }} />
            <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No products match this status and search.</p>
            <button type="button" onClick={() => { setSearch(""); setStatusFilter("all"); }} className="mt-2 text-[13px] font-semibold underline cursor-pointer" style={{ color: "var(--blue-deeper)" }}>Show all products</button>
          </div>
        ) : (
          <>
          <p className="px-5 py-3 text-xs border-b border-[var(--gray-100)]" style={{ color: "var(--gray-800)" }}>Example: 1 kit = 10 vials. Enter 3 kits to stock 30 vials. Selling 1 vial leaves 2.9 kits (29 vials). Kit/packet balances include opened stock.</p>
          <div className="overflow-x-auto">
            <table className={`${DT.table} min-w-[1100px]`}>
              <thead>
                <tr>
                  {["Item Code", "Product / pack size", "Description", "Category", "Available stock", "Cost prices", "Selling prices", "Stock value at cost", "Margin by unit", "Actions"].map((h) => (
                    <th key={h} className={`${DT.th} text-left`} style={DT.thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const base = p.base_unit || "Piece";
                  const pack = unitLabel("packet", base);
                  const basePlural = base === "Vial" ? "vials" : base === "Piece" ? "pieces" : `${base} units`;
                  const { size } = stockParts(Number(p.quantity) || 0, p);
                  const priceUnits = p.packaging_enabled ? [
                    { unit: "packet", label: pack, factor: size },
                    { unit: "piece", label: base, factor: 1 },
                    ...(Number(p.packets_per_box) > 1 ? [{ unit: "box", label: "Outer box", factor: size * Number(p.packets_per_box) }] : []),
                  ] : [{ unit: "unit", label: "Unit", factor: 1 }];
                  const qtyText = (qty: number) => qty.toLocaleString("en-PK", { maximumFractionDigits: 2 });
                  return (
                    <tr key={p.id} className={DT.row}>
                      <td className={DT.td}>
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}>
                          {p.code}
                        </span>
                      </td>
                      <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>
                        {p.name}{p.is_active === false && <span className="block text-xs font-semibold text-red-700">Inactive</span>}{p.packaging_enabled && <small className="block font-normal text-xs">1 {unitLabel("packet", p.base_unit)} = {p.pieces_per_packet} {p.base_unit}s{Number(p.packets_per_box) > 1 && `; outer box = ${p.packets_per_box} packs`}</small>}
                      </td>
                      <td className={`${DT.td} max-w-[220px] sm:max-w-[280px]`} style={{ color: "var(--gray-800)" }}>
                        {p.description?.trim() ? (
                          <span className="text-[12px] leading-snug line-clamp-3">{p.description.trim()}</span>
                        ) : (
                          <span className="text-[12px]" style={{ color: "var(--gray-400)" }}>—</span>
                        )}
                      </td>
                      <td className={DT.td}><span className="text-[12px]" style={{ color: "var(--gray-800)" }}>{p.product_categories?.name ?? "Uncategorized"}</span></td>
                      <td className={`${DT.td} min-w-[170px]`} style={{ color: Number(p.quantity) === 0 ? "var(--red)" : "var(--gray-900)" }}>
                        {p.packaging_enabled ? <dl className="space-y-1 text-xs">
                          <div className="flex justify-between gap-3 font-semibold"><dt>{pack}s</dt><dd className="font-mono">{(Number(p.quantity) / size).toLocaleString("en-PK", { maximumFractionDigits: 10 })}</dd></div>
                          <div className="flex justify-between gap-3 border-t border-[var(--gray-200)] pt-1"><dt>Total {basePlural}</dt><dd className="font-mono font-semibold">{qtyText(Number(p.quantity) || 0)}</dd></div>
                        </dl> : <span className="font-mono">{qtyText(Number(p.quantity) || 0)} units</span>}
                      </td>
                      <td className={`${DT.td} min-w-[130px]`}>
                        <dl className="space-y-1 text-xs">{priceUnits.map((u, i) => <div key={u.unit} className={`flex justify-between gap-3 ${i === 0 ? "font-semibold" : ""}`}><dt>Per {u.label.toLowerCase()}</dt><dd className="font-mono whitespace-nowrap">{formatCurrency(Number(p.cost_price) * u.factor)}</dd></div>)}</dl>
                      </td>
                      <td className={`${DT.td} min-w-[130px]`} style={{ color: "var(--blue-deeper)" }}>
                        <dl className="space-y-1 text-xs">{priceUnits.map((u, i) => <div key={u.unit} className={`flex justify-between gap-3 ${i === 0 ? "font-semibold" : ""}`}><dt>Per {u.label.toLowerCase()}</dt><dd className="font-mono whitespace-nowrap">{formatCurrency(unitSalePrice(p, u.unit))}</dd></div>)}</dl>
                      </td>
                      <td className={`${DT.td} ${DT.cellMono}`}>{formatCurrency(Number(p.quantity) * Number(p.cost_price))}</td>
                      <td className={DT.td}>
                        <dl className="space-y-1 text-xs">{priceUnits.map(u => {
                          const sale = unitSalePrice(p, u.unit), cost = Number(p.cost_price) * u.factor;
                          const margin = sale > 0 ? Math.round((sale - cost) / sale * 100) : 0;
                          return <div key={u.unit} className="flex justify-between items-center gap-3"><dt>Per {u.label.toLowerCase()}</dt><dd className={DT.badge} style={{ background: margin >= 20 ? "var(--green-light)" : "var(--orange-light)", color: margin >= 20 ? "var(--green)" : "#B45309" }}>{margin}%</dd></div>;
                        })}</dl>
                      </td>
                      <td className={DT.td}>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(p)}
                            className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white hover:bg-[var(--blue-pale)] transition-all"
                            style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }} title="Edit">
                            <Pencil size={12} />
                          </button>
                          {userProfile?.isAdmin && (
                            <button onClick={() => handleDelete(p.id)}
                              className="w-7 h-7 rounded-[6px] border-[1.5px] flex items-center justify-center cursor-pointer bg-white hover:bg-[var(--red-light)] transition-all"
                              style={{ borderColor: "var(--gray-200)", color: "var(--red)" }} title="Delete">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {showCategoryModal && <ProductCategoryModal onClose={() => setShowCategoryModal(false)} onCreated={() => { void fetchProducts(); }} />}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[800] flex items-start justify-center backdrop-blur-sm pt-10 px-4 overflow-y-auto"
          style={{ background: "rgba(10,30,50,.3)" }}
          >
          <div className="bg-white rounded-[20px] w-[480px] max-w-full overflow-hidden animate-slide-up"
            style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-100)]">
              <h2 className="text-[15px] font-bold">{editingId ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setShowModal(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center border-none cursor-pointer"
                style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}>
                <X size={12} />
              </button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3.5">
              {editingId && (
                <fieldset className="col-span-2">
                  <legend className="text-xs font-semibold mb-2">Product status</legend>
                  <div className="flex gap-2">
                    {[{ label: "Active", value: true }, { label: "Inactive", value: false }].map(status => (
                      <button key={status.label} type="button" aria-pressed={fActive === status.value}
                        disabled={saving} onClick={() => setFActive(status.value)}
                        className="px-4 py-2 rounded-lg border text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"
                        style={{ background: fActive === status.value ? "var(--blue-deeper)" : "#fff", color: fActive === status.value ? "#fff" : "var(--blue-deeper)", borderColor: "var(--blue-deeper)" }}>
                        {status.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-700 mt-2">Inactive products are hidden from new invoices and product selections. Existing records are kept.</p>
                </fieldset>
              )}
              {/* Product Name - full width */}
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

              {/* Pricing Type */}
              <ProductCategorySelect value={fCategoryId} onChange={setFCategoryId} disabled={saving} />
              <ProductPackagingFields packetPrice={packetPrice ?? calculatedPacketPrice} onPacketPriceChange={setPacketPrice} packetPriceOverridden={packetPrice !== null} onResetPacketPrice={() => setPacketPrice(null)} piecePrice={fSale} onPiecePriceChange={setFSale} packetEntry={true} value={packaging} onChange={p => {
                const factor = p.packaging_enabled ? p.pieces_per_packet : 1;
                if (!editingId && factor > 0 && Number.isFinite(factor) && factor !== stockEntryFactor.current) {
                  const previousFactor = stockEntryFactor.current;
                  setFQuantity(current => String(Math.round(Number(current) / previousFactor * factor * 100) / 100));
                  stockEntryFactor.current = factor;
                }
                setPackaging(p); setConversionConfirmed(false);
                const old = products.find(row => row.id === editingId);
                if (old && !old.packaging_enabled) { const factor = conversionUnit === "piece" ? 1 : p.pieces_per_packet * (conversionUnit === "box" ? p.packets_per_box : 1); if (factor > 0 && factor !== conversionFactor) setFSale(String(Math.round(Number(old.sale_price) / factor * 100) / 100)); }
                if (old?.packaging_enabled && p.pieces_per_packet !== packaging.pieces_per_packet) setFCost(String(Number(fCost) / Math.max(1, packaging.pieces_per_packet) * p.pieces_per_packet));
              }} disabled={saving} locked={!!editingId && !!products.find(p => p.id === editingId)?.packaging_enabled} />
              <ProductStockField packaging={converting ? undefined : packaging} value={fQuantity} onChange={setFQuantity} disabled={saving || converting} />
              {converting && <div className="col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
                <label>What does the existing stock quantity represent?<select aria-label="Existing stock unit" className="block w-full border rounded p-2 mt-1" value={conversionUnit} onChange={e => { setConversionUnit(e.target.value); setConversionConfirmed(false);
                    const factor = e.target.value === "piece" ? 1 : packaging.pieces_per_packet * (e.target.value === "box" ? packaging.packets_per_box : 1);
                    setFSale(String(Math.round(Number(products.find(p => p.id === editingId)?.sale_price || 0) / factor * 100) / 100)); }}>
                  <option value="piece">Loose {packaging.base_unit}s</option><option value="packet">Full {unitLabel("packet", packaging.base_unit)}s</option><option value="box">Outer boxes</option>
                </select></label>
                <p>{originalQuantity} existing units × {conversionFactor} = <strong>{originalQuantity * conversionFactor} {packaging.base_unit}</strong>.</p>
                <p>Cost per {packaging.base_unit}: Rs {(Number(products.find(p => p.id === editingId)?.cost_price || 0) / conversionFactor).toFixed(8)}. Total stock cost stays the same. Invoice quantities and amounts are preserved.</p>
                <label className="flex gap-2"><input type="checkbox" checked={conversionConfirmed} onChange={e => setConversionConfirmed(e.target.checked)} /> I confirm this one-time conversion.</label>
              </div>}
              <ProductExpiryField nonExpiry={fNonExpiry} date={fExpiryDate} onNonExpiryChange={setFNonExpiry} onDateChange={setFExpiryDate} disabled={saving || !!editingId} />
              {editingId && <ProductBatchList productId={editingId} />}
              <div className="col-span-2 text-xs" style={{ color: "var(--gray-800)" }}>{packetEntry ? `Stock is entered in ${unitLabel("packet", packaging.base_unit).toLowerCase()}s only; ${packaging.base_unit.toLowerCase()} stock is calculated. Cost is per ${unitLabel("packet", packaging.base_unit).toLowerCase()}.` : packaging.packaging_enabled ? `Stock, cost and base sale price use ${packaging.base_unit}` : "Standalone (fixed price per unit)"}</div>

              {/* Item Code */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>Item Code</label>
                <input value={fCode} onChange={(e) => setFCode(e.target.value)}
                  placeholder="Auto-generated"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono font-bold"
                  style={{ ...inputStyle, background: "var(--blue-pale)", color: "var(--blue-deeper)" }} />
              </div>

              {/* Cost Price */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                  {packetEntry ? `${unitLabel("packet", packaging.base_unit)} cost price (Rs)` : "Cost Price (Rs)"}
                </label>
                <input type="number" value={converting ? effectiveCost : fCost} disabled={converting} onChange={(e) => setFCost(e.target.value)}
                  placeholder="0" min="0" step="0.01"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
              </div>

              {/* Sale Price */}
              {!packetEntry && <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                  Sale Price (Rs)
                </label>
                <input type="number" value={fSale} onChange={(e) => setFSale(e.target.value)}
                  placeholder="0" min="0" step="0.01"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
              </div>}

              {/* Margin preview */}
              {fCost && fSale && (packetEntry ? effectivePacketPrice : parseFloat(fSale)) > 0 && (
                <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-[9px]"
                  style={{ background: "var(--green-light)", border: "1.5px solid rgba(14,173,106,.2)" }}>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--green)" }}>
                    Margin: {Math.round((((packetEntry ? effectivePacketPrice : parseFloat(fSale)) - effectiveCost) / (packetEntry ? effectivePacketPrice : parseFloat(fSale))) * 100)}% —
                    Rs {Math.round((packetEntry ? effectivePacketPrice : parseFloat(fSale)) - effectiveCost)} profit per {packetEntry ? unitLabel("packet", packaging.base_unit).toLowerCase() : "unit"}
                  </span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-100)]">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-[1.5px] cursor-pointer bg-white"
                style={{ borderColor: "var(--gray-200)", color: "var(--blue-deeper)" }}>
                Cancel
              </button>
              <button onClick={() => run(handleSave)} disabled={saving}
                className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold border-none cursor-pointer text-white disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, var(--blue-deeper), var(--blue))" }}>
                {saving ? "Saving…" : (editingId ? "Update Product" : "Save Product")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
