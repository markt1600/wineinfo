"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { formatMoney, formatTotals, marketTotals } from "@/lib/totals";

// Phone-sized (9:16) shareable infographic: annotated photo on top, a
// compact per-wine info list, and the total market value of everything
// in the picture.
const W = 1080;
const H = 1920;
const PAD = 56;

interface Props {
  imageDataUrl: string;
  result: AnalysisResult;
  bestValueId: string | null;
  autoSave?: boolean; // false when replaying an already-saved scan
  onSaved?: () => void;
}

// "Opus One 2019, Caymus 2021 +2 more · $412 at market"
function buildCaption(result: AnalysisResult): string {
  const names = result.bottles
    .filter((b) => b.identified)
    .map((b) =>
      [b.producer, b.wineName, b.vintage].filter(Boolean).join(" ")
    )
    .filter(Boolean);
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const nameStr =
    shown.length > 0
      ? shown.join(", ") + (more > 0 ? ` +${more} more` : "")
      : `${result.bottles.length} wine${result.bottles.length === 1 ? "" : "s"}`;
  const totalStr = formatTotals(marketTotals(result));
  return totalStr ? `${nameStr} · ${totalStr} at market` : nameStr;
}

function truncate(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function bottleName(b: BottleResult): string {
  return (
    [b.producer, b.wineName, b.vintage].filter(Boolean).join(" ") ||
    b.labelText ||
    "Unknown wine"
  );
}

function bottleInfoLine(b: BottleResult): string {
  const parts: string[] = [];
  const r = b.ratings[0];
  if (r) parts.push(`${r.source} ${r.score}${r.vintageMatch ? "" : "*"}`);
  if (b.marketPrice)
    parts.push(
      `Mkt ${formatMoney(b.marketPrice.amount, b.marketPrice.currency)}`
    );
  if (!b.identified) parts.push("not identified");
  else if (parts.length === 0) parts.push(b.region ?? "identified");
  return parts.join("  ·  ");
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === "function") {
    (ctx as any).roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

// Re-encode the analyzed photo (same pixel size, so bounding boxes stay
// valid) down to a size the gallery API accepts.
function compressPhoto(srcDataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cctx = c.getContext("2d");
      if (!cctx) return resolve(null);
      cctx.drawImage(img, 0, 0);
      let q = 0.72;
      let out = c.toDataURL("image/jpeg", q);
      while (out.length > 1.9 * 1024 * 1024 && q > 0.35) {
        q -= 0.1;
        out = c.toDataURL("image/jpeg", q);
      }
      resolve(out.length <= 2.4 * 1024 * 1024 ? out : null);
    };
    img.onerror = () => resolve(null);
    img.src = srcDataUrl;
  });
}

