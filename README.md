# 🍷 Wine Lens

A mobile-first web app for identifying wine from photos. Snap a picture with
your phone of:

- **A bottle (or group of bottles)** — each bottle is identified, with typical
  market pricing and ratings (Vivino / CellarTracker preferred, exact vintage
  when available).
- **A store shelf with price tags** — same identification, plus each listed
  price is compared against market price and the **best value** bottle is
  picked.
- **A wine menu** — menu entries are identified and compared against market
  prices to find the best value. The app detects the menu's currency; if it
  can't, it asks you to confirm the currency before making value judgements.

The analyzed photo is re-displayed with identified bottles shaded **light
green**, unidentified ones **light red**, and the best-value pick outlined in
gold. You can download the annotated image.

## How it works

- Next.js (App Router) frontend with a camera capture flow. Photos are
  downscaled client-side to Claude's high-resolution vision limit (2576 px long
  edge) so bounding-box coordinates map 1:1 to pixels.
- `/api/analyze` calls **Claude Opus 5** (`claude-opus-5`) with the
  server-side **web search** and **web fetch** tools, so the model researches
  prices (Wine-Searcher etc.) and ratings (Vivino, CellarTracker) live. To use
  Claude Fable 5 instead (higher capability, 2x the token price), change the
  `model` string in `app/api/analyze/route.ts` to `claude-fable-5`.
- Structured outputs (`output_config.format`) constrain the answer to a JSON
  schema including per-bottle pixel bounding boxes, prices, ratings, and a
  best-value verdict.
- Results stream back over server-sent events with progress updates, since a
  research-heavy request can take a few minutes.
- Server-side refusal fallbacks are enabled, so a false-positive safety decline
  is transparently re-served by Anthropic's recommended fallback model.
- **Wine database (optional but recommended):** previously researched wines
  (market price, source, ratings, variety, region, vintage) are cached in Redis
  for 30 days. Before web-searching, the model calls a `wine_cache_lookup` tool
  with every wine it identified; cache hits skip web searching entirely, which
  makes repeat lookups faster and much cheaper. Freshly researched wines are
  written back automatically. Without Redis configured, the app works normally
  and just searches every time.

## Setup

```bash
npm install
cp .env.example .env.local   # add your Anthropic API key
npm run dev
```

Open http://localhost:3000 (use your phone on the same network, or deploy, to
test the camera flow).

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (or run `vercel`).
2. Add the `ANTHROPIC_API_KEY` environment variable in the Vercel project
   settings.
3. The analyze route sets `maxDuration = 300`; make sure your Vercel plan (or
   Fluid Compute setting) allows function durations up to 300 s, since
   web-search-heavy analyses of a full shelf can take a couple of minutes.
4. **Enable the public gallery (optional):** in the project's **Storage** tab,
   also create a **Blob** store and connect it (this sets
   `BLOB_READ_WRITE_TOKEN`). With both Blob and Redis connected, analyzed
   summary cards get a "Share to public gallery" button, and the home page
   shows the most recent 48 shared cards ("Recently scanned"). Older cards are
   trimmed and their images deleted automatically, so gallery storage stays
   under ~20 MB. Sharing is opt-in per scan — nothing is published
   automatically.
5. **Enable the wine database:** in the Vercel dashboard, go to your project's
   **Storage** tab → **Create Database** → choose **Upstash for Redis** (Vercel
   Marketplace) and connect it to the project. That injects the
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` environment variables the app looks
   for, and the cache turns on automatically on the next deploy. (A Redis
   database created directly at upstash.com works too — set
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.)

## Notes

- The API key is only used server-side; the browser never sees it.
- Cost scales with photo complexity — a large shelf photo triggers one or two
  web searches per identified bottle.
