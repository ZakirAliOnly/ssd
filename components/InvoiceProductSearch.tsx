"use client";

import { useCallback, useEffect, useState } from "react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { invoiceProductOption } from "@/lib/productOptions";
import type { Packaging } from "@/lib/productUnits";

export interface PickerProduct extends Packaging {
  id: string; code: string | null; name: string; sale_price: number;
  description?: string | null; pricing_type?: string | null; expiry_date?: string | null;
  quantity?: number; product_categories?: { name: string } | null;
}

/** Each open picker requests at most 20 matches, never the complete catalogue. */
export function InvoiceProductSearch({ value, products, onProducts, onChange, onCreate, inputClassName }: {
  value: string; products: PickerProduct[]; onProducts: (products: PickerProduct[]) => void;
  onChange: (value: string) => void; onCreate: (query: string) => void; inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; products: PickerProduct[]; error: string } | null>(null);
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (next && !open) setResult(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/products?${new URLSearchParams({ mode: "picker", q: query })}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load products");
        if (controller.signal.aborted) return;
        onProducts(body.products);
        setResult({ query, products: body.products, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ query, products: [], error: error instanceof Error ? error.message : "Could not load products" });
      }
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, open, onProducts]);

  const selected = products.find(product => product.id === value);
  const matches = result?.query === query ? result.products : [];
  // Keep the selected label when closed, without including it in unrelated search results.
  const options = open ? matches : selected ? [selected] : [];
  return <SearchableSelect value={value} onChange={onChange} options={options.map(invoiceProductOption)}
    remote onOpenChange={changeOpen} onSearchChange={setQuery} loading={open && result?.query !== query}
    loadError={result?.query === query ? result.error : ""} placeholder="— Product —"
    inputClassName={inputClassName} inputStyle={{ color: "#0C2433" }}
    onCreate={onCreate} createLabel="+ Add new product" />;
}
