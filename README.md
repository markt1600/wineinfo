# 🍷 Wine (a)ID

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
- `/api/analyze` calls **Claude Sonnet 5** (`claude-sonnet-5`, `medium`
  effort) with the server-side **web search** and **web fetch** tools, so the
  model researches prices (Wine-Searcher etc.) and ratings (Vivino,
  CellarTracker) live. Model and effort are configurable via the
  `ANALYSIS_MODEL` / `ANALYSIS_EFFORT` env vars (e.g. `claude-opus-5` + `high`
  for maximum quality at a higher price).
- Structured outputs (`output_config.format`) constrain the answer to a JSON
  schema including per-bottle pixel bounding boxes, prices, ratings, and a
  best-value verdict.
- Results stream back over server-sent events with progress updates (live
  search queries and an approximate percentage), since a research-heavy
  request can take a few minutes.
- **Fire-and-forget:** the server saves every completed analysis (photo, full
  results, attribution, classification) before replying, so a scan survives
  even if the tab is closed mid-processing. Photos where **no bottle could be
  identified** are not saved at all — they never appear in recent scans or
  the database. The photo serves as the feed
  thumbnail until the browser renders the summary card and upgrades the entry
  in place.
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
4. **Enable scan history (optional):** in the project's **Storage** tab, also
   create a **Blob** store and connect it (this sets `BLOB_READ_WRITE_TOKEN`).
   With both Blob and Redis connected, every analyzed summary card is saved
   automatically: the home page shows the last 5 ("Recent scans", captioned
   with the wine names and total market value), and `/gallery` lists all prior
   cards with a full replay of the original analysis. History is capped at the
   newest 20 scans — older ones are trimmed and their images and analysis
   records deleted, keeping storage under ~30 MB. Note that saved cards are
   visible to everyone using your deployment.
5. **Enable the wine database:** in the Vercel dashboard, go to your project's
   **Storage** tab → **Create Database** → choose **Upstash for Redis** (Vercel
   Marketplace) and connect it to the project. That injects the
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` environment variables the app looks
   for, and the cache turns on automatically on the next deploy. (A Redis
   database created directly at upstash.com works too — set
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.)

## Editing results

Every analysis (fresh or replayed from the gallery) has an **✏️ Edit results**
tab:

- **Bottle size** (375 mL / 750 mL / 1.5 L / 3 L): pricing is refreshed for
  the corrected size — a size-specific market price is searched for, and when
  none is found the 750 mL price is scaled by volume and marked with an
  asterisk (`*` = estimated price; `†` on the summary card marks a rating from
  another vintage).
- **Misidentified** flag: the bottle turns red/unidentified, drops out of the
  best-value pick, and its wine-cache entries are purged so the bad
  identification isn't reused.
- **Tasting notes**: free-text notes per bottle ("cherry and leather,
  would buy again"), stored with the scan record and shown with the bottle's
  details on every replay. Editable any time; clearing the text removes them.
- **Venue** (menu scans): the restaurant/bar the wine list is from —
  auto-detected when the venue's name is printed on the menu itself, and
  editable here. Shown with the results and on the summary card.
- **Consumption date** (unpriced bottle lineups only): adjusts the date the
  wines were drunk — a metadata-only update, no re-analysis.

Confirming changes regenerates the summary card and updates the saved scan
record in place. Every scan stores an `eventDate` — the consumption date for
Consumed scans and the last-seen date for Seen scans (defaults to the scan
date).

## Accounts & attribution

- The app works fully in **guest mode** — signing in is optional. A login item
  sits in the nav (top bar on desktop, bottom tab bar on mobile).
- **Two sign-in options:** Google (shows as "First L." in the feed; requires
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and the
  `/api/auth/google/callback` redirect URI registered in Google Cloud), or a
  simple **username + password** account (username with duplicate check,
  password + confirmation — nothing else). Accounts are stored in the same
  Redis database; set `AUTH_SECRET` for stable session cookies.
- Every saved scan is attributed: the feed shows "Mark T. posted on Aug 11"
  (or "Guest posted on…" when not signed in).
- Scans are classified automatically: photos with prices (store shelf, menu)
  are **Seen** 👀; unpriced bottle lineups are **Consumed** 🍷. The
  classification is stored with each scan and shown in the feed.
- **My Wines** (🍇 in the nav) is each signed-in user's personal history:
  the last 5 scans by default, filterable by period (week / 30 / 60 / 90
  days / year / all time) and by Consumed / Seen / both, plus a search box
  that finds every scan containing a given wine. Results list Consumed scans
  first (newest first), then Seen, each linking to the full report. Signed-in
  users' scans are kept even after they age off the public feed (up to 500
  per user); guests' aged-out scans are deleted as before.

### Admin

A PIN-protected admin page (`/admin`, PIN via `ADMIN_PIN`) lets the owner
select and delete saved scans. The footer link to it only appears for the
owner's Google login — the account whose verified email matches `ADMIN_EMAIL`
(the page itself stays PIN-protected regardless).

## Sharing & mobile

- **Link previews:** the app ships an Open Graph card (wine bottles + the app
  name) rendered at `/opengraph-image`, so pasting the link into WhatsApp,
  iMessage, Slack, or X shows a proper preview. Set `NEXT_PUBLIC_SITE_URL` if
  the auto-detected production URL isn't right.
- **Keep your camera shots:** a photo taken with the in-app camera isn't
  stored by the browser, so the results include a **Download original
  photo** button for the full-quality capture (on Android it shows up in
  your gallery; on iOS it lands in Files → Downloads, since Apple doesn't
  let web apps write to the camera roll directly). Library picks are
  already on your phone.
- **No wine in the photo?** The app says so — with a rotating quip
  ("Did you drink too much?", "Time to open a bottle?"…).
- **Native feel on phones:** bottom tab-bar navigation with safe-area
  insets, app icons and a web manifest (installable via "Add to Home Screen"
  as a standalone app), no tap-highlight flashes or accidental
  text-selection, and iOS-calibrated input sizes that avoid focus zoom.

## Cost controls

Several measures keep per-photo Claude costs low (roughly $0.10–0.30 for a
typical multi-bottle photo, less for a single bottle):

- **Prompt caching** — every web-search round re-reads the photo, instructions,
  and prior research from the cache at ~10% of the normal input price instead
  of re-billing it in full.
- **Sonnet 5 at medium effort** by default — near-Opus quality on this
  workload at a fraction of the price. Raise via `ANALYSIS_MODEL` /
  `ANALYSIS_EFFORT` if you want maximum quality.
- **Search discipline** — the model is instructed to run at most one search
  per identified wine; searches are capped at 8 and page fetches at 3 (max
  6,000 tokens per fetched page).
- **The Redis wine cache** — wines seen before skip web research entirely, so
  repeat scans of the same shelf or list are the cheapest of all. Enable it
  (see Deploy step 5) for the biggest ongoing savings.
- The API key is only used server-side; the browser never sees it.
