import type { AnalysisResult } from "@/lib/schema";

// Sums market prices per currency (photos rarely mix currencies, but be safe).
export function marketTotals(result: AnalysisResult): Map<string, number> {
  const totals = new Map<string, number>();
  for (const b of result.bottles) {
    if (b.marketPrice && b.marketPrice.currency !== "UNK") {
      totals.set(
        b.marketPrice.currency,
        (totals.get(b.marketPrice.currency) ?? 0) + b.marketPrice.amount
      );
    }
  }
  return totals;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

// "$1,234" or "$900 + €120" when currencies are mixed
export function formatTotals(totals: Map<string, number>): string | null {
  if (totals.size === 0) return null;
  return [...totals.entries()]
    .map(([cur, amt]) => formatMoney(amt, cur))
    .join(" + ");
}
