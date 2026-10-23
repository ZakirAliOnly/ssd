/** Shared display helpers; stock is always measured in base units. */
export type Packaging = {
  packaging_enabled?: boolean; base_unit?: string; pieces_per_packet?: number;
  packets_per_box?: number; sale_price?: number; packet_sale_price?: number; box_sale_price?: number;
};
export const unitLabel = (unit?: string | null, base = "Piece") => unit === "piece" ? base : unit === "packet" ? (base === "Vial" ? "Kit" : "Packet") : unit === "box" ? "Box" : "Unit";
export function productUnits(product?: Pick<Packaging, "packaging_enabled" | "base_unit" | "pieces_per_packet" | "packets_per_box">) {
  if (!product?.packaging_enabled) return [{ value: "unit", label: "Unit", factor: 1 }];
  const pieces = Number(product.pieces_per_packet ?? 1), packets = Number(product.packets_per_box ?? 1);
  return [{ value: "piece", label: product.base_unit || "Piece", factor: 1 },
    { value: "packet", label: `${unitLabel("packet", product.base_unit)} (${pieces} ${product.base_unit || "pieces"})`, factor: pieces },
    ...(packets > 1 ? [{ value: "box", label: `Box (${pieces * packets} ${product.base_unit || "pieces"})`, factor: pieces * packets }] : [])];
}
export function unitSalePrice(product: Packaging, unit: string): number {
  const factor = productUnits(product).find(row => row.value === unit)?.factor ?? 1;
  return Number(unit === "box" ? product.box_sale_price : unit === "packet" ? product.packet_sale_price : product.sale_price)
    || Math.round(Number(product.sale_price ?? 0) * factor * 100) / 100;
}
/** Quantities remain in loose base units; kits are a display/input conversion. */
export function stockParts(qty: number, product: Packaging) {
  const size = product.packaging_enabled ? Math.max(1, Number(product.pieces_per_packet) || 1) : 1;
  const packs = Math.floor(Math.round(qty * 100) / Math.round(size * 100));
  return { packs, loose: Math.round((qty - packs * size) * 100) / 100, size };
}
export function stockDisplay(qty: number, product: Packaging): string {
  if (!product.packaging_enabled) return `${qty} units`;
  const { packs, loose } = stockParts(qty, product);
  return `${packs} ${unitLabel("packet", product.base_unit)}${loose ? ` + ${loose} ${product.base_unit || "Piece"}` : ""} equivalent (${qty} ${product.base_unit || "Piece"} total)`;
}
