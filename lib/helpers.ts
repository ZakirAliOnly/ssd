export function formatNumber(n: number): string {
  return n.toLocaleString("en-PK");
}

export function formatCurrency(n: number): string {
  return "Rs " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function formatDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
