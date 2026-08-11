"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Money, Rating } from "@/lib/schema";
import { formatMoney } from "@/lib/totals";

// Mirrors lib/venueStore.ts (client-safe copies of the types).
interface VenueWine {
  producer: string | null;
  wineName: string | null;
  vintage: string | null;
  region: string | null;
  wineType: string | null;
  bottleSizeML: number | null;
  listedPrice: Money | null;
  marketPrice: Money | null;
  marketPriceSource: string | null;
  priceDeltaPct: number | null;
  ratings: Rating[];
  seenAt: string;
}
interface VenueMenuPhoto {
  url: string;
  scanId?: string;
  at: string;
}
interface VenueRecord {
  slug: string;
  name: string;
  wines: VenueWine[];
  menuPhotos: VenueMenuPhoto[];
  updatedAt: string;
}
interface VenueSummary {
  slug: string;
  name: string;
  wineCount: number;
  photoCount: number;
  updatedAt: string;
}

const STALE_MS = 183 * 24 * 60 * 60 * 1000; // ~6 months

function isStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > STALE_MS;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function wineName(w: VenueWine): string {
  return (
    [w.producer, w.wineName, w.vintage].filter(Boolean).join(" ") ||
    "Unknown wine"
  );
}

type TypeBucket = "Red" | "White" | "Sparkling" | "Rosé" | "Other";

function typeBucket(t: string | null): TypeBucket {
  const s = (t ?? "").toLowerCase();
  if (/champ|spark|cava|prosecco|crémant|cremant|sekt/.test(s))
    return "Sparkling";
  if (/rosé|rose/.test(s)) return "Rosé";
  if (/red|rouge|tinto|rosso/.test(s)) return "Red";
  if (/white|blanc|bianco|weiss/.test(s)) return "White";
  return "Other";
}

// Normalizes a rating score to a 0–100 scale so different sources can be
// ranked together: "4.2/5" → 84, "92" → 92, "18/20" → 90.
function ratingValue(r: Rating): number | null {
  const frac = r.score.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (frac) {
    const v = parseFloat(frac[1]);
    const d = parseFloat(frac[2]);
    if (d > 0 && Number.isFinite(v)) return Math.min((v / d) * 100, 100);
  }
  const v = parseFloat(r.score);
  if (!Number.isFinite(v)) return null;
  if (v <= 5) return (v / 5) * 100;
  if (v <= 20) return (v / 20) * 100;
  return Math.min(v, 100);
}

function bestRating(w: VenueWine): { r: Rating; value: number } | null {
  let best: { r: Rating; value: number } | null = null;
  for (const r of w.ratings) {
    const value = ratingValue(r);
    if (value != null && (!best || value > best.value)) best = { r, value };
  }
  return best;
}

const PRICE_BUCKETS = [
  { key: "any", label: "Any price", min: 0, max: Infinity },
  { key: "lt100", label: "< 100", min: 0, max: 100 },
  { key: "100-500", label: "100 – 500", min: 100, max: 500 },
  { key: "500-1000", label: "500 – 1,000", min: 500, max: 1000 },
] as const;

const TYPE_FILTERS: ("All" | TypeBucket)[] = [
  "All",
  "Red",
  "White",
  "Sparkling",
  "Rosé",
];

