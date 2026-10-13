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
  if ("expected_quantity" in data || (!inserting && "quantity" in data)) {
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
