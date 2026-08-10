"use client";

import { useEffect, useRef } from "react";
import type { AnalysisResult } from "@/lib/schema";
import { drawAnnotations } from "@/lib/annotate";

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
    // Blob-hosted photos (replay view) are cross-origin; without CORS the
    // canvas would be tainted and the download button would break.
    if (!imageDataUrl.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      drawAnnotations(ctx, result, bestValueId, canvas.width, canvas.height);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, result, bestValueId]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.download = "wine-aid-annotated.jpg";
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
          <span style={{ color: "var(--gold)" }}>★ Best value</span>
        )}
      </div>
      <button className="btn secondary" onClick={download} style={{ marginTop: 12 }}>
        Download annotated photo
      </button>
    </div>
  );
}
