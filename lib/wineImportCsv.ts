// Client-side CSV parsing for the admin wine-cache import. Pure — no
// server imports, so the admin page can bundle it.

import type { Money, Rating } from "@/lib/schema";

export interface WineImportEntry {
  producer: string | null;
  wineName: string | null;
  vintage: string | null;
  region: string | null;
  grapeVariety: string | null;
  wineType: string | null;
  marketPrice: Money | null;
  marketPriceSource: string | null;
  ratings: Rating[];
  // Alternate spellings (e.g. as a menu prints the name) that should
  // resolve to the same cache entry.
  aliases: {
    producer: string | null;
    wineName: string | null;
    vintage: string | null;
  }[];
  // Restaurant/bar fields — when venue is set, the wine is also added to
  // that venue's list in the Restaurants tab.
  venue: string | null;
  listedPrice: Money | null; // what the venue charges
  seenAt: string | null; // YYYY-MM-DD the menu is from (menuDate column)
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF, BOM.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// Maps a CSV (see /wine-import-template.csv for the columns) to import
// entries. Header names are matched loosely: case, spaces, and punctuation
// are ignored, so "wineName", "Wine Name", and "wine_name" all work.
export function csvToWineEntries(text: string): {
  entries: WineImportEntry[];
  errors: string[];
} {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) {
    return {
      entries: [],
      errors: ["The file needs a header row and at least one wine row."],
    };
  }
  const header = rows[0].map((h) =>
    h.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
  );
  const col = (name: string) => header.indexOf(name);
  if (col("producer") < 0 && col("winename") < 0) {
    return {
      entries: [],
      errors: [
        "The header row must include producer and wineName columns — start from the template.",
      ],
    };
  }
  const get = (row: string[], name: string): string | null => {
    const i = col(name);
    const v = i >= 0 ? (row[i] ?? "").trim() : "";
    return v || null;
  };

  const entries: WineImportEntry[] = [];
  rows.slice(1).forEach((row, idx) => {
    const producer = get(row, "producer");
    const wineName = get(row, "winename");
    if (!producer && !wineName) return; // blank / filler row

    let marketPrice: Money | null = null;
    const amountStr = get(row, "marketprice");
    const currency = get(row, "currency");
    if (amountStr) {
      const amount = Number(amountStr.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(amount) && amount > 0 && currency) {
        marketPrice = { amount, currency: currency.toUpperCase() };
      } else {
        errors.push(
          `Row ${idx + 2}: marketPrice needs a number plus a currency column — imported without a price.`
        );
      }
    }

    const ratings: Rating[] = [];
    for (const n of ["rating1", "rating2"]) {
      const source = get(row, `${n}source`);
      const score = get(row, `${n}score`);
      if (source && score) {
        ratings.push({
          source,
          score,
          vintageMatch: /^(true|yes|y|1)$/i.test(
            get(row, `${n}vintagematch`) ?? ""
          ),
          url: get(row, `${n}url`),
        });
      }
    }

    let listedPrice: Money | null = null;
    const listedStr = get(row, "listedprice");
    const listedCurrency = get(row, "listedcurrency") ?? currency;
    if (listedStr) {
      const amount = Number(listedStr.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(amount) && amount > 0 && listedCurrency) {
        listedPrice = { amount, currency: listedCurrency.toUpperCase() };
      } else {
        errors.push(
          `Row ${idx + 2}: listedPrice needs a number plus a currency — imported without it.`
        );
      }
    }

    const menuDate = get(row, "menudate");
    if (menuDate && !/^\d{4}-\d{2}-\d{2}$/.test(menuDate)) {
      errors.push(
        `Row ${idx + 2}: menuDate must be YYYY-MM-DD — ignored ("${menuDate}").`
      );
    }

    const aliases = (get(row, "aliases") ?? "")
      .split(";")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        const [p, w, v] = a.split("|").map((s) => s.trim());
        return {
          producer: p || null,
          wineName: w || null,
          vintage: v || null,
        };
      })
      .filter((a) => a.producer || a.wineName);

    entries.push({
      producer,
      wineName,
      vintage: get(row, "vintage"),
      region: get(row, "region"),
      grapeVariety: get(row, "grapevariety"),
      wineType: get(row, "winetype"),
      marketPrice,
      marketPriceSource: get(row, "marketpricesource"),
      ratings,
      aliases,
      venue: get(row, "venue"),
      listedPrice,
      seenAt:
        menuDate && /^\d{4}-\d{2}-\d{2}$/.test(menuDate) ? menuDate : null,
    });
  });
  return { entries, errors };
}
