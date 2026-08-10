import type { AnalysisResult } from "@/lib/schema";

// Draws the bottle overlays (green = identified, red = unidentified,
// gold = best value) onto a context that already contains the photo at
// its analyzed pixel size. Shared by the on-screen overlay and the
// downloadable infographic.
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  result: AnalysisResult,
  bestValueId: string | null,
  imgWidth: number,
  imgHeight: number
) {
  const scale = Math.max(imgWidth, imgHeight) / 1000;
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
}

// Renders the photo + annotations to an offscreen canvas at natural size.
export function renderAnnotatedCanvas(
  img: HTMLImageElement,
  result: AnalysisResult,
  bestValueId: string | null
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  drawAnnotations(ctx, result, bestValueId, canvas.width, canvas.height);
  return canvas;
}
