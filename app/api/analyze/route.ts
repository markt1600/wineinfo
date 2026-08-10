import Anthropic from "@anthropic-ai/sdk";
import { analysisJsonSchema, type AnalysisResult } from "@/lib/schema";
import {
  cacheEnabled,
  cacheGetMany,
  cacheSet,
  wineKey,
  type WineCacheEntry,
} from "@/lib/wineCache";

// Web-search-heavy turns can run for minutes; give the function room.
export const maxDuration = 300;
export const runtime = "nodejs";

interface AnalyzeRequest {
  image: string; // base64, no data: prefix
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  currencyHint?: string; // ISO 4217 code confirmed by the user
}

// Per-photo research budget: at most this many wines get web research,
// regardless of how many bottles are in the photo.
const MAX_RESEARCH = Math.max(
  1,
  Number(process.env.ANALYSIS_MAX_WINES) || 15
);

function buildPrompt(req: AnalyzeRequest, withCache: boolean): string {
  const currencyNote = req.currencyHint
    ? `The user has confirmed that any prices shown in this photo are in ${req.currencyHint}. Use that currency for all listed prices and value comparisons; set currency.code to "${req.currencyHint}", detected to true, and needsUserInput to false.`
    : `If the photo shows prices (shelf tags or a menu), determine the currency from symbols, language, formatting, and any location clues. If you cannot determine it with reasonable confidence, set currency.needsUserInput to true, leave listedPrice amounts as the printed numbers with currency "UNK", and do NOT make value-for-money judgements — explain in the summary that the currency must be confirmed first.`;

  const cacheNote = withCache
    ? `
Wine database (cache):
- This app keeps a local database of wines it has already researched. After identifying the wines in the photo and BEFORE any web searching, call the wine_cache_lookup tool ONCE with ALL identified wines.
- For cache hits, use the cached market price and ratings directly and do NOT web-search that wine (append " (cached)" to marketPriceSource). Cached data is at most 30 days old.
- Only web-search the wines that were cache misses.`
    : "";

  return `You are a wine identification and valuation assistant. Analyze the attached photo (${req.width}x${req.height} pixels).

First classify the scene:
- single_bottle: one wine bottle
- bottle_group: multiple bottles, no visible prices
- shelf_with_prices: bottles in a store with visible price tags
- wine_menu: a printed or written wine list / menu
- other: not wine related

For every wine bottle (or menu line item) you can see, create an entry in "bottles":
- Give it a short id ("b1", "b2", ...).
- boundingBox: the pixel coordinates of the bottle (or the menu line) in the submitted image, top-left origin. Coordinates map 1:1 to the image pixels. Provide a box for every entry you can locate visually; use null only if you truly cannot localize it.
- Read the label or menu text carefully (producer, cuvée, vintage, appellation).
- Set identified=true only when you are reasonably confident of the specific wine (producer + wine). Partial reads where the wine cannot be pinned down are identified=false.
${cacheNote}
For each IDENTIFIED wine, use web search to find:
- Typical current retail market price (prefer Wine-Searcher average or comparable aggregate; note the source).
- Ratings: STRONGLY prefer Vivino and CellarTracker community scores — try to find at least one of those two for every identified wine. Only fall back to critic scores (Wine Spectator, Wine Advocate, etc.) when neither Vivino nor CellarTracker has a rating for the wine. Prefer the rating for the EXACT vintage shown in the photo; if no rating exists for that vintage, the wine's general (all-vintage) rating or a nearby vintage's rating is acceptable — set vintageMatch=false on such ratings and true only when the rating matches the pictured vintage. Include the source name and score; include a URL when you have one.
Be economical with research: at most ONE web search per identified wine — a single query like "<producer> <wine> <vintage> price rating" usually returns the market price and a Vivino/CellarTracker score together in the result snippets. Use web_fetch only when the snippets genuinely don't contain the number you need. Never search for unidentified bottles, and don't re-verify data you already have.

Research budget: research at most ${MAX_RESEARCH} wines in this photo. If more are identified, prioritize (1) wines with listed prices (needed for the value comparison), (2) the most prominent bottles, (3) likely best-value candidates. For identified wines beyond the budget, set marketPrice to null and ratings to [] and note "not researched — photo has many bottles" in their notes. If the photo shows more than 30 bottles or menu lines, include the 30 most legible as entries and mention the remainder in the summary.

Prices and value:
- listedPrice: the price printed in the photo for that bottle/menu line, if any.
${currencyNote}
- If the scene is shelf_with_prices or wine_menu AND the currency is known: compare each listed price against the wine's market price (convert currencies approximately if needed) and write a short valueAssessment (e.g. "listed 20% below typical retail — good value" or "3.2x retail markup — typical restaurant pricing"). Then pick the single best value-for-money entry and put its id in bestValue.bottleId with your reasoning. Consider quality (ratings) as well as price ratio — a slightly worse ratio on a much better-rated wine can still be the best value.
- If there are no listed prices, or the currency is unconfirmed, set bestValue.bottleId to null.

Finish with a concise, friendly summary (2-4 sentences) of what you found.

Your final answer must be a single JSON object matching the required schema — no prose outside the JSON.`;
}

