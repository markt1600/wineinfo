"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface GalleryEntry {
  url: string;
  caption: string;
  sceneType: string;
  at: string;
}

interface Props {
  refreshKey?: number;
  limit?: number; // how many cards to show; omit for all
  title?: string;
  subtitle?: string;
  showViewAll?: boolean; // link to /gallery when there are more cards
}

// Grid of previously scanned summary cards (auto-saved after each analysis).
export default function Gallery({
  refreshKey = 0,
  limit,
  title = "🕐 Recent scans",
  subtitle = "The latest summary cards from everyone using this app.",
  showViewAll = false,
}: Props) {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [storage, setStorage] = useState<{ redis: boolean; blob: boolean } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    const qs = limit ? `?limit=${limit}` : "";
    fetch(`/api/gallery${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setEnabled(!!data.enabled);
        setStorage(data.storage ?? null);
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setTotal(Number(data.total) || 0);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, limit]);

  if (entries === null && enabled) return null; // still loading

  // Storage not configured — say exactly what's missing instead of hiding.
  if (!enabled) {
    const missing = [
      !storage?.redis && "an Upstash Redis database",
      !storage?.blob && "a Blob store",
    ]
      .filter(Boolean)
      .join(" and ");
    return (
      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>{title}</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          ⚠️ Scan history is off — this deployment is missing{" "}
          {missing || "storage configuration"}. In Vercel, open the project's
          <strong> Storage</strong> tab, create/connect it, then redeploy.
          Scans made before storage is connected are not saved.
        </p>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>{title}</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          No scans saved yet — analyze a photo and its summary card will show
          up here.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>{title}</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 12 }}>
        {subtitle}
      </p>
      <div className="gallery-grid">
        {entries.map((e) => (
          <a
            key={e.url}
            href={e.url}
            target="_blank"
            rel="noreferrer"
            className="gallery-item"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.url} alt={e.caption || "Wine summary card"} loading="lazy" />
            <span>
              {e.caption}
              <em>
                {new Date(e.at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </em>
            </span>
          </a>
        ))}
      </div>
      {showViewAll && total > entries.length && (
        <Link href="/gallery" className="btn secondary" style={{ marginTop: 14 }}>
          View all {total} scans
        </Link>
      )}
    </div>
  );
}
