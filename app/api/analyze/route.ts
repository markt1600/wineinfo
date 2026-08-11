import Anthropic from "@anthropic-ai/sdk";
import { analysisJsonSchema, type AnalysisResult } from "@/lib/schema";
import { readSession } from "@/lib/auth";
import { saveScan } from "@/lib/galleryStore";
import { buildScanCaption } from "@/lib/totals";
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
    : `If the photo shows prices (shelf tags or a menu), determine the currency from symbols, language, formatting, and any location clues (tax wording like "KDV" implies Turkey/TRY, "TVA" France/EUR, etc.). Beware ambiguous symbols: a bare "$" could be USD, CAD, AUD, NZD, SGD and more — treat the currency as unknown unless the language, retailer branding, tax notes, price formatting, or other context pins down the country. When the currency is not reasonably certain, set currency.needsUserInput to true, leave listedPrice amounts as the printed numbers with currency "UNK", and do NOT make value-for-money judgements — explain in the summary that the currency must be confirmed first.`;

  const cacheNote = withCache
    ? `
Wine database (cache):
- This app keeps a local database of wines it has already researched. After identifying the wines in the photo and BEFORE any web searching, you MUST call the wine_cache_lookup tool ONCE with ALL identified wines. Never start web searching without checking the cache first.
- When calling wine_cache_lookup, pass the producer and wine name exactly as printed on the label or price tag — do not expand, translate, or canonicalize them. Repeat scans of the same label must generate the same lookup.
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

venue: for wine_menu scenes, look for the venue's name printed on the menu itself — header, logo, footer, watermark — and set "venue" to it (e.g. "Le Bernardin", "The Oak Room Bar"). Set null when no venue name is visible or the scene is not a menu. Never guess a venue from the wines alone.

For every DISTINCT wine you can see (bottle or menu line item), create ONE entry in "bottles":
- One entry per distinct wine, not per physical bottle: shelves often hold several identical bottles of the same wine (multiple facings). Box the clearest bottle for that wine, and when there are multiple facings mention the count in notes (e.g. "3 facings on shelf"). Never research the same wine more than once.
- Give it a short id ("b1", "b2", ...).
- boundingBox: the pixel coordinates of the bottle (or the menu line) in the submitted image, top-left origin. Coordinates map 1:1 to the image pixels. Provide a box for every entry you can locate visually; use null only if you truly cannot localize it. BE PRECISE: the box must tightly enclose that specific bottle — left and right edges at the glass edges of THAT bottle, top at the top of the foil/cork, bottom at the base. In tight lineups it is easy to drift one bottle over: before finalizing, re-examine every box against the image and correct any box that is offset onto a neighboring bottle, too narrow, or misaligned. Boxes of adjacent bottles must not substantially overlap.
- Read the label or menu text carefully (producer, cuvée, vintage, appellation).
- region MUST capture the most specific place name available, not just the broad country/region. Wine menus usually nest wines under subheaders — a "Burgundy" page split into "Nuits-Saint-Georges", "Gevrey-Chambertin", etc. (same for Bordeaux communes, Rhône appellations, Barolo/Barbaresco/Montalcino) — so track the innermost subheader a line sits under and set region like "Nuits-Saint-Georges, Burgundy, France", never the coarse page heading alone. On bottles, use the appellation printed on the label. A menu line often has no distinguishing wine name (just "Maison Leroy 2017"), and the appellation is then the only thing separating bottlings that differ 10x+ in price — carry it into the region field AND into the price search.
- bottleSizeML: the bottle size in mL when discernible from the bottle shape, label, or tag text (375, 750, 1500, 3000); use 750 when standard or unclear. marketPriceEstimated: false unless you had to approximate the market price rather than find it.
- PRICE TAGS ARE A FIRST-CLASS IDENTIFICATION SOURCE: in stores, shelf price tags usually print the wine's name, size, and price — often more legibly than the bottle. When a bottle is lying down, angled, or its label is unreadable, identify the wine from the price tag nearest to it (tags normally sit directly below or beside their bottles — match by position). Combine tag text with whatever is visible on the bottle. The tag is also the authoritative source for listedPrice.
- Set identified=true only when you are reasonably confident of the specific wine (producer + wine). Partial reads where the wine cannot be pinned down are identified=false.
${cacheNote}
For each IDENTIFIED wine, use web search to find:
- Typical current retail market price (prefer Wine-Searcher average or comparable aggregate; note the source). Include the appellation in the query whenever you read one (label, tag, or menu subheader) — producers often sell bottlings from several appellations at wildly different prices (a Burgundy négociant's wines can span $300 to $30,000 for the same vintage), and the appellation is frequently the only thing that tells them apart. NEVER use a restaurant's or bar's own wine-list price as the market price — those carry the very markup this app measures. Only independent retail, wholesale, or auction listings count; if that's all you can find, leave marketPrice null rather than pass a menu price off as market. This app's home market is Singapore: by DEFAULT prefer Singapore retailers (millesima.sg and sg.cruworldwine.com are authoritative first stops), then Hong Kong retailers (the nearest comparable fine-wine hub), then the international average — including for bottle photos with no visible prices. Report a price sourced from an SG listing in SGD as found, rather than converting it. Prices can differ 2x+ between markets, so the market matters as much as the number. Only when the photo's prices are clearly in another market's currency (GBP menu → UK, EUR → that country, …) prefer that market's retailers instead, falling back to the international average.
- Ratings: STRONGLY prefer Vivino and CellarTracker community scores — try to find at least one of those two for every identified wine. Only fall back to critic scores (Wine Spectator, Wine Advocate, etc.) when neither Vivino nor CellarTracker has a rating for the wine. Prefer the rating for the EXACT vintage shown in the photo; if no rating exists for that vintage, the wine's general (all-vintage) rating or a nearby vintage's rating is acceptable — set vintageMatch=false on such ratings and true only when the rating matches the pictured vintage. Include the source name and score; include a URL when you have one.
Be economical with research: at most ONE web search per identified wine — a single query like "<producer> <wine> <vintage> price rating" usually returns the market price and a Vivino/CellarTracker score together in the result snippets. Use web_fetch only when the snippets genuinely don't contain the number you need. Never search for unidentified bottles, and don't re-verify data you already have.

Research budget: research at most ${MAX_RESEARCH} wines in this photo. If more are identified, prioritize (1) wines with listed prices (needed for the value comparison), (2) the most prominent bottles, (3) likely best-value candidates. For identified wines beyond the budget, set marketPrice to null and ratings to [] and note "not researched — photo has many bottles" in their notes. If the photo shows more than 30 bottles or menu lines, include the 30 most legible as entries and mention the remainder in the summary.

Prices and value:
- listedPrice: the price printed in the photo for that bottle/menu line, if any.
${currencyNote}
- If the scene is shelf_with_prices or wine_menu AND the currency is known: compare each listed price against the wine's market price (convert currencies approximately if needed). Set priceDeltaPct = ((listed − market) / market) × 100 rounded to a whole number — positive means marked up over market, negative means discounted (use the currency-converted values; null when either price is missing or the currency is unconfirmed). Also write a short valueAssessment (e.g. "listed 20% below typical retail — good value" or "3.2x retail markup — typical restaurant pricing"). Then pick the single best value-for-money entry and put its id in bestValue.bottleId with your reasoning. Consider quality (ratings) as well as price ratio — a slightly worse ratio on a much better-rated wine can still be the best value.
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

// Quick pre-analysis check: is this a priced scene, and is the currency
// obvious? Runs without search tools at low effort, so it costs ~a cent —
// far cheaper than discovering mid-research that the user must be asked.
const precheckSchema = {
  type: "object",
  properties: {
    sceneType: {
      type: "string",
      enum: [
        "single_bottle",
        "bottle_group",
        "shelf_with_prices",
        "wine_menu",
        "other",
      ],
    },
    hasVisiblePrices: { type: "boolean" },
    currencyCode: { type: ["string", "null"] },
    currencyConfident: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: [
    "sceneType",
    "hasVisiblePrices",
    "currencyCode",
    "currencyConfident",
    "reasoning",
  ],
  additionalProperties: false,
} as const;

const PRECHECK_PROMPT = `Quickly examine this photo of wine. Do NOT research anything — just answer:
- sceneType: single_bottle | bottle_group | shelf_with_prices | wine_menu | other
- hasVisiblePrices: are prices visible (shelf tags or menu prices)?
- currencyCode + currencyConfident: if prices are visible, which ISO 4217 currency are they in, and is that determination confident? A bare "$" is ambiguous (USD, CAD, AUD, NZD, SGD…) — be confident only when language, tax wording (KDV→TRY, TVA→EUR…), distinctive symbols (₺, €, £, ¥), price formatting, or other context pins down the country.
- reasoning: one short sentence explaining the currency determination.
Respond with a single JSON object only.`;

interface CacheLookupInput {
  wines: {
    id: string;
    producer?: string | null;
    wineName?: string | null;
    vintage?: string | null;
  }[];
}

// The schema uses "" instead of null for ratings[].url and valueAssessment
// (the API caps union-typed schema parameters at 16) — restore nulls here so
// the rest of the app keeps its string|null contract.
function normalizeResult(result: AnalysisResult): AnalysisResult {
  for (const b of result.bottles ?? []) {
    if (!b.valueAssessment) b.valueAssessment = null;
    for (const r of b.ratings ?? []) {
      if (!r.url) r.url = null;
    }
  }
  return result;
}

function extractJson(text: string): AnalysisResult {
  try {
    return normalizeResult(JSON.parse(text) as AnalysisResult);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return normalizeResult(
        JSON.parse(text.slice(start, end + 1)) as AnalysisResult
      );
    }
    throw new Error("Model response did not contain valid JSON");
  }
}

// Store freshly researched wines. Each entry is written under BOTH the
// canonical key (post-research names) AND the key the model used when it
// looked the wine up pre-research (as-printed label names) — repeat scans
// of the same photo regenerate the lookup key, so that alias is what makes
// cache hits actually happen. Wines that came from the cache are skipped
// so they keep their original research timestamp.
async function writeBackCache(
  data: AnalysisResult,
  hitKeys: Set<string>,
  lookupKeyByBottleId: Map<string, string>
) {
  if (!cacheEnabled()) return;
  const now = new Date().toISOString();
  const writes: Promise<void>[] = [];
  let written = 0;
  for (const b of data.bottles) {
    if (
      !b.identified ||
      (!b.producer && !b.wineName) ||
      (!b.marketPrice && b.ratings.length === 0)
    )
      continue;
    const canonicalKey = wineKey(b.producer, b.wineName, b.vintage);
    const lookupKey = lookupKeyByBottleId.get(b.id);
    const keys = [...new Set([canonicalKey, lookupKey].filter(Boolean))] as string[];
    // A hit on any of its keys means this bottle's data came from the
    // cache — don't rewrite (would refresh the timestamp on stale data).
    if (keys.some((k) => hitKeys.has(k))) continue;
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
    for (const k of keys) {
      written++;
      writes.push(cacheSet(k, entry));
    }
  }
  await Promise.all(writes);
  console.log(`wine cache: wrote ${written} keys`);
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
        // bottle id → the cache key the model looked it up under, so the
        // write-back can alias researched data to the as-printed name too.
        const lookupKeysByBottleId = new Map<string, string>();

        // Cost controls: Sonnet 5 at medium effort is near-Opus on this
        // workload at a fraction of the price. Override via env if needed.
        const MODEL = process.env.ANALYSIS_MODEL ?? "claude-sonnet-5";
        const EFFORT = process.env.ANALYSIS_EFFORT ?? "medium";
        // Server-side refusal fallbacks are an Opus 5 / Fable 5 feature.
        const useFallbacks =
          MODEL.startsWith("claude-opus-5") || MODEL.startsWith("claude-fable-5");

        const imageBlock = {
          type: "image",
          source: {
            type: "base64",
            media_type: body.mediaType,
            data: body.image,
          },
        } as const;

        // Currency pre-check: when no hint was provided, look at the photo
        // cheaply first. If it's a priced scene with an unclear currency,
        // ask the user BEFORE spending anything on research.
        if (!body.currencyHint) {
          send({ type: "status", message: "Checking for prices and currency…" });
          send({ type: "progress", pct: 3 });
          try {
            const pre = await (client.beta.messages.create as any)({
              model: MODEL,
              max_tokens: 1000,
              output_config: {
                effort: "low",
                format: { type: "json_schema", schema: precheckSchema },
              },
              messages: [
                {
                  role: "user",
                  content: [imageBlock, { type: "text", text: PRECHECK_PROMPT }],
                },
              ],
            });
            if (pre.stop_reason !== "refusal") {
              const preText = pre.content
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("");
              const info = JSON.parse(preText);
              if (info.hasVisiblePrices && !info.currencyConfident) {
                send({
                  type: "needs_currency",
                  reasoning: info.reasoning ?? "",
                });
                return; // client asks the user, then re-calls with the hint
              }
            }
          } catch (err) {
            // Pre-check is best-effort — on any failure just run the full
            // analysis, which still handles unknown currencies safely.
            console.error("currency precheck failed:", err);
          }
        }

        const messages: Anthropic.Beta.BetaMessageParam[] = [
          {
            role: "user",
            content: [
              imageBlock,
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
        send({ type: "progress", pct: 5 });

        // Approximate progress: exact once the cache lookup reveals how many
        // wines need research, heuristic before that.
        let searchesDone = 0;
        let expectedSearches: number | null = null;
        const sendProgress = () => {
          const pct =
            expectedSearches && expectedSearches > 0
              ? 20 + Math.min(1, searchesDone / expectedSearches) * 70
              : Math.min(85, 15 + searchesDone * 10);
          send({ type: "progress", pct: Math.round(pct) });
        };

        let useFormat = true;
        let final: Anthropic.Beta.BetaMessage | null = null;

        // The loop handles three continuation cases: pause_turn from the
        // server-side search tools, tool_use for our cache-lookup tool, and
        // a one-time retry without structured outputs.
        for (let turn = 0; turn < 16 && !final; turn++) {
          let response: Anthropic.Beta.BetaMessage;
          try {
            const s = client.beta.messages.stream(makeParams(useFormat));
            // Accumulate each server tool call's streamed input so the
            // status can say WHAT is being searched/read, not just that
            // something is.
            const toolBlocks = new Map<number, { name: string; json: string }>();
            s.on("streamEvent", (event: any) => {
              if (event.type === "content_block_start") {
                const block = event.content_block;
                if (block?.type === "server_tool_use") {
                  toolBlocks.set(event.index, { name: block.name, json: "" });
                  if (block.name === "web_search") {
                    searchesDone++;
                    sendProgress();
                    send({
                      type: "status",
                      message: "Searching the web for prices and ratings…",
                    });
                  } else {
                    send({ type: "status", message: "Reading a web page…" });
                  }
                } else if (
                  block?.type === "tool_use" &&
                  block.name === "wine_cache_lookup"
                ) {
                  send({ type: "status", message: "Checking the wine database…" });
                }
              } else if (
                event.type === "content_block_delta" &&
                event.delta?.type === "input_json_delta"
              ) {
                const b = toolBlocks.get(event.index);
                if (b) b.json += event.delta.partial_json ?? "";
              } else if (event.type === "content_block_stop") {
                const b = toolBlocks.get(event.index);
                if (!b) return;
                toolBlocks.delete(event.index);
                try {
                  const input = JSON.parse(b.json || "{}");
                  if (b.name === "web_search" && input.query) {
                    send({
                      type: "status",
                      message: `🔎 Researching: ${input.query}`,
                    });
                  } else if (b.name === "web_fetch" && input.url) {
                    const host = new URL(input.url).hostname.replace(/^www\./, "");
                    send({ type: "status", message: `📖 Reading ${host}…` });
                  }
                } catch {
                  /* input still partial — skip the detailed status */
                }
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
                for (const { w, key } of keyByWine) {
                  lookupKeysByBottleId.set(w.id, key);
                }
                const found = await cacheGetMany(keyByWine.map((k) => k.key));
                const results = keyByWine.map(({ w, key }) => {
                  const entry = found.get(key);
                  if (entry) cacheHitKeys.add(key);
                  return entry
                    ? { id: w.id, cached: true, ...entry }
                    : { id: w.id, cached: false };
                });
                // Misses = wines still needing web research → progress
                // estimates become accurate from here on.
                expectedSearches = results.filter((r) => !r.cached).length;
                sendProgress();
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
        await writeBackCache(data, cacheHitKeys, lookupKeysByBottleId);

        // Fire-and-forget: persist the scan server-side BEFORE replying, so
        // the result survives even if the user already closed the tab. The
        // photo doubles as the feed thumbnail until the browser renders the
        // summary card and replaces it (via replaceId).
        // Photos with zero identified bottles don't enter history at all.
        let scanId: string | null = null;
        if (data.bottles.some((b) => b.identified)) {
          try {
            const session = readSession(request.headers.get("cookie"));
            const saved = await saveScan({
              photoBytes: Buffer.from(body.image, "base64"),
              result: data,
              caption: buildScanCaption(data),
              sceneType: data.sceneType,
              postedBy: session?.displayName ?? "Guest",
              username: session?.username ?? "guest",
            });
            scanId = saved?.id ?? null;
          } catch (err) {
            console.error("server-side scan save failed:", err);
          }
        }

        send({ type: "progress", pct: 100 });
        send({ type: "result", data, scanId });
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
