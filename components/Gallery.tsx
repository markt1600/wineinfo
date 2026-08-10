"use client";

import { useEffect, useState } from "react";

interface GalleryEntry {
  url: string;
  caption: string;
  sceneType: string;
  at: string;
}

// Public feed of recently shared summary cards.
export default function Gallery({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/gallery")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setEnabled(!!data.enabled);
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!enabled || !entries || entries.length === 0) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>
        🌍 Recently scanned
      </h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 12 }}>
        Summary cards shared by Wine Lens users.
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
            <img src={e.url} alt={e.caption || "Shared wine summary"} loading="lazy" />
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
    </div>
  );
}
