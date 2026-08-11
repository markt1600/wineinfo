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
   region, appellation, menuRating}`.
   - Wine type from section headers (Champagne→sparkling, Rosé, White,
     Red, Sweet/Fortified).
   - **`region` MUST capture the most specific place name available, not
     just the broad country/region.** Long wine lists are usually
     grouped in nested subheaders — e.g. a "Burgundy" page broken into
     sub-sections like "Nuits-Saint-Georges", "Gevrey-Chambertin",
     "Chambolle-Musigny" (same pattern for Bordeaux communes — Pauillac,
     Pomerol, Margaux — Rhône appellations — Côte-Rôtie, Hermitage,
     Châteauneuf-du-Pâpe — and Italian sub-DOCGs — Barolo, Barbaresco,
     Montalcino). Track the CURRENT innermost subheader as you walk the
     page and set both `region` (full, e.g. "Nuits-Saint-Georges,
     Burgundy, France") and `appellation` (just the specific place, e.g.
     "Nuits-Saint-Georges") on every wine under it — not the coarse
     page-level region alone. **This is not cosmetic: it's the #1 cause
     of wrong prices.** A wine line often has no distinguishing name at
     all (just "Maison Leroy 2017"), and Burgundy négociants/domaines
     routinely sell wines from a dozen+ different appellations at prices
     ranging from ~$300 to $30,000+ for the same vintage — the
     appellation is frequently the ONLY thing that tells two bottlings
     from the same producer apart. A first CUT-menu import skipped this
     and priced several wines against the wrong appellation entirely
     (one showed $4,800 in the database against a Nuits-Saint-Georges
     bottling worth ~$2,150) — always carry the subheader through.
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
3. **Research market prices — full web verification, every wine, no
   exceptions, via bounded retry waves.** A single Claude Code session
   has a hard, non-refilling WebSearch budget shared across the whole
   session (main thread + every subagent it ever spawns) — for a
   1000-wine menu that budget runs out long before every wine is
   searched, no matter how the work is batched. Logging out/in does
   **not** reset it (same underlying session). The only real reset is a
   brand-new session. Work with this constraint using iterative waves,
   not one giant fan-out:

   - **Wave size: ≤10 concurrent subagents**, each covering **15-20
     wines**. This matters — a first attempt at 18-38 concurrent
     subagents starved each other for the shared budget and left most
     batches half-done; dropping to 10 concurrent batches of ~20 wines
     roughly doubled the wines verified per wave. Concurrency itself is
     also capped by the platform (commonly 20 subagents at once) —
     requesting more than that fails outright rather than queuing, so
     staying at ≤10 leaves headroom.
   - Each subagent's prompt: search EVERY wine in its batch via
     `WebSearch` (no memory-only pricing), try ≥2 phrasings before
     giving up on one, and — critically — **distinguish exhaustion from
     absence**: if the WebSearch tool itself refuses to run (budget/quota
     exhausted), stop immediately, say so in a leading sentence, and mark
     only the untried ids `null` with a note **containing the literal
     word "budget"**. If a wine was actually searched and genuinely has
     no listings, mark it `null` with a note that does NOT mention
     budget (e.g. "no listings found", "producer unidentifiable"). This
     distinction is what makes retrying efficient — see below.
   - **Always include the `appellation` in every search query when the
     wine has one set** (e.g. `"Maison Leroy Nuits-Saint-Georges 2017
     price"`, not just `"Maison Leroy 2017 price"`) — never search on
     producer+vintage alone when the wine sits under a nested regional
     subheader. Batch prompts should carry the appellation alongside each
     wine's producer/wineName/vintage so the subagent has it up front.
     Dropping the appellation is how the CUT/Maison Leroy mispricing
     happened (see the `region`/`appellation` note in step 2) — a producer
     with no distinguishing `wineName` is otherwise ambiguous between
     bottlings that can differ by 10x in price.
   - Typical international retail (Wine-Searcher-style average, ex-tax)
     for that exact wine, vintage, and size. 375/1500 ml: search the
     specific format first; fall back to scaling the 750 ml price
     (×0.55 / ×2.2, `note: "scaled"`) only when a dedicated search for
     that format turns up nothing.
   - **Prefer retailers in the venue's own market** — the menu currency
     tells you which market that is (SGD → Singapore, GBP → UK, …). When
     comparable listings exist (same wine, vintage, size), a local
     retailer's price beats a foreign one: the diner's realistic
     alternative to the menu price is the local shop, not a Paris
     cellar, and wine prices can differ 2x+ between markets (a 1971
     Barolo averaged $1,571 in the US vs ~$867 in the UK). Add a
     market-qualified query phrasing (e.g. `"<wine> price Singapore"`)
     among the attempts, and note the market in `note` when a local
     listing was used. **For Singapore venues the fallback ladder is:
     Singapore retailers → Hong Kong retailers → international
     average** (HK is the nearest comparable fine-wine hub, so its
     retail pricing tracks what a Singapore buyer realistically pays
     better than a US or European number). For other markets: local →
     international. Never skip a wine just because the local market has
     none — always fall through the ladder.
   - **NEVER use a restaurant's or bar's own wine-list price as the
     market price** — those already carry the very markup the app is
     measuring, so using one silently corrupts the listed-vs-market
     delta. Only independent retail, wholesale, or auction listings
     count. If the only search hit is some other restaurant's wine list
     (this really happens for rare cuvées — a CUT import once stored
     $187 for a ~$55 wine because the sole hit was another restaurant's
     list), keep searching other phrasings, and if nothing independent
     turns up, mark the wine `null`/"no listings found" instead. Bake
     this rule into every subagent's prompt.
   - **After each wave**, harvest every subagent's JSON (grep/parse each
     task's transcript for the final `[...]` array — don't rely on
     reading it back through the conversation) and classify every id
     into exactly one of three buckets:
     1. **Verified** — `usd` set and `src` starts with `"web:"`.
     2. **Genuinely unfindable** — `usd: null` with a note that does NOT
        contain "budget"/"quota"/"not attempted"/"not searched". Exclude
        these from all future waves — re-searching them wastes budget
        for no new information.
     3. **Still needs research** — everything else (budget-blocked, or
        never even reached because the wave ran out of concurrency
        slots or search budget before getting to it).
   - **Launch the next wave against bucket 3 only.** Rebuild it fresh
     each time from the authoritative merged state (not from the
     previous wave's batch files, which are now stale). Repeat until
     bucket 3 is empty or a wave makes near-zero progress. In practice
     3 waves (10 + 10 + a final small mop-up wave sized to what's left)
     took a 1000-wine menu from 0 to ~93% fully web-verified within one
     session.
   - A classifier note can accidentally contain the word "budget" while
     describing a genuine finding (e.g. "not a budget issue") — a plain
     substring match will misfile it as retry-worthy. Spot-check a
     sample of bucket-3 notes before relaunching; anything that's
     actually a real finding belongs in bucket 2.
   - It will not reach 100% in one session for a large menu, and that's
     fine: label the honest remainder (see step 5) rather than treating
     partial coverage as a failure to fix with more retries.
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
   - `marketPriceSource`: the verifying domain for web-verified rows;
     append ", scaled by size" where scaled. For wines confirmed
     genuinely unfindable after real search effort, it's fine to fall
     back to a labeled estimate (`"Claude estimate (<month year>)"`)
     rather than leaving the row unpriced — never silently relabel a
     knowledge guess as web-sourced.
   - `aliases`: only needed when the canonical name differs from what the
     menu prints (`producer|wineName|vintage`, `;`-separated).
   - Same `venue`, `listedCurrency`, `menuDate` on every row.
6. **Validate**: `npx --yes tsx -e` calling `csvToWineEntries` from
   `lib/wineImportCsv.ts` on the file — 0 errors, row count matches.
7. **Deliver a checkpoint after every wave, not just at the end.**
   Rebuild and re-validate the CSV and send it (SendUserFile) as soon as
   a wave's results are merged — the user should never be left waiting
   through multiple waves with nothing to show, and each checkpoint is
   a safe fallback if the session is interrupted. On the final delivery,
   give a short summary: wine count, how many truly web-verified vs
   labeled-estimate vs unpriced (and why), biggest discounts found. Tell
   the user to upload it at `/admin` → enter PIN → "Import wines".
   Batches of 100 are handled by the page automatically.
