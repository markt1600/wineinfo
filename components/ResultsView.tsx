"use client";

import { useMemo } from "react";
import AnnotatedImage from "@/components/AnnotatedImage";
import EditResults, { type ReviseEdit } from "@/components/EditResults";
import InfographicCard from "@/components/InfographicCard";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { formatTotals, marketTotals, pricedBottleCount } from "@/lib/totals";

// Shown when a photo contains no wine at all — one is picked at random
// per analysis so repeat offenders get fresh material.
const NO_WINE_JOKES = [
  "Did you drink too much? There's no wine in this picture. 🍷",
  "Not a single bottle found. Time to open one? 🍾",
  "Zero bottles detected. Is the cellar… empty? 😱",
  "I looked everywhere. No wine. This is a personal tragedy. 😢",
  "No wine detected — blink twice if you need directions to a wine shop. 🧭",
  "A wine-free photo? Bold choice for a wine app. 🤨",
  "No bottles found. On the bright side: zero calories. ✨",
  "My sommelier senses detect… absolutely nothing. Hydrate, then try again. 🕵️",
];

function sizeLabel(ml: number): string {
  if (ml === 375) return "375 mL (half)";
  if (ml === 1500) return "1.5 L (magnum)";
  if (ml === 3000) return "3 L (double magnum)";
  return `${ml} mL`;
}

function money(m: { amount: number; currency: string } | null): string | null {
  if (!m) return null;
  if (m.currency === "UNK") return `${m.amount} (currency unconfirmed)`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: m.currency,
    }).format(m.amount);
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}

// +40 → red markup, −15 → green discount, within ±1% → neutral
function DeltaBadge({ pct }: { pct: number }) {
  if (Math.abs(pct) < 1) {
    return <span style={{ color: "var(--muted)" }}>≈ market price</span>;
  }
  const markup = pct > 0;
  return (
    <span
      style={{
        color: markup ? "#d70015" : "#248a3d",
        fontWeight: 600,
      }}
    >
      {markup
        ? `+${Math.round(pct)}% above market`
        : `−${Math.round(Math.abs(pct))}% below market`}
    </span>
  );
}

function RatingRow({ r }: { r: BottleResult["ratings"][number] }) {
  const score = (
    <>
      {r.score}
      {!r.vintageMatch && (
        <span style={{ color: "var(--muted)" }}> (different/any vintage)</span>
      )}
    </>
  );
  return (
    <>
      <dt>{r.source}</dt>
      <dd>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{score}</a> : score}</dd>
    </>
  );
}

function BottleCard({
  bottle,
  isBest,
}: {
  bottle: BottleResult;
  isBest: boolean;
}) {
  const name =
    [bottle.producer, bottle.wineName, bottle.vintage]
      .filter(Boolean)
      .join(" ") ||
    bottle.labelText ||
    "Unknown bottle";

  return (
    <div className="bottle">
      <h3>
        <span style={{ color: "var(--muted)" }}>{bottle.id}</span> {name}{" "}
        <span
          className={`tag ${bottle.identified ? "identified" : "unidentified"}`}
        >
          {bottle.identified ? "Identified" : "Unidentified"}
        </span>
        {isBest && <span className="tag best">★ Best value</span>}
      </h3>
      <dl>
        {bottle.region && (
          <>
            <dt>Region</dt>
            <dd>{bottle.region}</dd>
          </>
        )}
        {bottle.grapeVariety && (
          <>
            <dt>Grapes</dt>
            <dd>{bottle.grapeVariety}</dd>
          </>
        )}
        {bottle.wineType && (
          <>
            <dt>Type</dt>
            <dd>{bottle.wineType}</dd>
          </>
        )}
        {bottle.bottleSizeML != null && bottle.bottleSizeML !== 750 && (
          <>
            <dt>Size</dt>
            <dd>{sizeLabel(bottle.bottleSizeML)}</dd>
          </>
        )}
        {bottle.listedPrice && (
          <>
            <dt>Listed price</dt>
            <dd>{money(bottle.listedPrice)}</dd>
          </>
        )}
        {bottle.marketPrice && (
          <>
            <dt>Market price</dt>
            <dd>
              {money(bottle.marketPrice)}
              {bottle.marketPriceEstimated && (
                <span style={{ color: "var(--gold)", fontWeight: 600 }}> *</span>
              )}
              {bottle.marketPriceSource && (
                <span style={{ color: "var(--muted)" }}>
                  {" "}
                  ({bottle.marketPriceSource})
                </span>
              )}
            </dd>
          </>
        )}
        {bottle.priceDeltaPct != null && (
          <>
            <dt>Vs market</dt>
            <dd>
              <DeltaBadge pct={bottle.priceDeltaPct} />
            </dd>
          </>
        )}
        {bottle.ratings.map((r, i) => (
          <RatingRow key={i} r={r} />
        ))}
        {bottle.valueAssessment && (
          <>
            <dt>Value</dt>
            <dd>{bottle.valueAssessment}</dd>
          </>
        )}
      </dl>
      {bottle.notes && <p className="notes">{bottle.notes}</p>}
      {bottle.tastingNotes && (
        <p
          className="notes"
          style={{
            borderLeft: "3px solid var(--accent)",
            paddingLeft: 10,
            fontStyle: "italic",
          }}
        >
          📝 {bottle.tastingNotes}
        </p>
      )}
    </div>
  );
}

