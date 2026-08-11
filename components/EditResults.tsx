"use client";

import { useMemo, useState } from "react";
import type { AnalysisResult } from "@/lib/schema";

const SIZES = [
  { ml: 375, label: "375 mL (half)" },
  { ml: 750, label: "750 mL (standard)" },
  { ml: 1500, label: "1.5 L (magnum)" },
  { ml: 3000, label: "3 L (double magnum)" },
];

export interface ReviseEdit {
  id: string;
  sizeML?: number;
  misidentified?: boolean;
}

interface Props {
  result: AnalysisResult;
  // Current consumption date (YYYY-MM-DD). Provided only for Consumed
  // scans that are persisted — enables the date editor.
  eventDate?: string | null;
  onConfirm: (edits: ReviseEdit[], newEventDate?: string) => Promise<void>;
}

// The "Edit results" tab: correct bottle sizes (re-prices for the new
// size), flag misidentified bottles (they turn red/unidentified), and
// adjust the consumption date on unpriced bottle lineups.
export default function EditResults({ result, eventDate, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [date, setDate] = useState<string>(eventDate ?? "");

  const editable = useMemo(
    () => result.bottles.filter((b) => b.identified),
    [result]
  );

  const originalSize = (id: string) =>
    result.bottles.find((b) => b.id === id)?.bottleSizeML ?? 750;

  const edits: ReviseEdit[] = useMemo(() => {
    const out: ReviseEdit[] = [];
    for (const b of editable) {
      const size = sizes.get(b.id);
      const mis = flags.has(b.id);
      if (mis) out.push({ id: b.id, misidentified: true });
      else if (size && size !== originalSize(b.id))
        out.push({ id: b.id, sizeML: size });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, sizes, flags]);

  const dateChanged = !!eventDate && !!date && date !== eventDate;
  const changeCount = edits.length + (dateChanged ? 1 : 0);

  if (editable.length === 0 && eventDate == null) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(edits, dateChanged ? date : undefined);
      setOpen(false);
      setSizes(new Map());
      setFlags(new Set());
    } catch (e: any) {
      setError(e?.message ?? "Could not apply changes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <button
        className="btn secondary"
        onClick={() => setOpen(!open)}
        disabled={busy}
      >
        ✏️ {open ? "Close editor" : "Edit results"}
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 6 }}>
            Correct a bottle size (pricing is refreshed for the new size) or
            flag a wine that was identified incorrectly.
          </p>
          {editable.map((b) => {
            const name =
              [b.producer, b.wineName, b.vintage].filter(Boolean).join(" ") ||
              b.labelText;
            const flagged = flags.has(b.id);
            return (
              <div key={b.id} className="edit-row">
                <div className="edit-name">
                  <span style={{ color: "var(--muted)" }}>{b.id}</span> {name}
                </div>
                <div className="edit-controls">
                  <select
                    className="currency"
                    style={{ margin: 0, opacity: flagged ? 0.4 : 1 }}
                    disabled={flagged || busy}
                    value={sizes.get(b.id) ?? originalSize(b.id)}
                    onChange={(e) =>
                      setSizes((prev) =>
                        new Map(prev).set(b.id, Number(e.target.value))
                      )
                    }
                  >
                    {SIZES.map((s) => (
                      <option key={s.ml} value={s.ml}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <label className="edit-flag">
                    <input
                      type="checkbox"
                      checked={flagged}
                      disabled={busy}
                      onChange={() =>
                        setFlags((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.id)) next.delete(b.id);
                          else next.add(b.id);
                          return next;
                        })
                      }
                    />
                    Misidentified
                  </label>
                </div>
              </div>
            );
          })}
          {eventDate != null && (
            <div className="edit-row">
              <div className="edit-name">🍷 Consumption date</div>
              <input
                type="date"
                className="currency"
                style={{ margin: 0 }}
                disabled={busy}
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
              />
              <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 6 }}>
                When these wines were actually drunk — updates the record only,
                no re-analysis.
              </p>
            </div>
          )}
          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={busy || changeCount === 0}
            onClick={confirm}
          >
            {busy
              ? "Applying changes…"
              : `Confirm changes${changeCount ? ` (${changeCount})` : ""}`}
          </button>
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  );
}