export default function InfographicCard({
  imageDataUrl,
  result,
  bestValueId,
  autoSave = true,
  onSaved,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const savedRef = useRef(false);
  const [saveState, setSaveState] = useState<"pending" | "saved" | "off">(
    "pending"
  );

  // Automatically save the card + photo + full analysis to shared history.
  const doSave = async (canvas: HTMLCanvasElement) => {
    if (savedRef.current) return;
    savedRef.current = true;
    try {
      let quality = 0.8;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > 1.4 * 1024 * 1024 && quality > 0.4) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      const photo = await compressPhoto(imageDataUrl);
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: dataUrl.split(",")[1],
          photo: photo?.split(",")[1],
          result,
          caption: buildCaption(result),
          sceneType: result.sceneType,
        }),
      });
      if (res.ok) {
        setSaveState("saved");
        onSaved?.();
      } else {
        // 503 = gallery storage not configured; anything else, don't retry.
        setSaveState("off");
      }
    } catch {
      setSaveState("off");
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    // Blob-hosted photos (replay view) are cross-origin; load with CORS so
    // the canvas isn't tainted and downloads keep working.
    if (!imageDataUrl.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#2b0a12");
      bg.addColorStop(1, "#14040a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Header
      ctx.fillStyle = "#f5e9ec";
      ctx.font = "bold 64px sans-serif";
      ctx.fillText("🍷 Wine (a)ID", PAD, PAD + 58);
      ctx.font = "34px sans-serif";
      ctx.fillStyle = "#c9a3ad";
      const date = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const sceneLabel: Record<string, string> = {
        single_bottle: "Bottle",
        bottle_group: "Bottles",
        shelf_with_prices: "Shelf",
        wine_menu: "Wine menu",
        other: "Photo",
      };
      ctx.fillText(
        `${sceneLabel[result.sceneType] ?? "Photo"} · ${date}`,
        PAD,
        PAD + 110
      );

      // The original (un-annotated) photo, letterboxed into a rounded frame
      const photoTop = PAD + 150;
      const photoH = 620;
      const photoW = W - PAD * 2;
      const s = Math.min(
        photoW / img.naturalWidth,
        photoH / img.naturalHeight
      );
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      const dx = PAD + (photoW - dw) / 2;
      const dy = photoTop + (photoH - dh) / 2;
      ctx.save();
      roundRectPath(ctx, dx, dy, dw, dh, 24);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
      ctx.strokeStyle = "#57202c";
      ctx.lineWidth = 3;
      roundRectPath(ctx, dx, dy, dw, dh, 24);
      ctx.stroke();

      // Totals bar directly under the photo
      const totalsH = 140;
      const footerH = 54;
      const totals = marketTotals(result);
      const totalStr = formatTotals(totals);
      const barY = photoTop + photoH + 28;
      ctx.fillStyle = "rgba(240, 196, 108, 0.10)";
      roundRectPath(ctx, PAD, barY, W - PAD * 2, totalsH, 20);
      ctx.fill();
      ctx.strokeStyle = "#f0c46c";
      ctx.lineWidth = 2;
      roundRectPath(ctx, PAD, barY, W - PAD * 2, totalsH, 20);
      ctx.stroke();
      ctx.font = "34px sans-serif";
      ctx.fillStyle = "#c9a3ad";
      ctx.fillText("Total value at market price", PAD + 36, barY + 56);
      ctx.font = "bold 58px sans-serif";
      ctx.fillStyle = "#f0c46c";
      ctx.fillText(
        totalStr ?? "n/a — no market prices found",
        PAD + 36,
        barY + 118
      );

      // Wine list fills the space between the totals bar and the footer
      const listTop = barY + totalsH + 36;
      const listBottom = H - footerH - 24;

      // Identified wines first (unidentified ones are also the first to be
      // pushed into the "+N more" overflow); stable order within each group.
      const bottles = [...result.bottles].sort(
        (a, b) => Number(b.identified) - Number(a.identified)
      );
      const minRowH = 96;
      const maxRows = Math.max(1, Math.floor((listBottom - listTop) / minRowH));
      const shown =
        bottles.length <= maxRows ? bottles : bottles.slice(0, maxRows - 1);
      const overflow = bottles.length - shown.length;
      const rowH = Math.min(
        150,
        (listBottom - listTop) / (shown.length + (overflow > 0 ? 1 : 0) || 1)
      );

      let y = listTop;
      for (const b of shown) {
        const isBest = b.id === bestValueId;

        // status dot
        ctx.fillStyle = b.identified
          ? "rgba(61, 220, 132, 0.9)"
          : "rgba(255, 107, 107, 0.9)";
        ctx.beginPath();
        ctx.arc(PAD + 14, y + rowH / 2 - 10, 12, 0, Math.PI * 2);
        ctx.fill();

        const textX = PAD + 48;
        const priceColW = 240;
        const nameMaxW = W - PAD - textX - priceColW;

        // name line
        ctx.font = `bold 38px sans-serif`;
        ctx.fillStyle = isBest ? "#f0c46c" : "#f5e9ec";
        const star = isBest ? "★ " : "";
        ctx.fillText(
          truncate(ctx, `${star}${bottleName(b)}`, nameMaxW),
          textX,
          y + rowH / 2 - 8
        );

        // info line (rating, market price, …)
        ctx.font = "31px sans-serif";
        ctx.fillStyle = "#c9a3ad";
        ctx.fillText(
          truncate(ctx, bottleInfoLine(b), nameMaxW),
          textX,
          y + rowH / 2 + 34
        );

        // right-aligned listed price (falls back to market price), with the
        // markup/discount vs market underneath — red markup, green discount
        const price = b.listedPrice ?? b.marketPrice;
        if (price && price.currency !== "UNK") {
          ctx.font = "bold 40px sans-serif";
          ctx.fillStyle = "#f5e9ec";
          const label = formatMoney(price.amount, price.currency);
          ctx.fillText(
            label,
            W - PAD - ctx.measureText(label).width,
            y + rowH / 2 + 4
          );
          if (b.listedPrice) {
            ctx.font = "bold 27px sans-serif";
            let sub: string;
            if (b.priceDeltaPct != null && Math.abs(b.priceDeltaPct) >= 1) {
              const markup = b.priceDeltaPct > 0;
              sub = markup
                ? `+${Math.round(b.priceDeltaPct)}% vs mkt`
                : `−${Math.round(Math.abs(b.priceDeltaPct))}% vs mkt`;
              ctx.fillStyle = markup ? "#ff6b6b" : "#3ddc84";
            } else if (b.priceDeltaPct != null) {
              sub = "≈ market";
              ctx.fillStyle = "#c9a3ad";
            } else {
              sub = "listed";
              ctx.fillStyle = "#c9a3ad";
              ctx.font = "26px sans-serif";
            }
            ctx.fillText(
              sub,
              W - PAD - ctx.measureText(sub).width,
              y + rowH / 2 + 38
            );
          }
        }

        // separator
        ctx.strokeStyle = "rgba(87, 32, 44, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PAD, y + rowH);
        ctx.lineTo(W - PAD, y + rowH);
        ctx.stroke();

        y += rowH;
      }
      if (overflow > 0) {
        ctx.font = "italic 32px sans-serif";
        ctx.fillStyle = "#c9a3ad";
        ctx.fillText(`+ ${overflow} more wine${overflow > 1 ? "s" : ""}`, PAD + 48, y + rowH / 2);
      }

      // Footer
      ctx.font = "26px sans-serif";
      ctx.fillStyle = "rgba(201, 163, 173, 0.6)";
      const foot = "* rating from a different/any vintage · made with Wine (a)ID";
      ctx.fillText(foot, PAD, H - 32);

      if (autoSave) void doSave(canvas);
    };
    img.src = imageDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrl, result, bestValueId, autoSave]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.download = "wine-aid-summary.jpg";
    a.click();
  };

  return (
    <div className="preview">
      <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />
      <button className="btn" onClick={download} style={{ marginTop: 12 }}>
        Download summary card
      </button>
      {saveState !== "pending" && (
        <p
          style={{
            color: "var(--muted)",
            fontSize: "0.82rem",
            marginTop: 8,
            textAlign: "center",
          }}
        >
          {saveState === "saved"
            ? "✓ Saved to recent scans"
            : "⚠️ Not saved — scan-history storage isn't configured (see the note below)"}
        </p>
      )}
    </div>
  );
}
