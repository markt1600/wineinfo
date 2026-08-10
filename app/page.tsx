"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Gallery from "@/components/Gallery";
import ResultsView from "@/components/ResultsView";
import type { AnalysisResult } from "@/lib/schema";

const MAX_EDGE = 2576; // Claude's high-res vision limit (long edge)
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

export default function Home() {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currencyPick, setCurrencyPick] = useState("USD");
  const [galleryRefresh, setGalleryRefresh] = useState(0);

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

  const currencyCard = needsCurrency ? (
    <div className="card">
      <p style={{ marginBottom: 4 }}>
        💱 I found prices but couldn&apos;t determine the currency. What
        currency are these prices in?
      </p>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        {result?.currency.reasoning}
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
  ) : null;

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
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

      {prepared && !result && (
        <div className="card preview">
          <img src={prepared.dataUrl} alt="Your photo" />
        </div>
      )}

      {result && prepared && (
        <ResultsView
          imageDataUrl={prepared.dataUrl}
          result={result}
          afterImage={currencyCard}
          onSaved={() => setGalleryRefresh((n) => n + 1)}
        />
      )}

      <Gallery refreshKey={galleryRefresh} limit={5} showViewAll />

      <p className="footer-links">
        <Link href="/admin">Admin</Link>
      </p>
    </main>
  );
}
