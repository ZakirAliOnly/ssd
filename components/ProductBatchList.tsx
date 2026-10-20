"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/helpers";

type Batch = { id: string; received_date: string; expiry_date: string | null; remaining_qty: number };
export function ProductBatchList({ productId }: { productId: string }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void db.from("stock_batches").select("id, received_date, expiry_date, remaining_qty").eq("product_id", productId)
      .gte("remaining_qty", 0.01).order("received_date").order("created_at").order("id").then(({ data, error }) => {
        if (!active) return;
        setBatches(data ?? []); setError(error?.message ?? "");
        setLoading(false);
      });
    return () => { active = false; };
  }, [productId]);
  return <div className="col-span-2 text-xs">
    <p className="font-semibold mb-2">Stock batches · oldest purchase sold first</p>
    {error ? <p role="alert" className="text-[var(--red)]">{error}</p> : loading ? <p>Loading batches…</p> : batches.length ?
      <div className="max-h-40 overflow-auto rounded-lg border border-[var(--gray-200)]">
        <table className="w-full text-left"><thead className="bg-[var(--gray-50)]"><tr>
          <th className="p-2">Received</th><th className="p-2">Expiry</th><th className="p-2 text-right">Available</th>
        </tr></thead><tbody>{batches.map((batch, index) => <tr key={batch.id} className="border-t border-[var(--gray-100)]">
          <td className="p-2">{formatDate(batch.received_date)}{index === 0 ? " · Next to sell" : ""}</td>
          <td className="p-2">{batch.expiry_date ? formatDate(batch.expiry_date) : "Non-expiry"}</td>
          <td className="p-2 text-right font-mono">{batch.remaining_qty}</td>
        </tr>)}</tbody></table>
      </div> : <p>No stock batches available.</p>}
    <p className="mt-2 text-[var(--gray-700)]">Manage batch expiry in its purchase invoice. The product shows the expiry of the next batch to sell.</p>
  </div>;
}
