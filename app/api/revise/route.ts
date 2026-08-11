import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisResult, BottleResult } from "@/lib/schema";
import { cacheDelete, cacheEnabled, wineKey } from "@/lib/wineCache";

export const maxDuration = 120;
export const runtime = "nodejs";

// Applies user edits to an analysis: bottle-size changes (re-price for the
// new size, approximating from the 750 mL price when a size-specific price
// can't be found) and misidentification flags (bottle becomes unidentified).

interface ReviseEdit {
  id: string;
  sizeML?: number;
  misidentified?: boolean;
  tastingNotes?: string; // "" clears the notes
}

const ALLOWED_SIZES = new Set([375, 750, 1500, 3000]);

const repriceSchema = {
  type: "object",
  properties: {
    bottles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          marketPrice: {
            type: ["object", "null"],
            properties: {
              amount: { type: "number" },
              currency: { type: "string" },
            },
            required: ["amount", "currency"],
            additionalProperties: false,
          },
          marketPriceSource: { type: ["string", "null"] },
          marketPriceEstimated: { type: "boolean" },
          priceDeltaPct: { type: ["number", "null"] },
          valueAssessment: { type: ["string", "null"] },
        },
        required: [
          "id",
          "marketPrice",
          "marketPriceSource",
          "marketPriceEstimated",
          "priceDeltaPct",
          "valueAssessment",
        ],
        additionalProperties: false,
      },
    },
    bestValue: {
      type: "object",
      properties: {
        bottleId: { type: ["string", "null"] },
        reasoning: { type: "string" },
      },
      required: ["bottleId", "reasoning"],
      additionalProperties: false,
    },
  },
  required: ["bottles", "bestValue"],
  additionalProperties: false,
} as const;

