import { accountsEnabled, isAdminSession, readSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = readSession(request.headers.get("cookie"));
  return Response.json({
    user: session
      ? { username: session.username, displayName: session.displayName }
      : null,
    isAdmin: isAdminSession(session),
    accountsEnabled: accountsEnabled(),
    googleEnabled:
      !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
  });
}
