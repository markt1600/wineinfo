import { getRedis } from "@/lib/redis";
import {
  firstNameLastInitial,
  sessionSetCookie,
  userKey,
  type UserRecord,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failRedirect(origin: string, message: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/login?error=${encodeURIComponent(message)}`,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith("waid_oauth_state="))
    ?.split("=")[1];

  if (!code || !state || state !== cookieState) {
    return failRedirect(origin, "Google sign-in failed — please try again.");
  }

  try {
    // Exchange the code directly with Google over TLS; the id_token comes
    // straight from Google, so decoding its payload is sufficient here.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("no id_token");

    const claims = JSON.parse(
      Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()
    ) as {
      sub?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (!claims.sub) throw new Error("no subject");

    const fullName =
      claims.name ||
      [claims.given_name, claims.family_name].filter(Boolean).join(" ") ||
      "Google User";
    const username = `google:${claims.sub}`;
    const displayName = firstNameLastInitial(fullName);
    // Only trust the email if Google says it's verified (gates the admin UI).
    const email =
      claims.email && claims.email_verified !== false
        ? claims.email
        : undefined;

    const redis = getRedis();
    if (redis) {
      const user: UserRecord = {
        username,
        displayName,
        ...(email ? { email } : {}),
        provider: "google",
        createdAt: new Date().toISOString(),
      };
      // Keep first-created timestamp; refresh the display name.
      const existing = await redis.get<UserRecord>(userKey(username));
      await redis.set(userKey(username), {
        ...user,
        createdAt: existing?.createdAt ?? user.createdAt,
      });
    }

    return new Response(null, {
      status: 302,
      headers: [
        ["Location", `${origin}/`],
        ["Set-Cookie", sessionSetCookie({ username, displayName, email })],
        ["Set-Cookie", "waid_oauth_state=; Path=/; Max-Age=0"],
      ],
    });
  } catch (err) {
    console.error("google callback failed:", err);
    return failRedirect(origin, "Google sign-in failed — please try again.");
  }
}
