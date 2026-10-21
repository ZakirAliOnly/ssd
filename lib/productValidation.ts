export class ProductValidationError extends Error {}

function validStock(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2147483647 && Math.abs(value - Math.round(value * 100) / 100) < 0.00000001;
}

export function normalizeCategory(data: Record<string, unknown>) {
  const name = typeof data.name === "string" ? data.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 100) {
    throw new ProductValidationError("Enter a category name between 1 and 100 characters.");
  }
  return { ...data, name, name_key: name.toLowerCase() };
}

export function normalizeProduct(data: Record<string, unknown>, inserting: boolean): Record<string, unknown> {
  for (const key of ["cost_price", "sale_price"]) if (key in data && (typeof data[key] !== "number" || !Number.isFinite(data[key]) || Number(data[key]) < 0 || Number(data[key]) > 9999999999.99)) throw new ProductValidationError("Enter a valid non-negative cost and sale price.");
  if ("packaging_converted_at" in data) throw new ProductValidationError("Stock conversion history cannot be edited.");
  if (inserting && "conversion_unit" in data) throw new ProductValidationError("New products start in base units.");
  if ("packaging_enabled" in data && typeof data.packaging_enabled !== "boolean") throw new ProductValidationError("Choose a valid packaging setup.");
  if (["base_unit", "pieces_per_packet", "packets_per_box", "packet_sale_price", "box_sale_price"].some(key => key in data)) {
    if (typeof data.base_unit !== "string" || !data.base_unit.trim() || data.base_unit.length > 30) throw new ProductValidationError("Enter a base unit name, such as Vial.");
    const pieces = Number(data.pieces_per_packet), packets = Number(data.packets_per_box);
    if (!Number.isInteger(pieces) || !Number.isInteger(packets) || pieces < 1 || packets < 1 || pieces * packets > 1000000) throw new ProductValidationError("Packaging sizes must be whole numbers from 1; a box can contain at most 1,000,000 base units.");
    for (const key of ["packet_sale_price", "box_sale_price"]) if (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0 || Number(data[key]) > 9999999999.99) throw new ProductValidationError("Enter valid packet and box prices.");
  }
  if (("expected_quantity" in data && !("conversion_unit" in data)) || (!inserting && "quantity" in data)) {
    if (inserting || !("quantity" in data) || !validStock(data.expected_quantity)) {
      throw new ProductValidationError("Reload the product before editing its stock quantity.");
    }
  }
  if (inserting || "quantity" in data) {
    if (!validStock(data.quantity)) {
      throw new ProductValidationError("Stock quantity must be zero or more with up to two decimal places.");
    }
  }
  if (inserting || "category_id" in data) {
    if (typeof data.category_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.category_id)) {
      throw new ProductValidationError("Select a product category.");
    }
  }
  if ("expiry_date" in data && data.expiry_date !== null) {
    const date = data.expiry_date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new ProductValidationError("Enter a valid expiry date or select Non-expiry product.");
    }
  }
  return { ...(inserting ? { expiry_date: null } : {}), ...data, pricing_type: "standalone" };
}
