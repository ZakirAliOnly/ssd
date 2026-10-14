"use client";

import { useState, useEffect, useCallback } from "react";
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


interface Product {
  id: string;
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
  const [loadError, setLoadError] = useState("");
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  const [fCode, setFCode] = useState("");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fCost, setFCost] = useState("");
  const [fSale, setFSale] = useState("");
  const [fQuantity, setFQuantity] = useState("0");
  const [originalQuantity, setOriginalQuantity] = useState(0);
  const [fNonExpiry, setFNonExpiry] = useState(true);
  const [fExpiryDate, setFExpiryDate] = useState("");

  const fetchProducts = useCallback(async () => {
    try {
      const { data, error } = await db.from("products").select("*, product_categories(*)").order("name");
      setLoadError(error?.message ?? "");
      if (data) setProducts(data);
    } catch {
      setLoadError("Could not load products. Please try again.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void db.from("products").select("*, product_categories(*)").order("name").then(({ data, error }) => {
      if (!active) return;
      setLoadError(error?.message ?? "");
      if (data) setProducts(data);
    }).catch(() => {
      if (active) setLoadError("Could not load products. Please try again.");
    });
    return () => { active = false; };
  }, []);

  function openAdd() {
    setFNonExpiry(true);
    setFExpiryDate("");
    setFQuantity("0");
    setEditingId(null);
    setFCategoryId("");
    setFName(""); setFCode(""); setFDescription(""); setFCost(""); setFSale("");
    setShowModal(true);
  }

  function openEdit(p: Product) {
    setOriginalQuantity(p.quantity ?? 0);
    setFQuantity(String(p.quantity ?? 0));
    setFNonExpiry(!p.expiry_date);
    setFExpiryDate(p.expiry_date?.slice(0, 10) ?? "");
    setEditingId(p.id);
    setFCategoryId(p.category_id ?? "");
    setFName(p.name);
    setFCode(p.code);
    setFDescription(p.description?.trim() ? p.description : "");
    setFCost(String(p.cost_price));
    setFSale(String(p.sale_price));
    setShowModal(true);
  }

  function handleNameChange(name: string) {
    setFName(name);
    if (!editingId) {
      setFCode(generateCode(name, products));
    }
  }

  async function handleSave() {
    if (!fNonExpiry && !fExpiryDate) { showToast("Enter the expiry date", "err"); return; }
    const quantity = Number(fQuantity);
    if (!fQuantity.trim() || !Number.isFinite(quantity) || Math.abs(quantity - Math.round(quantity * 100) / 100) > 0.00000001 || quantity < 0 || quantity > 2147483647) {
      showToast("Enter stock quantity of zero or more with up to two decimal places", "err"); return;
    }
    if (!fCategoryId) { showToast("Select a category", "err"); return; }
    if (!fName.trim()) { showToast("Enter product name", "err"); return; }

    const payload = {
      code: fCode || generateCode(fName, products),
      name: fName.trim(),
      description: fDescription.trim(),
      cost_price: parseFloat(fCost) || 0,
      sale_price: parseFloat(fSale) || 0,
      pricing_type: "standalone",
      category_id: fCategoryId,
      ...(!editingId ? { quantity } : quantity !== originalQuantity ? { quantity, expected_quantity: originalQuantity } : {}),
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
    [product.name, product.code, product.description, product.product_categories?.name ?? "Uncategorized"]
      .some((value) => value?.toLowerCase().includes(searchQuery))
  );

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color: "var(--gray-900)" }}>Products</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--gray-800)" }}>Manage your product & pricing catalogue</p>
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
            {searchQuery ? `${filteredProducts.length} of ${products.length}` : products.length} items
          </span>
        </div>

        <div className="px-5 py-3 border-b border-[var(--gray-100)]">
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
            <p className="text-[13px] font-medium" style={{ color: "var(--gray-800)" }}>No products match your search.</p>
            <button type="button" onClick={() => setSearch("")} className="mt-2 text-[13px] font-semibold underline cursor-pointer" style={{ color: "var(--blue-deeper)" }}>Clear search</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={`${DT.table} min-w-[760px]`}>
              <thead>
                <tr>
                  {["Item Code", "Product Name", "Description", "Category", "Quantity", "Cost Price", "Sale Price", "Margin", ""].map((h) => (
                    <th key={h} className={`${DT.th} text-left`} style={DT.thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const margin = p.sale_price > 0
                    ? Math.round(((p.sale_price - p.cost_price) / p.sale_price) * 100)
                    : 0;
                  return (
                    <tr key={p.id} className={DT.row}>
                      <td className={DT.td}>
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--blue-light)", color: "var(--blue-deeper)" }}>
                          {p.code}
                        </span>
                      </td>
                      <td className={`${DT.td} ${DT.cellPrimary}`} style={{ color: "var(--gray-900)" }}>
                        {p.name}
                      </td>
                      <td className={`${DT.td} max-w-[220px] sm:max-w-[280px]`} style={{ color: "var(--gray-800)" }}>
                        {p.description?.trim() ? (
                          <span className="text-[12px] leading-snug line-clamp-3">{p.description.trim()}</span>
                        ) : (
                          <span className="text-[12px]" style={{ color: "var(--gray-400)" }}>—</span>
                        )}
                      </td>
                      <td className={DT.td}><span className="text-[12px]" style={{ color: "var(--gray-800)" }}>{p.product_categories?.name ?? "Uncategorized"}</span></td>
                      <td className={`${DT.td} ${DT.cellMono}`} style={{ color: p.quantity === 0 ? "var(--red)" : "var(--gray-900)" }}>{p.quantity ?? 0}</td>
                      <td className={`${DT.td} ${DT.cellMono}`} style={{ color: "var(--gray-900)" }}>
                        {formatCurrency(p.cost_price)}
                      </td>
                      <td className={`${DT.td} font-mono font-bold text-[15px]`} style={{ color: "var(--blue-deeper)" }}>
                        {formatCurrency(p.sale_price)}
                      </td>
                      <td className={DT.td}>
                        <span className={DT.badge}
                          style={{ background: margin >= 20 ? "var(--green-light)" : "var(--orange-light)", color: margin >= 20 ? "var(--green)" : "#B45309" }}>
                          {margin}%
                        </span>
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
              <ProductStockField value={fQuantity} onChange={setFQuantity} disabled={saving} />
              <ProductExpiryField nonExpiry={fNonExpiry} date={fExpiryDate} onNonExpiryChange={setFNonExpiry} onDateChange={setFExpiryDate} disabled={saving || !!editingId} />
              {editingId && <ProductBatchList productId={editingId} />}
              <div className="col-span-2 text-xs" style={{ color: "var(--gray-800)" }}>Standalone (fixed price per unit)</div>

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
                  Cost Price (Rs)
                </label>
                <input type="number" value={fCost} onChange={(e) => setFCost(e.target.value)}
                  placeholder="0" min="0"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
              </div>

              {/* Sale Price */}
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[10px] font-bold tracking-[1.2px] uppercase" style={{ color: "var(--blue-deeper)" }}>
                  Sale Price (Rs)
                </label>
                <input type="number" value={fSale} onChange={(e) => setFSale(e.target.value)}
                  placeholder="0" min="0"
                  className="border-[1.5px] rounded-[9px] px-3 py-2 text-[13px] outline-none font-mono" style={inputStyle} />
              </div>

              {/* Margin preview */}
              {fCost && fSale && parseFloat(fSale) > 0 && (
                <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-[9px]"
                  style={{ background: "var(--green-light)", border: "1.5px solid rgba(14,173,106,.2)" }}>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--green)" }}>
                    Margin: {Math.round(((parseFloat(fSale) - parseFloat(fCost)) / parseFloat(fSale)) * 100)}% —
                    Rs {Math.round(parseFloat(fSale) - parseFloat(fCost))} profit per unit
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
