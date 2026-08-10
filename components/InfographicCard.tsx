"use client";

import { useEffect, useRef } from "react";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { renderAnnotatedCanvas } from "@/lib/annotate";
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

export default function InfographicCard({
  imageDataUrl,
  result,
  bestValueId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
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
      ctx.fillText("🍷 Wine Lens", PAD, PAD + 58);
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

      // Annotated photo, letterboxed into a rounded frame
      const photoTop = PAD + 150;
      const photoH = 620;
      const photoW = W - PAD * 2;
      const annotated = renderAnnotatedCanvas(img, result, bestValueId);
      const s = Math.min(photoW / annotated.width, photoH / annotated.height);
      const dw = annotated.width * s;
      const dh = annotated.height * s;
      const dx = PAD + (photoW - dw) / 2;
      const dy = photoTop + (photoH - dh) / 2;
      ctx.save();
      roundRectPath(ctx, dx, dy, dw, dh, 24);
      ctx.clip();
      ctx.drawImage(annotated, dx, dy, dw, dh);
      ctx.restore();
      ctx.strokeStyle = "#57202c";
      ctx.lineWidth = 3;
      roundRectPath(ctx, dx, dy, dw, dh, 24);
      ctx.stroke();

      // Totals bar geometry (drawn after list, but reserve space now)
      const totalsH = 140;
      const footerH = 54;
      const listTop = photoTop + photoH + 40;
      const listBottom = H - totalsH - footerH - 36;

      // Wine list
      const bottles = result.bottles;
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
          truncate(ctx, `${star}${b.id} · ${bottleName(b)}`, nameMaxW),
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

        // right-aligned listed price (falls back to market price)
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
            ctx.font = "26px sans-serif";
            ctx.fillStyle = "#c9a3ad";
            const sub = "listed";
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

      // Totals bar
      const totals = marketTotals(result);
      const totalStr = formatTotals(totals);
      const barY = H - totalsH - footerH;
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

      // Footer
      ctx.font = "26px sans-serif";
      ctx.fillStyle = "rgba(201, 163, 173, 0.6)";
      const foot = "* rating from a different/any vintage · made with Wine Lens";
      ctx.fillText(foot, PAD, H - 32);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, result, bestValueId]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.download = "wine-lens-summary.jpg";
    a.click();
  };

  return (
    <div className="preview">
      <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />
      <button className="btn" onClick={download} style={{ marginTop: 12 }}>
        Download summary card
      </button>
    </div>
  );
}