// Pure-scaling fallback when the search call fails.
function scalePrice(b: BottleResult, sizeML: number): void {
  const fromSize = b.bottleSizeML ?? 750;
  if (b.marketPrice && fromSize > 0) {
    b.marketPrice = {
      amount: Math.round(b.marketPrice.amount * (sizeML / fromSize) * 100) / 100,
      currency: b.marketPrice.currency,
    };
    b.marketPriceEstimated = true;
    if (
      b.listedPrice &&
      b.listedPrice.currency === b.marketPrice.currency &&
      b.marketPrice.amount > 0
    ) {
      b.priceDeltaPct = Math.round(
        ((b.listedPrice.amount - b.marketPrice.amount) / b.marketPrice.amount) *
          100
      );
    } else {
      b.priceDeltaPct = null;
    }
  }
  b.bottleSizeML = sizeML;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    result?: AnalysisResult;
    edits?: ReviseEdit[];
    venue?: string; // "" clears the venue name
  };
  const edits = Array.isArray(body?.edits) ? body.edits : [];
  const hasVenueEdit = typeof body?.venue === "string";
  if (!body?.result || (edits.length === 0 && !hasVenueEdit)) {
    return Response.json({ error: "Missing result or edits" }, { status: 400 });
  }
  const result: AnalysisResult = JSON.parse(JSON.stringify(body.result));
  const byId = new Map(result.bottles.map((b) => [b.id, b]));

  // 0a. Venue name (menu scans): plain metadata, applied directly.
  if (hasVenueEdit) {
    const trimmed = body.venue!.trim().slice(0, 120);
    result.venue = trimmed || null;
  }

  // 0b. Tasting notes: plain metadata, applied directly (no model call).
  for (const edit of edits) {
    if (typeof edit.tastingNotes !== "string") continue;
    const b = byId.get(edit.id);
    if (!b) continue;
    const trimmed = edit.tastingNotes.trim().slice(0, 1000);
    b.tastingNotes = trimmed || null;
  }

  // 1. Misidentification flags: bottle turns red/unidentified and its
  //    wine data is cleared; suspect cache entries are purged.
  for (const edit of edits) {
    if (!edit.misidentified) continue;
    const b = byId.get(edit.id);
    if (!b) continue;
    if (cacheEnabled() && (b.producer || b.wineName)) {
      await cacheDelete(wineKey(b.producer, b.wineName, b.vintage));
    }
    b.identified = false;
    b.producer = null;
    b.wineName = null;
    b.vintage = null;
    b.region = null;
    b.grapeVariety = null;
    b.wineType = null;
    b.marketPrice = null;
    b.marketPriceSource = null;
    b.marketPriceEstimated = false;
    b.priceDeltaPct = null;
    b.ratings = [];
    b.valueAssessment = null;
    b.notes = [b.notes, "Flagged as misidentified by the user."]
      .filter(Boolean)
      .join(" ");
  }

  if (result.bestValue.bottleId) {
    const best = byId.get(result.bestValue.bottleId);
    if (!best || !best.identified) {
      result.bestValue = {
        bottleId: null,
        reasoning:
          "Cleared — the previous best-value pick was flagged as misidentified.",
      };
    }
  }

  // 2. Size changes on still-identified bottles → re-price.
  const sizeEdits = edits.filter((e) => {
    const b = byId.get(e.id);
    return (
      b &&
      b.identified &&
      e.sizeML &&
      ALLOWED_SIZES.has(e.sizeML) &&
      e.sizeML !== (b.bottleSizeML ?? 750)
    );
  });

  if (sizeEdits.length > 0) {
    const MODEL = process.env.ANALYSIS_MODEL ?? "claude-sonnet-5";
    const wines = sizeEdits.map((e) => {
      const b = byId.get(e.id)!;
      return {
        id: b.id,
        wine: [b.producer, b.wineName, b.vintage].filter(Boolean).join(" "),
        newSizeML: e.sizeML!,
        current750Price: b.marketPrice,
        listedPrice: b.listedPrice,
      };
    });
    const context = result.bottles
      .filter((b) => b.identified)
      .map((b) => ({
        id: b.id,
        wine: [b.producer, b.wineName, b.vintage].filter(Boolean).join(" "),
        sizeML:
          sizeEdits.find((e) => e.id === b.id)?.sizeML ?? b.bottleSizeML ?? 750,
        listedPrice: b.listedPrice,
        marketPrice: b.marketPrice,
        topRating: b.ratings[0] ?? null,
      }));
    const hasListed = result.bottles.some((b) => b.listedPrice);

    const prompt = `The user corrected the bottle size for these wines. For EACH wine in "reprice", find the typical market price for the NEW bottle size (one web search per wine at most, e.g. "<wine> 1.5L magnum price"). If a size-specific price cannot be found, approximate it by scaling the current price proportionally to volume and set marketPriceEstimated=true (set it false when you found a real size-specific price). Only independent retail/wholesale/auction listings count as a market price — never a restaurant's or bar's own wine-list price (those carry the markup this app measures). Prefer retailers in the market matching the price currency (SGD → Singapore, GBP → UK, …) when comparable listings exist; fall back to the international average otherwise. Keep the same currency as the current price. Recompute priceDeltaPct against listedPrice where present (approximate currency conversion if needed) and write a short valueAssessment.

reprice: ${JSON.stringify(wines)}

${hasListed ? `Then, considering ALL of these wines with their corrected sizes, pick the best value-for-money entry (quality vs listed price) for bestValue: ${JSON.stringify(context)}` : `Set bestValue.bottleId to null.`}

Respond with a single JSON object matching the schema.`;

    try {
      const client = new Anthropic();
      let messages: any[] = [{ role: "user", content: prompt }];
      let final: any = null;
      for (let turn = 0; turn < 4 && !final; turn++) {
        const s = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 8000,
          tools: [
            {
              type: "web_search_20260209",
              name: "web_search",
              max_uses: Math.min(sizeEdits.length, 6),
            },
          ],
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: repriceSchema },
          },
          messages,
        } as any);
        const response = await s.finalMessage();
        if (response.stop_reason === "pause_turn") {
          messages = [...messages, { role: "assistant", content: response.content }];
          continue;
        }
        final = response;
      }
      if (!final || final.stop_reason === "refusal") throw new Error("no result");
      const text = final.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      const start = text.indexOf("{");
      const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));

      for (const rb of parsed.bottles ?? []) {
        const b = byId.get(rb.id);
        const edit = sizeEdits.find((e) => e.id === rb.id);
        if (!b || !edit) continue;
        b.bottleSizeML = edit.sizeML!;
        b.marketPrice = rb.marketPrice;
        b.marketPriceSource = rb.marketPriceSource;
        b.marketPriceEstimated = !!rb.marketPriceEstimated;
        b.priceDeltaPct = rb.priceDeltaPct;
        b.valueAssessment = rb.valueAssessment;
      }
      if (hasListed && parsed.bestValue) {
        const pick = parsed.bestValue.bottleId
          ? byId.get(parsed.bestValue.bottleId)
          : null;
        result.bestValue = {
          bottleId: pick && pick.identified ? pick.id : null,
          reasoning: parsed.bestValue.reasoning ?? "",
        };
      }
    } catch (err) {
      console.error("reprice search failed, falling back to scaling:", err);
      for (const edit of sizeEdits) {
        scalePrice(byId.get(edit.id)!, edit.sizeML!);
      }
    }
  }

  return Response.json({ result });
}
