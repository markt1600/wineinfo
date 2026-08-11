"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface MyScanEntry {
  id: string;
  cardUrl: string;
  caption: string;
  classification: "Consumed" | "Seen";
  eventDate: string;
  at: string;
  matchedWines?: string[];
}

const PERIODS = [
  { value: "recent", label: "Last 5 scans" },
  { value: "week", label: "Past week" },
  { value: "30", label: "Past 30 days" },
  { value: "60", label: "Past 60 days" },
  { value: "90", label: "Past 90 days" },
  { value: "year", label: "Past year" },
  { value: "all", label: "All time" },
];

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MyWinesPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [entries, setEntries] = useState<MyScanEntry[] | null>(null);
  const [period, setPeriod] = useState("recent");
  const [kind, setKind] = useState<"both" | "consumed" | "seen">("both");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // applied search
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setSignedIn(!!d?.user);
        setDisplayName(d?.user?.displayName ?? "");
      })
      .catch(() => setSignedIn(false));
  }, []);

  const load = useCallback(() => {
    setEntries(null);
    setError(null);
    const params = new URLSearchParams({ period, kind });
    if (query) params.set("q", query);
    fetch(`/api/my?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? "Load failed");
        return r.json();
      })
      .then((d) => setEntries(d.entries ?? []))
      .catch((e) => {
        setError(e?.message ?? "Could not load your scans.");
        setEntries([]);
      });
  }, [period, kind, query]);

  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  if (signedIn === false) {
    return (
      <main>
        <header className="app">
          <h1>
            🍷 Wine <span>(a)ID</span>
          </h1>
          <p>Your wines</p>
        </header>
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ marginBottom: 12 }}>
            Sign in to keep a personal history of the wines you&apos;ve
            consumed and seen.
          </p>
          <Link href="/login" className="btn">
            👤 Sign in
          </Link>
        </div>
      </main>
    );
  }

  const consumed = entries?.filter((e) => e.classification === "Consumed") ?? [];
  const seen = entries?.filter((e) => e.classification === "Seen") ?? [];

  const row = (e: MyScanEntry) => (
    <Link key={e.id} href={`/scan?id=${encodeURIComponent(e.id)}`} className="my-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={e.cardUrl} alt="" loading="lazy" />
      <span>
        {e.matchedWines?.length ? e.matchedWines.join(", ") : e.caption || "Scan"}
        {e.matchedWines?.length ? (
          <em>in: {e.caption || "scan"}</em>
        ) : null}
        <em>
          {e.classification === "Consumed" ? "🍷 Consumed on" : "👀 Seen on"}{" "}
          {fmtDate(e.eventDate)}
        </em>
      </span>
      <span className="my-chevron">›</span>
    </Link>
  );

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
        </h1>
        <p>{displayName ? `${displayName}'s wines` : "Your wines"}</p>
      </header>

      <div className="card">
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="currency"
            style={{ margin: 0, flex: 1 }}
            placeholder="Search your wines…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQuery(search)}
          />
          <button
            className="btn"
            style={{ width: "auto", padding: "0 22px" }}
            onClick={() => setQuery(search)}
          >
            🔎
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <select
            className="currency"
            style={{ margin: 0, flex: 1 }}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="currency"
            style={{ margin: 0, flex: 1 }}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="both">Consumed & seen</option>
            <option value="consumed">Consumed only</option>
            <option value="seen">Seen only</option>
          </select>
        </div>
        {query && (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 10 }}>
            Showing every scan containing “{query}” —{" "}
            <a
              style={{ cursor: "pointer" }}
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
            >
              clear
            </a>
          </p>
        )}
      </div>

      {entries === null && !error && (
        <div className="card">
          <div className="status">
            <div className="spinner" />
            Loading your scans…
          </div>
        </div>
      )}
      {error && (
        <div className="card">
          <p className="error">{error}</p>
        </div>
      )}

      {entries !== null && !error && entries.length === 0 && (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>
            {query
              ? `No wines matching “${query}”.`
              : "No scans in this period yet — analyze a photo while signed in and it will show up here."}
          </p>
        </div>
      )}

      {consumed.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>🍷 Consumed</h2>
          {consumed.map(row)}
        </div>
      )}
      {seen.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>👀 Seen</h2>
          {seen.map(row)}
        </div>
      )}
    </main>
  );
}
