"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ResultsView from "@/components/ResultsView";
import type { AnalysisResult } from "@/lib/schema";

interface ScanRecord {
  id: string;
  cardUrl: string;
  photoUrl: string;
  caption: string;
  sceneType: string;
  at: string;
  result: AnalysisResult;
}

// Replays a saved scan exactly as it looked when freshly analyzed —
// no new Claude call, everything comes from storage.
function ScanView() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Missing scan id.");
      return;
    }
    let cancelled = false;
    fetch(`/api/scan?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? "Load failed");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setRecord(data.record as ScanRecord);
      })
      .catch((e) => {
        if (cancelled) return;
        // No full record (older save) — fall back to the plain card viewer.
        const src = params.get("src");
        if (src) {
          const caption = params.get("caption") ?? "";
          const at = params.get("at") ?? "";
          router.replace(
            `/card?src=${encodeURIComponent(src)}&caption=${encodeURIComponent(caption)}&at=${encodeURIComponent(at)}`
          );
          return;
        }
        setError(e?.message || "Could not load this scan.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push("/gallery");
  };

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
        </h1>
        {record && (
          <p>
            Saved scan ·{" "}
            {new Date(record.at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </header>

      <button className="btn secondary" onClick={back}>
        ← Back
      </button>

      {error && (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>
            {error} <Link href="/gallery">Browse all scans</Link>
          </p>
        </div>
      )}

      {!record && !error && (
        <div className="card">
          <div className="status">
            <div className="spinner" />
            Loading saved scan…
          </div>
        </div>
      )}

      {record && (
        <ResultsView
          imageDataUrl={record.photoUrl}
          result={record.result}
          replay
        />
      )}
    </main>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<main />}>
      <ScanView />
    </Suspense>
  );
}
