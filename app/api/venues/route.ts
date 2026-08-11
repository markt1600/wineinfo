import { getRedis } from "@/lib/redis";
import { getVenue, listVenues } from "@/lib/venueStore";

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
