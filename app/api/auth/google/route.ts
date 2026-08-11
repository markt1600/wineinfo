import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kicks off the Google OAuth flow. Requires GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET and the callback URL registered in the Google
// Cloud console: <origin>/api/auth/google/callback
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return Response.json(
      { error: "Google sign-in is not configured." },
      { status: 503 }
    );
  }
  const origin = new URL(request.url).origin;
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid profile",
    state,
    prompt: "select_account",
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": `waid_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  });
}
