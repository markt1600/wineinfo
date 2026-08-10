"use client";

import AnnotatedImage from "@/components/AnnotatedImage";
import InfographicCard from "@/components/InfographicCard";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { formatTotals, marketTotals } from "@/lib/totals";

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
              {bottle.marketPriceSource && (
                <span style={{ color: "var(--muted)" }}>
                  {" "}
                  ({bottle.marketPriceSource})
                </span>
              )}
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
    </div>
  );
}

interface Props {
  imageDataUrl: string;
  result: AnalysisResult;
  replay?: boolean; // true when re-displaying a saved scan (no re-save)
  onSaved?: () => void;
  afterImage?: React.ReactNode; // e.g. the currency-confirmation card
}

// The full analysis display: annotated photo, summary + totals, per-bottle
// details, and the shareable summary card. Used for fresh analyses and for
// replaying saved scans.
export default function ResultsView({
  imageDataUrl,
  result,
  replay = false,
  onSaved,
  afterImage,
}: Props) {
  const bestValueId = result.bestValue.bottleId ?? null;
  const totalStr = formatTotals(marketTotals(result));

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
              Total value at market price:
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
          <p style={{ color: "var(--muted)" }}>
            No wine bottles or menu entries were found in this photo.
          </p>
        )}
      </div>

      {result.bottles.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: 12 }}>
            📱 Shareable summary
          </h2>
          <InfographicCard
            key={imageDataUrl}
            imageDataUrl={imageDataUrl}
            result={result}
            bestValueId={bestValueId}
            autoSave={!replay}
            onSaved={onSaved}
          />
        </div>
      )}
    </>
  );
}
