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

// Approximate FX to SGD (Aug 2026), only for the at-a-glance aggregate —
// per-wine prices always keep their sourced currency. Refresh occasionally.
const SGD_RATES: Record<string, number> = {
  SGD: 1, USD: 1.28, EUR: 1.49, GBP: 1.72, HKD: 0.165, JPY: 0.0087,
  AUD: 0.84, NZD: 0.77, CAD: 0.93, CHF: 1.6, CNY: 0.18, KRW: 0.00095,
  TWD: 0.043, THB: 0.0395, MYR: 0.3, IDR: 0.000078,
};

// The app's home market is Singapore, so an all-in SGD figure is worth
// showing whenever the totals aren't already purely SGD. Null when any
// currency in the map has no known rate (a partial sum would mislead).
export function totalsInSGD(totals: Map<string, number>): number | null {
  if (totals.size === 0) return null;
  let sum = 0;
  for (const [cur, amt] of totals) {
    const rate = SGD_RATES[cur];
    if (!rate) return null;
    sum += amt * rate;
  }
  return sum;
}

// "$1,234" or "$900 + €120" when currencies are mixed; appends an
// approximate SGD aggregate ("US$900 + €120 (≈ S$2,331)") unless the
// totals are already entirely SGD.
export function formatTotals(totals: Map<string, number>): string | null {
  if (totals.size === 0) return null;
  const parts = [...totals.entries()]
    .map(([cur, amt]) => formatMoney(amt, cur))
    .join(" + ");
  const onlySGD = totals.size === 1 && totals.has("SGD");
  if (onlySGD) return parts;
  const sgd = totalsInSGD(totals);
  return sgd ? `${parts} (≈ ${formatMoney(sgd, "SGD")})` : parts;
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
