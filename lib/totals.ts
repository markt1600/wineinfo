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
  // SGD always renders as "S$" — some locales show a bare "$" for it, which
  // is indistinguishable from USD when both appear on screen.
  if (currency === "SGD") {
    return `S$${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount)}`;
  }
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

// One figure, in SGD: "S$1,371" when everything was already SGD,
// "≈ S$1,371" when FX conversion was involved. Falls back to a
// per-currency breakdown only when some currency has no known rate.
export function formatTotals(totals: Map<string, number>): string | null {
  if (totals.size === 0) return null;
  if (totals.size === 1 && totals.has("SGD")) {
    return formatMoney(totals.get("SGD")!, "SGD");
  }
  const sgd = totalsInSGD(totals);
  if (sgd) return `≈ ${formatMoney(sgd, "SGD")}`;
  return [...totals.entries()]
    .map(([cur, amt]) => formatMoney(amt, cur))
    .join(" + ");
}

// How many bottles actually contributed to the totals — surfaced next to
// the total so partial research coverage is visible instead of silent.
export function pricedBottleCount(result: AnalysisResult): number {
  return result.bottles.filter(
    (b) => b.marketPrice && b.marketPrice.currency !== "UNK"
  ).length;
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
