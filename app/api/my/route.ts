import { getRedis } from "@/lib/redis";
import { readSession } from "@/lib/auth";
import {
  SCAN_KEY_PREFIX,
  userScansKey,
  type ScanRecord,
} from "@/lib/galleryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal scan history: period + Consumed/Seen filters and a wine search
// across everything the signed-in user has scanned.

const PERIOD_DAYS: Record<string, number> = {
  week: 7,
  "30": 30,
  "60": 60,
  "90": 90,
  year: 365,
};

export interface MyScanEntry {
  id: string;
  cardUrl: string;
  caption: string;
  classification: "Consumed" | "Seen";
  eventDate: string; // YYYY-MM-DD
  at: string;
  matchedWines?: string[]; // present on search results
}

function bottleNames(record: ScanRecord): string[] {
  return record.result.bottles.map((b) =>
    [b.producer, b.wineName, b.vintage].filter(Boolean).join(" ") ||
    b.labelText ||
    ""
  );
}

export async function GET(request: Request) {
  const session = readSession(request.headers.get("cookie"));
  if (!session) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const redis = getRedis();
  if (!redis) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "recent"; // recent|week|30|60|90|year|all
  const kind = url.searchParams.get("kind") ?? "both"; // both|consumed|seen
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  try {
    const ids = await redis.lrange<string>(userScansKey(session.username), 0, -1);
    if (ids.length === 0) {
      return Response.json({ entries: [], total: 0 });
    }
    const records = (
      await redis.mget<(ScanRecord | null)[]>(
        ...ids.map((id) => `${SCAN_KEY_PREFIX}${id}`)
      )
    ).filter((r): r is ScanRecord => !!r);

    let entries: MyScanEntry[] = records.map((r) => ({
      id: r.id,
      cardUrl: r.cardUrl,
      caption: r.caption,
      classification:
        r.classification ??
        (r.result.bottles.some((b) => b.listedPrice) ? "Seen" : "Consumed"),
      eventDate: r.eventDate ?? r.at.slice(0, 10),
      at: r.at,
      ...(q
        ? {
            matchedWines: bottleNames(r).filter((n) =>
              n.toLowerCase().includes(q)
            ),
          }
        : {}),
    }));

    // Search: keep only scans containing a matching bottle.
    if (q) {
      entries = entries.filter((e) => (e.matchedWines?.length ?? 0) > 0);
    }

    // Classification filter (default: both).
    if (kind === "consumed") {
      entries = entries.filter((e) => e.classification === "Consumed");
    } else if (kind === "seen") {
      entries = entries.filter((e) => e.classification === "Seen");
    }

    // Period filter on the event date (consumed-on / last-seen date).
    if (period !== "all" && period !== "recent") {
      const days = PERIOD_DAYS[period];
      if (days) {
        const cutoff = Date.now() - days * 86400_000;
        entries = entries.filter(
          (e) => new Date(`${e.eventDate}T23:59:59`).getTime() >= cutoff
        );
      }
    }

    // Default view: just the 5 most recent scans.
    if (period === "recent" && !q) {
      entries = entries
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 5);
    }

    // Consumed first, then Seen — each newest first by event date.
    const rank = (e: MyScanEntry) => (e.classification === "Consumed" ? 0 : 1);
    entries.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? 1 : -1;
      return a.at < b.at ? 1 : -1;
    });

    return Response.json({ entries, total: entries.length });
  } catch (err) {
    console.error("my scans failed:", err);
    return Response.json({ error: "Could not load your scans" }, { status: 500 });
  }
}