const SORT_OPTIONS = [
  { key: "default", label: "Default" },
  { key: "price", label: "Price" },
  { key: "delta", label: "Markup / discount" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["key"];
type SortDir = "asc" | "desc";

function DeltaLabel({ pct }: { pct: number }) {
  if (Math.abs(pct) < 1)
    return <span style={{ color: "var(--muted)" }}>≈ market</span>;
  const markup = pct > 0;
  return (
    <span style={{ color: markup ? "#d70015" : "#248a3d", fontWeight: 600 }}>
      {markup ? `+${Math.round(pct)}%` : `−${Math.round(Math.abs(pct))}%`} vs
      market
    </span>
  );
}

function WineRow({ w, badge }: { w: VenueWine; badge?: string }) {
  const rating = bestRating(w);
  const dated = isStale(`${w.seenAt}T12:00:00.000Z`);
  return (
    <div className="venue-wine">
      <div className="venue-wine-name">
        {badge && <span className="venue-badge">{badge}</span>}
        {wineName(w)}
        {w.bottleSizeML != null && w.bottleSizeML !== 750 && (
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            {" "}
            · {w.bottleSizeML >= 1000 ? `${w.bottleSizeML / 1000}L` : `${w.bottleSizeML}mL`}
          </span>
        )}
        {dated && (
          <span
            className="venue-stale"
            title={`Last seen ${dateLabel(`${w.seenAt}T12:00:00.000Z`)} — may be outdated`}
          >
            ⚠️ dated
          </span>
        )}
      </div>
      <div className="venue-wine-info">
        {[
          typeBucket(w.wineType) !== "Other" ? typeBucket(w.wineType) : w.wineType,
          w.region,
          rating ? `${rating.r.source} ${rating.r.score}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="venue-wine-price">
        {w.listedPrice && (
          <strong>
            {formatMoney(w.listedPrice.amount, w.listedPrice.currency)}
          </strong>
        )}
        {w.marketPrice && (
          <span style={{ color: "var(--muted)" }}>
            {" "}
            (mkt {formatMoney(w.marketPrice.amount, w.marketPrice.currency)})
          </span>
        )}
        {w.priceDeltaPct != null && (
          <>
            {" · "}
            <DeltaLabel pct={w.priceDeltaPct} />
          </>
        )}
      </div>
    </div>
  );
}

function VenueDetail({ slug }: { slug: string }) {
  const router = useRouter();
  const [venue, setVenue] = useState<VenueRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TYPE_FILTERS)[number]>("All");
  const [price, setPrice] =
    useState<(typeof PRICE_BUCKETS)[number]["key"]>("any");
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/venues?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? "Load failed");
        return r.json();
      })
      .then((d) => !cancelled && setVenue(d.venue as VenueRecord))
      .catch((e) => !cancelled && setError(e?.message ?? "Load failed"));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const topValue = useMemo(
    () =>
      venue
        ? [...venue.wines]
            .filter((w) => w.priceDeltaPct != null)
            .sort((a, b) => a.priceDeltaPct! - b.priceDeltaPct!)
            .slice(0, 5)
        : [],
    [venue]
  );
  const topRated = useMemo(
    () =>
      venue
        ? venue.wines
            .map((w) => ({ w, best: bestRating(w) }))
            .filter((x) => x.best != null)
            .sort((a, b) => b.best!.value - a.best!.value)
            .slice(0, 5)
            .map((x) => x.w)
        : [],
    [venue]
  );
  const filtered = useMemo(() => {
    if (!venue) return [];
    const bucket = PRICE_BUCKETS.find((b) => b.key === price)!;
    const rows = venue.wines.filter((w) => {
      if (type !== "All" && typeBucket(w.wineType) !== type) return false;
      if (bucket.key !== "any") {
        const amount = w.listedPrice?.amount;
        if (amount == null) return false;
        if (amount >= bucket.max || amount < bucket.min) return false;
      }
      return true;
    });
    if (sortBy === "default") return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const value = (w: VenueWine): number | null =>
      sortBy === "price" ? (w.listedPrice?.amount ?? null) : w.priceDeltaPct;
    // Wines missing the sorted field always sink to the bottom, in either direction.
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [venue, type, price, sortBy, sortDir]);

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push("/restaurants");
  };

  if (error) {
    return (
      <div className="card">
        <p style={{ color: "var(--muted)" }}>
          {error} <Link href="/restaurants">All restaurants</Link>
        </p>
      </div>
    );
  }
  if (!venue) {
    return (
      <div className="card">
        <div className="status">
          <div className="spinner" />
          Loading wine list…
        </div>
      </div>
    );
  }

  const stale = isStale(venue.updatedAt);

  return (
    <>
      <button className="btn secondary" onClick={back}>
        ← All restaurants
      </button>

      <div className="card">
        <h2 style={{ fontSize: "1.25rem", marginBottom: 4 }}>
          📍 {venue.name}
        </h2>
        <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
          {venue.wines.length} wine{venue.wines.length === 1 ? "" : "s"} ·
          menu info from {dateLabel(venue.updatedAt)}
        </p>
        {stale && (
          <div className="venue-stale-banner">
            ⚠️ This menu information is more than 6 months old — selection
            and prices may have changed.
          </div>
        )}
      </div>

      {venue.menuPhotos.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 10 }}>
            📷 Menu photos
          </h3>
          <div className="venue-photos">
            {venue.menuPhotos.map((p) =>
              p.scanId ? (
                <Link
                  key={p.url}
                  href={`/scan?id=${encodeURIComponent(p.scanId)}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Menu from ${dateLabel(p.at)}`} />
                </Link>
              ) : (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Menu from ${dateLabel(p.at)}`} />
                </a>
              )
            )}
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 8 }}>
            Tap a photo to open the full scanned menu analysis.
          </p>
        </div>
      )}

      {topValue.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 6 }}>
            🏆 Top value{topValue.length > 1 ? ` (${topValue.length})` : ""}
          </h3>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 8 }}>
            Ranked by listed price vs typical market price.
          </p>
          {topValue.map((w, i) => (
            <WineRow key={`v${i}`} w={w} badge={`#${i + 1}`} />
          ))}
        </div>
      )}

      {topRated.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 6 }}>
            ⭐ Top rated{topRated.length > 1 ? ` (${topRated.length})` : ""}
          </h3>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 8 }}>
            Ranked by Vivino / CellarTracker / critic scores.
          </p>
          {topRated.map((w, i) => (
            <WineRow key={`r${i}`} w={w} badge={`#${i + 1}`} />
          ))}
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: "1rem", marginBottom: 10 }}>
          🍷 All wines ({filtered.length}
          {filtered.length !== venue.wines.length
            ? ` of ${venue.wines.length}`
            : ""}
          )
        </h3>
        <div className="venue-filters">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              className={`chip${type === t ? " active" : ""}`}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="venue-filters">
          {PRICE_BUCKETS.map((b) => (
            <button
              key={b.key}
              className={`chip${price === b.key ? " active" : ""}`}
              onClick={() => setPrice(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="venue-filters">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              className={`chip${sortBy === s.key ? " active" : ""}`}
              onClick={() =>
                setSortBy((prev) => {
                  // Tapping the already-active sort flips its direction
                  // instead of doing nothing.
                  if (prev === s.key && s.key !== "default") {
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  } else {
                    setSortDir("asc");
                  }
                  return s.key;
                })
              }
            >
              {s.label}
              {sortBy === s.key && s.key !== "default" && (
                <span aria-hidden="true">
                  {" "}
                  {sortDir === "asc" ? "↑" : "↓"}
                </span>
              )}
            </button>
          ))}
          {sortBy !== "default" && (
            <button
              className="chip"
              onClick={() =>
                setSortDir((d) => (d === "asc" ? "desc" : "asc"))
              }
              aria-label={
                sortDir === "asc"
                  ? "Sort descending instead"
                  : "Sort ascending instead"
              }
            >
              {sortDir === "asc" ? "Low → High" : "High → Low"}
            </button>
          )}
        </div>
        {filtered.length === 0 && (
          <p style={{ color: "var(--muted)" }}>
            No wines match these filters.
          </p>
        )}
        {filtered.map((w, i) => (
          <WineRow key={i} w={w} />
        ))}
      </div>
    </>
  );
}

