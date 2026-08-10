"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// In-app viewer for a saved summary card, so navigating from the gallery
// keeps the app chrome and a way back.
function CardView() {
  const router = useRouter();
  const params = useSearchParams();
  const src = params.get("src") ?? "";
  const caption = params.get("caption") ?? "";
  const at = params.get("at") ?? "";

  // Only render images that live in our blob storage.
  const valid =
    src.startsWith("https://") && src.includes(".blob.vercel-storage.com");

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
        {caption && <p>{caption}</p>}
        {at && (
          <p style={{ fontSize: "0.8rem" }}>
            {new Date(at).toLocaleDateString(undefined, {
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

      {valid ? (
        <div className="card preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption || "Wine summary card"} />
          <a
            className="btn secondary"
            href={src}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 12 }}
          >
            Open full size
          </a>
        </div>
      ) : (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>
            This card could not be loaded.{" "}
            <Link href="/gallery">Browse all scans</Link>
          </p>
        </div>
      )}
    </main>
  );
}

export default function CardPage() {
  return (
    <Suspense fallback={<main />}>
      <CardView />
    </Suspense>
  );
}
