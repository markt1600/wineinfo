"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ResultsView from "@/components/ResultsView";
import type { ReviseEdit } from "@/components/EditResults";
import type { AnalysisResult } from "@/lib/schema";

interface ScanRecord {
  id: string;
  cardUrl: string;
  photoUrl: string;
  caption: string;
  sceneType: string;
  at: string;
  postedBy?: string;
  classification?: "Consumed" | "Seen";
  eventDate?: string;
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
  const [revision, setRevision] = useState(0);

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
            {record.postedBy || "Guest"} posted on{" "}
            {new Date(record.at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            {record.classification &&
              ` · ${record.classification} on ${new Date(
                `${record.eventDate ?? record.at.slice(0, 10)}T12:00:00`
              ).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}`}
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
          saveMode={revision > 0 ? "replace" : "off"}
          scanId={record.id}
          revision={revision}
          eventDate={
            record.result.bottles.some((b) => b.listedPrice)
              ? undefined
              : (record.eventDate ?? record.at.slice(0, 10))
          }
          onRevise={async (edits: ReviseEdit[], newEventDate?: string) => {
            let updated = record;
            if (edits.length > 0) {
              const res = await fetch("/api/revise", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ result: record.result, edits }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data?.error ?? "Revision failed");
              updated = { ...updated, result: data.result as AnalysisResult };
              setRevision((r) => r + 1);
            }
            if (newEventDate) {
              const res = await fetch("/api/scan", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: record.id, eventDate: newEventDate }),
              });
              if (!res.ok) throw new Error("Could not update the date");
              updated = { ...updated, eventDate: newEventDate };
            }
            setRecord(updated);
          }}
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