function VenueList() {
  const [venues, setVenues] = useState<VenueSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/venues")
      .then((r) => r.json())
      .then((d) => setVenues(Array.isArray(d.venues) ? d.venues : []))
      .catch(() => setVenues([]));
  }, []);

  if (venues === null) {
    return (
      <div className="card">
        <div className="status">
          <div className="spinner" />
          Loading restaurants…
        </div>
      </div>
    );
  }
  if (venues.length === 0) {
    return (
      <div className="card">
        <p style={{ color: "var(--muted)" }}>
          No restaurants yet. Scan a wine menu (and set the venue in ✏️ Edit
          results if it isn&apos;t detected automatically) and it will show
          up here with its full wine list.
        </p>
      </div>
    );
  }
  return (
    <div className="card">
      {venues.map((v) => (
        <Link
          key={v.slug}
          href={`/restaurants?v=${encodeURIComponent(v.slug)}`}
          className="venue-row"
        >
          <span className="venue-row-icon">🍽️</span>
          <span className="venue-row-text">
            <strong>{v.name}</strong>
            <em>
              {v.wineCount} wine{v.wineCount === 1 ? "" : "s"}
              {v.photoCount > 0 &&
                ` · ${v.photoCount} menu photo${v.photoCount === 1 ? "" : "s"}`}{" "}
              · updated {dateLabel(v.updatedAt)}
              {isStale(v.updatedAt) && " ⚠️"}
            </em>
          </span>
          <span className="my-chevron">›</span>
        </Link>
      ))}
    </div>
  );
}

function RestaurantsView() {
  const params = useSearchParams();
  const slug = params.get("v");

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
        </h1>
        <p>
          Restaurant wine lists — assembled from scanned menus, with market
          prices and ratings for every wine.
        </p>
      </header>
      {slug ? <VenueDetail slug={slug} /> : <VenueList />}
    </main>
  );
}

export default function RestaurantsPage() {
  return (
    <Suspense fallback={<main />}>
      <RestaurantsView />
    </Suspense>
  );
}
