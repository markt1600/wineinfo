"use client";

import { useState } from "react";
import Link from "next/link";

interface GalleryEntry {
  id?: string;
  url: string;
  caption: string;
  sceneType: string;
  at: string;
}

// PIN-protected admin page for deleting saved scans.
export default function AdminPage() {
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadEntries = async () => {
    const res = await fetch("/api/gallery");
    const data = await res.json();
    setEntries(Array.isArray(data.entries) ? data.entries : []);
    setSelected(new Set());
  };

  const unlock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, action: "verify" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Incorrect PIN");
      }
      setUnlocked(true);
      await loadEntries();
    } catch (e: any) {
      setMessage(e?.message ?? "Could not unlock.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} scan${selected.size === 1 ? "" : "s"}? This removes the card, photo, and analysis permanently.`
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          action: "delete",
          urls: [...selected],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Delete failed");
      setMessage(`Deleted ${data.deleted} scan${data.deleted === 1 ? "" : "s"}.`);
      await loadEntries();
    } catch (e: any) {
      setMessage(e?.message ?? "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
        </h1>
        <p>Admin — manage saved scans</p>
      </header>

      <Link href="/" className="btn secondary" style={{ marginTop: 8 }}>
        ← Back to scanning
      </Link>

      {!unlocked ? (
        <div className="card">
          <p style={{ marginBottom: 8 }}>Enter the admin PIN to continue.</p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            className="currency"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && pin && unlock()}
          />
          <button className="btn" disabled={busy || !pin} onClick={unlock}>
            Unlock
          </button>
          {message && <div className="error">{message}</div>}
        </div>
      ) : (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>
            🗑️ Delete scans
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 12 }}>
            Select scans to remove. Deleting is permanent — the card, photo,
            and analysis are all erased.
          </p>
          {entries.length === 0 && (
            <p style={{ color: "var(--muted)" }}>No scans stored.</p>
          )}
          {entries.map((e) => (
            <label key={e.url} className="admin-row">
              <input
                type="checkbox"
                checked={selected.has(e.url)}
                onChange={() => toggle(e.url)}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.url} alt="" />
              <span>
                {e.caption || "(no caption)"}
                <em>
                  {new Date(e.at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </em>
              </span>
            </label>
          ))}
          {entries.length > 0 && (
            <button
              className="btn"
              style={{ marginTop: 14 }}
              disabled={busy || selected.size === 0}
              onClick={deleteSelected}
            >
              {busy
                ? "Working…"
                : `Delete selected (${selected.size})`}
            </button>
          )}
          {message && (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 10 }}>
              {message}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
