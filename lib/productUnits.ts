/** Shared display helpers; stock is always measured in base units. */
export type Packaging = {
  packaging_enabled?: boolean; base_unit?: string; pieces_per_packet?: number;
  packets_per_box?: number; sale_price?: number; packet_sale_price?: number; box_sale_price?: number;
};
export const unitLabel = (unit?: string | null, base = "Piece") => unit === "piece" ? base : unit === "packet" ? "Packet" : unit === "box" ? "Box" : "Unit";
export function productUnits(product?: Pick<Packaging, "packaging_enabled" | "base_unit" | "pieces_per_packet" | "packets_per_box">) {
  if (!product?.packaging_enabled) return [{ value: "unit", label: "Unit", factor: 1 }];
  const pieces = Number(product.pieces_per_packet ?? 1), packets = Number(product.packets_per_box ?? 1);
  return [{ value: "piece", label: product.base_unit || "Piece", factor: 1 },
    ...(pieces > 1 ? [{ value: "packet", label: `Packet (${pieces} ${product.base_unit || "pieces"})`, factor: pieces }] : []),
    ...(packets > 1 ? [{ value: "box", label: `Box (${pieces * packets} ${product.base_unit || "pieces"})`, factor: pieces * packets }] : [])];
}
export function unitSalePrice(product: Packaging, unit: string): number {
  const factor = productUnits(product).find(row => row.value === unit)?.factor ?? 1;
  return Number(unit === "box" ? product.box_sale_price : unit === "packet" ? product.packet_sale_price : product.sale_price)
    || Math.round(Number(product.sale_price ?? 0) * factor * 100) / 100;
}
export function stockDisplay(qty: number, product: Packaging): string {
  if (!product.packaging_enabled) return `${qty} units`;
  const pieces = Number(product.pieces_per_packet ?? 1), box = pieces * Number(product.packets_per_box ?? 1);
  let remaining = qty;
  const parts: string[] = [];
  if (Number(product.packets_per_box) > 1 && remaining >= box) { const n = Math.floor(remaining / box); parts.push(`${n} box`); remaining -= n * box; }
  if (pieces > 1 && remaining >= pieces) { const n = Math.floor(remaining / pieces); parts.push(`${n} packet`); remaining -= n * pieces; }
  if (remaining || !parts.length) parts.push(`${Math.round(remaining * 100) / 100} ${product.base_unit || "Piece"}`);
  return `${qty} ${product.base_unit || "Piece"} (${parts.join(" + ")} equivalent)`;
}
