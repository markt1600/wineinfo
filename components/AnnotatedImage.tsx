"use client";

import { useEffect, useRef } from "react";
import type { AnalysisResult } from "@/lib/schema";

interface Props {
  imageDataUrl: string; // the exact image that was sent for analysis
  result: AnalysisResult;
  bestValueId: string | null;
}

// Draws the analyzed photo with identified bottles shaded light green,
// unidentified ones light red, and the best-value pick outlined in gold.
export default function AnnotatedImage({
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
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);

      const scale = Math.max(img.naturalWidth, img.naturalHeight) / 1000;
      const lineW = Math.max(2, 3 * scale);
      const fontPx = Math.max(14, 22 * scale);
      ctx.font = `bold ${fontPx}px sans-serif`;

      for (const b of result.bottles) {
        const box = b.boundingBox;
        if (!box) continue;
        const isBest = b.id === bestValueId;
        const fill = b.identified
          ? "rgba(80, 220, 130, 0.30)"
          : "rgba(255, 90, 90, 0.30)";
        const stroke = isBest
          ? "rgba(240, 196, 108, 0.95)"
          : b.identified
            ? "rgba(50, 190, 100, 0.9)"
            : "rgba(230, 70, 70, 0.9)";

        ctx.fillStyle = fill;
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = isBest ? lineW * 1.8 : lineW;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        // id badge
        const label = isBest ? `${b.id} ★` : b.id;
        const pad = 6 * scale;
        const textW = ctx.measureText(label).width;
        const bx = box.x;
        const by = Math.max(0, box.y - fontPx - pad * 1.5);
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(bx, by, textW + pad * 2, fontPx + pad);
        ctx.fillStyle = isBest ? "#f0c46c" : "#ffffff";
        ctx.fillText(label, bx + pad, by + fontPx);
      }
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, result, bestValueId]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.download = "wine-lens-annotated.jpg";
    a.click();
  };

  return (
    <div className="preview">
      <canvas ref={canvasRef} />
      <div className="legend">
        <span>
          <span className="dot green" /> Identified
        </span>
        <span>
          <span className="dot red" /> Not identified
        </span>
        {bestValueId && (
          <span style={{ color: "#f0c46c" }}>★ Best value</span>
        )}
      </div>
      <button className="btn secondary" onClick={download} style={{ marginTop: 12 }}>
        Download annotated photo
      </button>
    </div>
  );
}