const cacheLookupTool = {
  name: "wine_cache_lookup",
  description:
    "Look up wines in the app's local database of previously researched wines. Call this ONCE, with every identified wine, before doing any web searching. Wines returned as cached already have market price and ratings — do not web-search those.",
  input_schema: {
    type: "object",
    properties: {
      wines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The bottle id you assigned (b1, b2, ...)",
            },
            producer: { type: ["string", "null"] },
            wineName: { type: ["string", "null"] },
            vintage: { type: ["string", "null"] },
          },
          required: ["id"],
        },
      },
    },
    required: ["wines"],
  },
} as const;

interface CacheLookupInput {
  wines: {
    id: string;
    producer?: string | null;
    wineName?: string | null;
    vintage?: string | null;
  }[];
}

function extractJson(text: string): AnalysisResult {
  try {
    return JSON.parse(text) as AnalysisResult;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as AnalysisResult;
    }
    throw new Error("Model response did not contain valid JSON");
  }
}

// Store freshly researched wines; entries that came from the cache keep
// their original timestamp by being skipped (their keys are in hitKeys).
async function writeBackCache(data: AnalysisResult, hitKeys: Set<string>) {
  if (!cacheEnabled()) return;
  const now = new Date().toISOString();
  await Promise.all(
    data.bottles
      .filter(
        (b) =>
          b.identified &&
          (b.producer || b.wineName) &&
          (b.marketPrice || b.ratings.length > 0)
      )
      .map((b) => {
        const key = wineKey(b.producer, b.wineName, b.vintage);
        if (hitKeys.has(key)) return Promise.resolve();
        const entry: WineCacheEntry = {
          producer: b.producer,
          wineName: b.wineName,
          vintage: b.vintage,
          region: b.region,
          grapeVariety: b.grapeVariety,
          wineType: b.wineType,
          marketPrice: b.marketPrice,
          marketPriceSource: b.marketPriceSource?.replace(/ \(cached\)$/i, "") ?? null,
          ratings: b.ratings,
          fetchedAt: now,
        };
        return cacheSet(key, entry);
      })
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzeRequest;
  if (!body?.image || !body?.mediaType) {
    return Response.json({ error: "Missing image" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      // Heartbeat so proxies don't drop the connection during long thinking spans.
      const heartbeat = setInterval(() => send({ type: "ping" }), 15000);

      try {
        const client = new Anthropic();
        const withCache = cacheEnabled();
        const cacheHitKeys = new Set<string>();

        // Cost controls: Sonnet 5 at medium effort is near-Opus on this
        // workload at a fraction of the price. Override via env if needed.
        const MODEL = process.env.ANALYSIS_MODEL ?? "claude-sonnet-5";
        const EFFORT = process.env.ANALYSIS_EFFORT ?? "medium";
        // Server-side refusal fallbacks are an Opus 5 / Fable 5 feature.
        const useFallbacks =
          MODEL.startsWith("claude-opus-5") || MODEL.startsWith("claude-fable-5");

        const messages: Anthropic.Beta.BetaMessageParam[] = [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: body.mediaType,
                  data: body.image,
                },
              },
              {
                type: "text",
                text: buildPrompt(body, withCache),
                // Pin a cache breakpoint after the image + instructions so
                // every search-round continuation re-reads them at ~10% cost.
                cache_control: { type: "ephemeral" },
              } as unknown as Anthropic.Beta.BetaTextBlockParam,
            ],
          },
        ];

        // Hard API-level ceilings — even a 100-bottle photo cannot exceed
        // these regardless of what the model decides.
        const tools: unknown[] = [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_RESEARCH,
          },
          {
            type: "web_fetch_20260209",
            name: "web_fetch",
            max_uses: 3,
            max_content_tokens: 6000,
          },
        ];
        if (withCache) tools.push(cacheLookupTool);

        const makeParams = (withFormat: boolean) =>
          ({
            model: MODEL,
            max_tokens: 32000,
            ...(useFallbacks
              ? {
                  betas: ["server-side-fallback-2026-07-01"],
                  fallbacks: "default",
                }
              : {}),
            tools,
            // Auto-cache the newest conversation tail so each continuation
            // (search rounds, cache-tool round trips) reuses the prior prefix.
            cache_control: { type: "ephemeral" },
            output_config: withFormat
              ? {
                  effort: EFFORT,
                  format: { type: "json_schema", schema: analysisJsonSchema },
                }
              : { effort: EFFORT },
            messages,
          }) as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming;

        send({ type: "status", message: "Looking at your photo…" });

        let useFormat = true;
        let final: Anthropic.Beta.BetaMessage | null = null;

        // The loop handles three continuation cases: pause_turn from the
        // server-side search tools, tool_use for our cache-lookup tool, and
        // a one-time retry without structured outputs.
        for (let turn = 0; turn < 16 && !final; turn++) {
          let response: Anthropic.Beta.BetaMessage;
          try {
            const s = client.beta.messages.stream(makeParams(useFormat));
            s.on("streamEvent", (event: any) => {
              if (event.type !== "content_block_start") return;
              const block = event.content_block;
              if (block?.type === "server_tool_use") {
                send({
                  type: "status",
                  message:
                    block.name === "web_search"
                      ? "Searching the web for prices and ratings…"
                      : "Reading a web page…",
                });
              } else if (
                block?.type === "tool_use" &&
                block.name === "wine_cache_lookup"
              ) {
                send({ type: "status", message: "Checking the wine database…" });
              }
            });
            response = await s.finalMessage();
          } catch (err: any) {
            // If structured outputs conflicts with something in this request
            // (e.g. citations from web search on some API versions), retry
            // once without the format constraint and parse the JSON manually.
            if (
              useFormat &&
              err?.status === 400 &&
              /output_config|output_format|citation|format/i.test(
                String(err?.message ?? "")
              )
            ) {
              useFormat = false;
              continue;
            }
            throw err;
          }

          if (response.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: response.content });
            send({ type: "status", message: "Still researching…" });
            continue;
          }

          if (response.stop_reason === "tool_use") {
            messages.push({ role: "assistant", content: response.content });
            const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
            for (const block of response.content) {
              if (block.type !== "tool_use") continue;
              if (block.name === "wine_cache_lookup") {
                const input = block.input as CacheLookupInput;
                const wines = Array.isArray(input?.wines) ? input.wines : [];
                const keyByWine = wines.map((w) => ({
                  w,
                  key: wineKey(w.producer, w.wineName, w.vintage),
                }));
                const found = await cacheGetMany(keyByWine.map((k) => k.key));
                const results = keyByWine.map(({ w, key }) => {
                  const entry = found.get(key);
                  if (entry) cacheHitKeys.add(key);
                  return entry
                    ? { id: w.id, cached: true, ...entry }
                    : { id: w.id, cached: false };
                });
                send({
                  type: "status",
                  message: `Wine database: ${results.filter((r) => r.cached).length} of ${results.length} already known…`,
                });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({ results }),
                });
              } else {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Unknown tool: ${block.name}`,
                  is_error: true,
                });
              }
            }
            messages.push({ role: "user", content: toolResults });
            continue;
          }

          final = response;
        }

        if (!final) {
          throw new Error("Analysis did not complete in time — please retry.");
        }

        if (final.stop_reason === "refusal") {
          send({
            type: "error",
            message:
              "The analysis was declined by the model's safety system. Please try a different photo.",
          });
          return;
        }

        const text = final.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        const data = extractJson(text);
        send({ type: "result", data });

        await writeBackCache(data, cacheHitKeys);
      } catch (err: any) {
        console.error("analyze failed:", err);
        send({
          type: "error",
          message:
            err?.status === 401
              ? "Server is missing a valid ANTHROPIC_API_KEY."
              : err?.message || "Analysis failed. Please try again.",
        });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
