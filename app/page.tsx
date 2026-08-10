"use client";

import { useRef, useState } from "react";
import AnnotatedImage from "@/components/AnnotatedImage";
import InfographicCard from "@/components/InfographicCard";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { formatTotals, marketTotals } from "@/lib/totals";

const MAX_EDGE = 2576; // Fable 5's high-res vision limit (long edge)
const MAX_BASE64_BYTES = 3.6 * 1024 * 1024; // stay under serverless body limits

const CURRENCIES = [
  "USD", "EUR", "GBP", "AUD", "CAD", "NZD", "CHF", "JPY", "CNY", "HKD",
  "SGD", "ZAR", "ARS", "CLP", "BRL", "MXN", "SEK", "NOK", "DKK", "PLN",
];

interface Prepared {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  dataUrl: string;
}

async function prepareImage(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Re-encode, stepping quality down until the payload fits.
  let quality = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MAX_BASE64_BYTES && quality > 0.4) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return {
    base64: dataUrl.split(",")[1],
    mediaType: "image/jpeg",
    width,
    height,
    dataUrl,
  };
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

export default function Home() {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currencyPick, setCurrencyPick] = useState("USD");

  const analyze = async (img: Prepared, currencyHint?: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setStatus("Uploading photo…");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: img.base64,
          mediaType: img.mediaType,
          width: img.width,
          height: img.height,
          currencyHint,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Server error (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          if (msg.type === "status") setStatus(msg.message);
          else if (msg.type === "result") {
            setResult(msg.data as AnalysisResult);
            setStatus(null);
          } else if (msg.type === "error") {
            setError(msg.message);
            setStatus(null);
          }
        }
      }
      setStatus((s) => (s ? null : s));
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const img = await prepareImage(file);
      setPrepared(img);
      await analyze(img);
    } catch (err: any) {
      setError(err?.message || "Could not read that photo.");
    }
  };

  const needsCurrency = !!result?.currency.needsUserInput;
  const bestValueId = result?.bestValue.bottleId ?? null;

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>Lens</span>
        </h1>
        <p>
          Snap a bottle, a shelf, or a wine menu. Get identifications, prices,
          ratings — and the best value.
        </p>
      </header>

      {/* capture="environment" opens the camera directly on phones… */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFile}
      />
      {/* …no capture attribute lets the user pick from their photo library */}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFile}
      />

      <div className="card">
        <button
          className="btn"
          disabled={busy}
          onClick={() => cameraInputRef.current?.click()}
        >
          📷 {prepared ? "Take another photo" : "Take a photo"}
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => libraryInputRef.current?.click()}
        >
          🖼️ Choose from library
        </button>
        {busy && (
          <div className="status">
            <div className="spinner" />
            {status ?? "Working…"}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {prepared && !result && !busy && !error && (
        <div className="card preview">
          <img src={prepared.dataUrl} alt="Your photo" />
        </div>
      )}

      {prepared && busy && (
        <div className="card preview">
          <img src={prepared.dataUrl} alt="Your photo" />
        </div>
      )}

      {result && prepared && (
        <>
          <div className="card">
            <AnnotatedImage
              imageDataUrl={prepared.dataUrl}
              result={result}
              bestValueId={bestValueId}
            />
          </div>

          {needsCurrency && (
            <div className="card">
              <p style={{ marginBottom: 4 }}>
                💱 I found prices but couldn&apos;t determine the currency.
                What currency are these prices in?
              </p>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {result.currency.reasoning}
              </p>
              <select
                className="currency"
                value={currencyPick}
                onChange={(e) => setCurrencyPick(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                disabled={busy}
                onClick={() => prepared && analyze(prepared, currencyPick)}
              >
                Re-analyze with {currencyPick}
              </button>
            </div>
          )}

          <div className="card">
            <p className="summary">{result.summary}</p>
            {bestValueId && (
              <div className="best-banner">
                <strong>★ Best value: {bestValueId}</strong> —{" "}
                {result.bestValue.reasoning}
              </div>
            )}
            {formatTotals(marketTotals(result)) && (
              <div className="best-banner" style={{ borderColor: "var(--border)" }}>
                <strong style={{ color: "var(--text)" }}>
                  Total value at market price:
                </strong>{" "}
                {formatTotals(marketTotals(result))}
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
                imageDataUrl={prepared.dataUrl}
                result={result}
                bestValueId={bestValueId}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}
