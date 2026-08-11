---
name: menu-import
description: Turn a restaurant wine menu (PDF or photos) into a wine-import CSV for the Wine (a)ID admin page. Parses every bottle-format wine, researches market prices, and outputs a CSV that seeds the Redis wine cache and the Restaurants tab.
---

# Menu → wine-import CSV

Convert a restaurant/bar wine menu into `wine-import.csv`, ready for upload
at `/admin` → "📥 Import wines" on the deployed Wine (a)ID app. The import
seeds the wine cache and the venue's page in the Restaurants tab — it never
creates scan-history or gallery entries.

## Inputs (ask the user if missing)

1. The menu file(s): PDF or photos.
2. **Venue name** (e.g. "CUT by Wolfgang Puck") — use the name printed on
   the menu if obvious.
3. **Currency** of the listed prices (e.g. SGD). Never guess a bare "$".
4. Menu date (default: today, YYYY-MM-DD).

## Scope rules

- Include every **bottle-format** listing: standard bottles, **half
  bottles (375 ml)**, large formats (1.5 L / 3 L), and the *bottle* price
  column on by-the-glass pages.
- **Ignore** glass/carafe pours and anything under 375 ml.
- One row per distinct (wine, vintage, size). If the same wine+vintage+size
  appears twice (e.g. Coravin page and main list), keep the lower price.

## Pipeline

1. **Extract text**: for PDFs use `pypdf`/`pdfplumber` (pip install if
   needed); fall back to reading pages visually or OCR for scans.
2. **Parse** every wine line into JSON rows:
   `{id, producer, wineName, vintage, sizeML, listedPrice, grape, wineType,
   region, menuRating}`.
   - Wine type from section headers (Champagne→sparkling, Rosé, White,
     Red, Sweet/Fortified). Region from section headers when per-line
     regions are absent.
   - Vintage: keep the year; NV/MV → empty.
   - Sizes: page context (Half Bottle / Large Format pages) plus inline
     "(375ml)" style markers; default 750.
   - Menus often print critic scores — map the codes and keep them as
     ratings with `vintageMatch=true`: WA→Wine Advocate, RP→Robert Parker,
     WE→Wine Enthusiast, JS→James Suckling, VI→Vinous, BH→Burghound,
     WS→Wine Spectator, DC→Decanter, JD→Jeb Dunnuck, JM→Jasper Morris,
     JH→James Halliday. Unknown codes: keep the code as the source.
   - Prefer a small Python parser + manual spot-checks; print per-page
     counts and skipped lines, and fix the stragglers by hand.
3. **Research market prices.** Split the rows into batches of ~50 and
   launch parallel subagents (Agent tool, `general-purpose`), each
   returning ONLY a JSON array `[{id, usd, src, note?}]`:
   - Typical international retail (Wine-Searcher-style average, ex-tax)
     for that exact wine, vintage, and size.
   - Well-known current releases may be priced from model knowledge
     (`src: "knowledge"`); anything expensive (≥ ~US$1000), pre-2005, or
     uncertain MUST be verified with a web search (`src: "web:<domain>"`).
     Cap ~30 searches per agent, spending them on the priciest bottles.
     On smaller models, verify more and trust knowledge less.
   - Unfindable → `usd: null`.
   - 375/1500 ml: real format price if known, else scale the 750 ml price
     (×0.55 / ×2.2) and set `note: "scaled"`.
4. **Convert** to the menu's currency (one web search for the FX rate) so
   listed-vs-market percentages compute.
5. **Build the CSV** with exactly these columns (loose header matching,
   but use these names — see `public/wine-import-template.csv`):

   ```
   producer,wineName,vintage,region,grapeVariety,wineType,
   marketPrice,currency,marketPriceSource,
   rating1Source,rating1Score,rating1VintageMatch,rating1Url,
   rating2Source,rating2Score,rating2VintageMatch,rating2Url,
   aliases,venue,listedPrice,listedCurrency,menuDate,sizeML
   ```

   - `currency` = the menu currency (market price already converted).
   - `marketPriceSource`: the verifying domain, or
     "Claude estimate (<month year>)" for knowledge prices — label
     honestly, and append ", scaled by size" where scaled.
   - `aliases`: only needed when the canonical name differs from what the
     menu prints (`producer|wineName|vintage`, `;`-separated).
   - Same `venue`, `listedCurrency`, `menuDate` on every row.
6. **Validate**: `npx --yes tsx -e` calling `csvToWineEntries` from
   `lib/wineImportCsv.ts` on the file — 0 errors, row count matches.
7. **Deliver** the CSV to the user (SendUserFile or the working
   directory) with a short summary: wine count, how many verified vs
   estimated vs unpriced, biggest discounts found. Tell them to upload it
   at `/admin` → enter PIN → "Import wines". Batches of 100 are handled
   by the page automatically.
