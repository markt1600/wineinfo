"use client";

import AnnotatedImage from "@/components/AnnotatedImage";
import EditResults, { type ReviseEdit } from "@/components/EditResults";
import InfographicCard from "@/components/InfographicCard";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { formatTotals, marketTotals } from "@/lib/totals";

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
  onRevise?: (edits: ReviseEdit[], newEventDate?: string) => Promise<void>;
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
            key={`${imageDataUrl}:${revision}:${saveMode}`}
            imageDataUrl={imageDataUrl}
            result={result}
            bestValueId={bestValueId}
            saveMode={saveMode}
            scanId={scanId}
            onSaved={onSaved}
          />
        </div>
      )}
    </>
  );
}
