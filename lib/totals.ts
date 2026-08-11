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

// Feed caption: "Opus One 2019, Caymus 2021 +2 more · $412 at market"
export function buildScanCaption(result: AnalysisResult): string {
  const names = result.bottles
    .filter((b) => b.identified)
    .map((b) => [b.producer, b.wineName, b.vintage].filter(Boolean).join(" "))
    .filter(Boolean);
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const nameStr =
    shown.length > 0
      ? shown.join(", ") + (more > 0 ? ` +${more} more` : "")
      : `${result.bottles.length} wine${result.bottles.length === 1 ? "" : "s"}`;
  const totalStr = formatTotals(marketTotals(result));
  return totalStr ? `${nameStr} · ${totalStr} at market` : nameStr;
}
