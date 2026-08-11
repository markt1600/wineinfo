"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Gallery from "@/components/Gallery";
import ResultsView from "@/components/ResultsView";
import type { ReviseEdit } from "@/components/EditResults";
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
  // Original capture kept at full quality so a fresh camera shot can be
  // saved to the device when analysis starts.
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [photoSource, setPhotoSource] = useState<"camera" | "library">(
    "library"
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currencyPick, setCurrencyPick] = useState("USD");
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Set when the pre-check found prices but couldn't pin down the currency —
  // holds the model's reasoning; the user answers before research starts.
  const [currencyRequest, setCurrencyRequest] = useState<string | null>(null);
  const [savedScanId, setSavedScanId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [eventDate, setEventDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  // The Admin footer link is only shown to the deployment owner's login.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(!!d?.isAdmin))
      .catch(() => {});
  }, []);

  // Fresh camera captures aren't kept by the browser, so save a copy to the
  // device when the user commits to analyzing. (Browsers can't write to the
  // photo library directly; this downloads the full-quality original.)
  const saveCaptureToDevice = (file: File) => {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
        d.getDate()
      )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const ext = file.type === "image/png" ? "png" : "jpg";
      a.href = url;
      a.download = `wine-aid-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Best-effort — never block the analysis over a failed save.
    }
  };

  const analyze = async (img: Prepared, currencyHint?: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setAwaitingConfirm(false);
    setCurrencyRequest(null);
    setSavedScanId(null);
    setRevision(0);
    setEventDate(new Date().toISOString().slice(0, 10));
    setProgress(0);
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
          else if (msg.type === "progress") setProgress(msg.pct);
          else if (msg.type === "needs_currency") {
            setCurrencyRequest(msg.reasoning ?? "");
            setStatus(null);
            setProgress(null);
          } else if (msg.type === "result") {
            setResult(msg.data as AnalysisResult);
            // Server already saved the scan; the card render upgrades it.
            if (msg.scanId) setSavedScanId(msg.scanId);
            setStatus(null);
            setProgress(null);
          } else if (msg.type === "error") {
            setError(msg.message);
            setStatus(null);
            setProgress(null);
          }
        }
      }
      setStatus((s) => (s ? null : s));
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
      setStatus(null);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  // Selecting a photo only shows a preview — analysis starts after the
  // user confirms.
  const onFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    source: "camera" | "library"
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const img = await prepareImage(file);
      setPrepared(img);
      setOriginalFile(file);
      setPhotoSource(source);
      setAwaitingConfirm(true);
    } catch (err: any) {
      setError(err?.message || "Could not read that photo.");
    }
  };

  const cancelPhoto = () => {
    setPrepared(null);
    setOriginalFile(null);
    setAwaitingConfirm(false);
    setCurrencyRequest(null);
  };

  const needsCurrency = !!result?.currency.needsUserInput;
  const hasListedPrices = !!result?.bottles.some((b) => b.listedPrice);

  const currencyPicker = (label: string) => (
    <>
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
        {label} {currencyPick}
      </button>
    </>
  );

  // Always be transparent about the currency: ask when it couldn't be
  // determined, otherwise state the assumption with a one-tap override.
  const currencyCard = !result || !hasListedPrices ? null : needsCurrency ? (
    <div className="card">
      <p style={{ marginBottom: 4 }}>
        💱 I found prices but couldn&apos;t determine the currency. What
        currency are these prices in?
      </p>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        {result.currency.reasoning}
      </p>
      {currencyPicker("Re-analyze with")}
    </div>
  ) : result.currency.code ? (
    <div className="card">
      <p style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
        💱 Prices interpreted as{" "}
        <strong style={{ color: "var(--text)" }}>{result.currency.code}</strong>
        {result.currency.reasoning && ` — ${result.currency.reasoning}`}
      </p>
      <details style={{ marginTop: 8 }}>
        <summary
          style={{
            color: "var(--accent)",
            fontSize: "0.88rem",
            cursor: "pointer",
          }}
        >
          Wrong currency? Change it
        </summary>
        {currencyPicker("Re-analyze with")}
      </details>
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
        onChange={(e) => onFile(e, "camera")}
      />
      {/* …no capture attribute lets the user pick from their photo library */}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onFile(e, "library")}
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{status ?? "Working…"}</div>
              {progress != null && (
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
            {progress != null && (
              <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                ~{progress}%
              </span>
            )}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {prepared && currencyRequest !== null && !result && !busy && (
        <div className="card">
          <p style={{ marginBottom: 4 }}>
            💱 This photo shows prices, but the currency isn&apos;t obvious.
            What currency are they in?
          </p>
          {currencyRequest && (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {currencyRequest}
            </p>
          )}
          {currencyPicker("Start analysis with")}
          <button className="btn secondary" onClick={cancelPhoto}>
            ✖️ Cancel
          </button>
        </div>
      )}

      {prepared && !result && (
        <div className="card preview">
          <img src={prepared.dataUrl} alt="Your photo" />
          {awaitingConfirm && !busy && (
            <>
              <button
                className="btn"
                style={{ marginTop: 12 }}
                onClick={() => {
                  if (photoSource === "camera" && originalFile) {
                    saveCaptureToDevice(originalFile);
                  }
                  analyze(prepared);
                }}
              >
                ✅ Analyze this photo
              </button>
              <button className="btn secondary" onClick={cancelPhoto}>
                ✖️ Cancel
              </button>
              {photoSource === "camera" && (
                <p
                  style={{
                    color: "var(--muted)",
                    fontSize: "0.8rem",
                    marginTop: 8,
                  }}
                >
                  📥 A copy of this photo is saved to your device when you tap
                  Analyze.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {result && prepared && (
        <ResultsView
          imageDataUrl={prepared.dataUrl}
          result={result}
          saveMode={savedScanId ? "replace" : "new"}
          scanId={savedScanId}
          revision={revision}
          eventDate={
            savedScanId && !hasListedPrices ? eventDate : undefined
          }
          afterImage={currencyCard}
          onSaved={(id) => {
            if (id) setSavedScanId(id);
            setGalleryRefresh((n) => n + 1);
          }}
          onRevise={async (edits: ReviseEdit[], newEventDate?: string) => {
            if (edits.length > 0) {
              const res = await fetch("/api/revise", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ result, edits }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data?.error ?? "Revision failed");
              setResult(data.result as AnalysisResult);
              setRevision((r) => r + 1);
            }
            if (newEventDate && savedScanId) {
              const res = await fetch("/api/scan", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: savedScanId,
                  eventDate: newEventDate,
                }),
              });
              if (!res.ok) throw new Error("Could not update the date");
              setEventDate(newEventDate);
            }
          }}
        />
      )}

      <Gallery refreshKey={galleryRefresh} limit={5} showViewAll />

      {isAdmin && (
        <p className="footer-links">
          <Link href="/admin">Admin</Link>
        </p>
      )}
    </main>
  );
}