interface Props {
  imageDataUrl: string;
  result: AnalysisResult;
  saveMode?: "new" | "replace" | "off";
  scanId?: string | null;
  revision?: number; // bumps after an edit → summary card regenerates + re-saves
  eventDate?: string | null; // enables the consumption-date editor (Consumed scans)
  onSaved?: (id: string | null) => void;
  onRevise?: (
    edits: ReviseEdit[],
    newEventDate?: string,
    newVenue?: string
  ) => Promise<void>;
  afterImage?: React.ReactNode; // e.g. the currency-confirmation card
}

// The full analysis display: annotated photo, summary + totals, per-bottle
// details, the edit tab, and the shareable summary card. Used for fresh
// analyses and for replaying saved scans.
export default function ResultsView({
  imageDataUrl,
  result,
  saveMode = "new",
  scanId = null,
  revision = 0,
  eventDate,
  onSaved,
  onRevise,
  afterImage,
}: Props) {
  const bestValueId = result.bestValue.bottleId ?? null;
  const totalStr = formatTotals(marketTotals(result));
  const pricedN = pricedBottleCount(result);
  const identifiedN = result.bottles.filter((b) => b.identified).length;
  // Scans with zero identified bottles never enter history — the card can
  // still be viewed and downloaded, it just isn't saved. In-place updates
  // of an already-saved scan ("replace") are unaffected.
  const hasIdentified = result.bottles.some((b) => b.identified);
  const effectiveSaveMode =
    saveMode === "new" && !hasIdentified ? "off" : saveMode;
  // Stable per analysis (re-picks only when the result object changes).
  const noWineJoke = useMemo(
    () => NO_WINE_JOKES[Math.floor(Math.random() * NO_WINE_JOKES.length)],
    [result]
  );

  return (
    <>
      <div className="card">
        <AnnotatedImage
          imageDataUrl={imageDataUrl}
          result={result}
          bestValueId={bestValueId}
        />
      </div>

      {afterImage}

      <div className="card">
        {result.venue && (
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            📍 {result.venue}
          </p>
        )}
        <p className="summary">{result.summary}</p>
        {bestValueId && (
          <div className="best-banner">
            <strong>★ Best value: {bestValueId}</strong> —{" "}
            {result.bestValue.reasoning}
          </div>
        )}
        {totalStr && (
          <div className="best-banner" style={{ borderColor: "var(--border)" }}>
            <strong style={{ color: "var(--text)" }}>
              Total value at market price
              {pricedN < identifiedN
                ? ` (${pricedN} of ${identifiedN} wines)`
                : ` (${pricedN} wine${pricedN === 1 ? "" : "s"})`}
              :
            </strong>{" "}
            {totalStr}
          </div>
        )}
      </div>

      <div className="card">
        {result.bottles.map((b) => (
          <BottleCard key={b.id} bottle={b} isBest={b.id === bestValueId} />
        ))}
        {result.bottles.length === 0 && (
          <div style={{ textAlign: "center", padding: "14px 0" }}>
            <p style={{ fontSize: "2.2rem", marginBottom: 8 }}>🫗</p>
            <p style={{ fontWeight: 600, marginBottom: 6 }}>
              No wine bottles or menu entries found in this photo.
            </p>
            <p style={{ color: "var(--muted)" }}>{noWineJoke}</p>
          </div>
        )}
        {result.bottles.some((b) => b.marketPriceEstimated) && (
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 10 }}>
            * price estimated by scaling from another bottle size
          </p>
        )}
      </div>

      {onRevise && (
        <EditResults
          key={`edit:${revision}:${eventDate ?? ""}`}
          result={result}
          eventDate={eventDate}
          onConfirm={onRevise}
        />
      )}

      {result.bottles.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: 12 }}>
            📱 Shareable summary
          </h2>
          <InfographicCard
            key={`${imageDataUrl}:${revision}:${effectiveSaveMode}`}
            imageDataUrl={imageDataUrl}
            result={result}
            bestValueId={bestValueId}
            saveMode={effectiveSaveMode}
            scanId={scanId}
            onSaved={onSaved}
          />
        </div>
      )}
    </>
  );
}
