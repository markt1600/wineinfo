"use client";

import { useState } from "react";
import Link from "next/link";
import {
  csvToWineEntries,
  type WineImportEntry,
} from "@/lib/wineImportCsv";

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
  const [importEntries, setImportEntries] = useState<WineImportEntry[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

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

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportResult(null);
    try {
      const { entries, errors } = csvToWineEntries(await file.text());
      setImportEntries(entries);
      setImportErrors(errors);
      setImportFileName(file.name);
    } catch {
      setImportEntries([]);
      setImportErrors(["Could not read that file."]);
      setImportFileName(file.name);
    }
  };

  const runImport = async () => {
    if (importEntries.length === 0) return;
    setBusy(true);
    setImportResult(null);
    try {
      let wines = 0;
      let keys = 0;
      // The API caps a request at 200 entries — send in batches of 100.
      for (let i = 0; i < importEntries.length; i += 100) {
        const res = await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pin,
            action: "import_wines",
            entries: importEntries.slice(i, i + 100),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Import failed");
        wines += data.wines ?? 0;
        keys += data.keysWritten ?? 0;
      }
      setImportResult(
        `✓ Imported ${wines} wine${wines === 1 ? "" : "s"} (${keys} cache keys). Future scans of these wines skip web research.`
      );
      setImportEntries([]);
      setImportErrors([]);
      setImportFileName(null);
    } catch (e: any) {
      setImportResult(e?.message ?? "Import failed.");
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
        <>
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

        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>
            📥 Import wines
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 12 }}>
            Upload a CSV of pre-researched wines to seed the wine database —
            future scans of these wines skip web research entirely. Nothing
            is added to the public feed or anyone&apos;s scan history.{" "}
            <a href="/wine-import-template.csv" download>
              Download the CSV template
            </a>
            .
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={onImportFile}
          />
          {importFileName && (
            <p style={{ fontSize: "0.9rem", marginTop: 10 }}>
              <strong>{importFileName}</strong>:{" "}
              {importEntries.length} wine
              {importEntries.length === 1 ? "" : "s"} ready to import.
            </p>
          )}
          {importErrors.map((err, i) => (
            <p
              key={i}
              style={{ color: "#d70015", fontSize: "0.82rem", marginTop: 6 }}
            >
              {err}
            </p>
          ))}
          {importEntries.length > 0 && (
            <button
              className="btn"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={runImport}
            >
              {busy
                ? "Importing…"
                : `Import ${importEntries.length} wine${importEntries.length === 1 ? "" : "s"}`}
            </button>
          )}
          {importResult && (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 10 }}>
              {importResult}
            </p>
          )}
        </div>
        </>
      )}
    </main>
  );
}
