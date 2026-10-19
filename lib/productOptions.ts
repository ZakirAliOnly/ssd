/** Consistent catalogue labels for invoice product selectors. */
export function invoiceProductOption(product: { id: string; name: string; code?: string | null; description?: string | null }) {
  const description = product.description?.trim();
  return {
    value: product.id,
    searchText: product.name + " " + (product.code ?? ""),
    label: description ? product.name + " ? " + description : product.name,
  };
}
