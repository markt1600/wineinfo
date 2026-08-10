import Anthropic from "@anthropic-ai/sdk";
import { analysisJsonSchema, type AnalysisResult } from "@/lib/schema";

// Web-search-heavy Fable 5 turns can run for minutes; give the function room.
export const maxDuration = 300;
export const runtime = "nodejs";

interface AnalyzeRequest {
  image: string; // base64, no data: prefix
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  currencyHint?: string; // ISO 4217 code confirmed by the user
}

function buildPrompt(req: AnalyzeRequest): string {
  const currencyNote = req.currencyHint
    ? `The user has confirmed that any prices shown in this photo are in ${req.currencyHint}. Use that currency for all listed prices and value comparisons; set currency.code to "${req.currencyHint}", detected to true, and needsUserInput to false.`
    : `If the photo shows prices (shelf tags or a menu), determine the currency from symbols, language, formatting, and any location clues. If you cannot determine it with reasonable confidence, set currency.needsUserInput to true, leave listedPrice amounts as the printed numbers with currency "UNK", and do NOT make value-for-money judgements — explain in the summary that the currency must be confirmed first.`;

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

For each IDENTIFIED wine, use web search to find:
- Typical current retail market price (prefer Wine-Searcher average or comparable aggregate; note the source).
- Ratings: STRONGLY prefer Vivino and CellarTracker community scores — try to find at least one of those two for every identified wine. Only fall back to critic scores (Wine Spectator, Wine Advocate, etc.) when neither Vivino nor CellarTracker has a rating for the wine. Prefer the rating for the EXACT vintage shown in the photo; if no rating exists for that vintage, the wine's general (all-vintage) rating or a nearby vintage's rating is acceptable — set vintageMatch=false on such ratings and true only when the rating matches the pictured vintage. Include the source name and score; include a URL when you have one.
Search efficiently: one or two searches per identified wine is usually enough. For unidentified bottles, skip searching.

Prices and value:
- listedPrice: the price printed in the photo for that bottle/menu line, if any.
${currencyNote}
- If the scene is shelf_with_prices or wine_menu AND the currency is known: compare each listed price against the wine's market price (convert currencies approximately if needed) and write a short valueAssessment (e.g. "listed 20% below typical retail — good value" or "3.2x retail markup — typical restaurant pricing"). Then pick the single best value-for-money entry and put its id in bestValue.bottleId with your reasoning. Consider quality (ratings) as well as price ratio — a slightly worse ratio on a much better-rated wine can still be the best value.
- If there are no listed prices, or the currency is unconfirmed, set bestValue.bottleId to null.

Finish with a concise, friendly summary (2-4 sentences) of what you found.

Your final answer must be a single JSON object matching the required schema — no prose outside the JSON.`;
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

        let messages: Anthropic.Beta.BetaMessageParam[] = [
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
              { type: "text", text: buildPrompt(body) },
            ],
          },
        ];

        const tools = [
          { type: "web_search_20260209", name: "web_search", max_uses: 20 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
        ];

        // Opus 5: omitting the thinking param runs adaptive thinking. Include
        // server-side refusal fallbacks by default so a benign false-positive
        // safety decline is re-served by the recommended fallback model.
        const makeParams = (withFormat: boolean) =>
          ({
            model: "claude-opus-5",
            max_tokens: 64000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            tools,
            output_config: withFormat
              ? {
                  effort: "high",
                  format: { type: "json_schema", schema: analysisJsonSchema },
                }
              : { effort: "high" },
            messages,
          }) as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming;

        send({ type: "status", message: "Looking at your photo…" });

        let useFormat = true;
        let final: Anthropic.Beta.BetaMessage | null = null;

        // Server-tool loops can pause (stop_reason: pause_turn); resume by
        // re-sending the conversation with the assistant turn appended.
        for (let turn = 0; turn < 8 && !final; turn++) {
          let response: Anthropic.Beta.BetaMessage;
          try {
            const s = client.beta.messages.stream(makeParams(useFormat));
            s.on("streamEvent", (event: any) => {
              if (
                event.type === "content_block_start" &&
                event.content_block?.type === "server_tool_use"
              ) {
                send({
                  type: "status",
                  message:
                    event.content_block.name === "web_search"
                      ? "Searching the web for prices and ratings…"
                      : "Reading a web page…",
                });
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
            messages = [
              messages[0],
              { role: "assistant", content: response.content },
            ];
            send({ type: "status", message: "Still researching…" });
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
