import {
  accountsEnabled,
  getUser,
  sessionSetCookie,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!accountsEnabled()) {
    return Response.json(
      { error: "Accounts require the Redis database to be configured." },
      { status: 503 }
    );
  }
  const body = (await request.json()) as {
    username?: string;
    password?: string;
  };
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  const user = await getUser(username);
  if (
    !user ||
    user.provider !== "credentials" ||
    !user.salt ||
    !user.hash ||
    !verifyPassword(password, user.salt, user.hash)
  ) {
    return Response.json(
      { error: "Incorrect username or password." },
      { status: 401 }
    );
  }

  const session = { username: user.username, displayName: user.displayName };
  return Response.json(
    { ok: true, user: session },
    { headers: { "Set-Cookie": sessionSetCookie(session) } }
  );
}
