import { getRedis } from "@/lib/redis";
import { isAdminSession, readSession } from "@/lib/auth";
import { getVenue, listVenues, updateWineMarketPrice } from "@/lib/venueStore";
import type { Money } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET            -> list of venues (restaurants with stored wine lists)
// GET ?slug=...  -> one venue's full record (wines, menu photos)
export async function GET(request: Request) {
  if (!getRedis()) {
    return Response.json({ venues: [], enabled: false });
  }
  const slug = new URL(request.url).searchParams.get("slug");
  if (slug) {
    const venue = await getVenue(slug);
    if (!venue) {
      return Response.json({ error: "Venue not found" }, { status: 404 });
    }
    return Response.json({ venue });
  }
  return Response.json({ venues: await listVenues(), enabled: true });
}

// POST -> correct one wine's market price (admin-only, gated by the
// signed-in Google session, not the admin PIN — this is a lighter-weight
// in-page edit, not a bulk/destructive admin action).
export async function POST(request: Request) {
  const session = readSession(request.headers.get("cookie"));
  if (!isAdminSession(session)) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  const body = (await request.json()) as {
    slug?: string;
    producer?: string | null;
    wineName?: string | null;
    vintage?: string | null;
    marketPrice?: Money;
  };
  if (
    !body.slug ||
    !body.marketPrice ||
    typeof body.marketPrice.amount !== "number" ||
    !Number.isFinite(body.marketPrice.amount) ||
    body.marketPrice.amount <= 0 ||
    !body.marketPrice.currency
  ) {
    return Response.json({ error: "Missing or invalid fields" }, { status: 400 });
  }
  const updated = await updateWineMarketPrice(
    body.slug,
    {
      producer: body.producer ?? null,
      wineName: body.wineName ?? null,
      vintage: body.vintage ?? null,
    },
    body.marketPrice
  );
  if (!updated) {
    return Response.json({ error: "Wine or venue not found" }, { status: 404 });
  }
  return Response.json({ ok: true, wine: updated });
}
