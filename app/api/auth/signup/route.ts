import { getRedis } from "@/lib/redis";
import {
  RESERVED_USERNAMES,
  USERNAME_RE,
  accountsEnabled,
  hashPassword,
  sessionSetCookie,
  userKey,
  type UserRecord,
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
    confirm?: string;
  };
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!USERNAME_RE.test(username)) {
    return Response.json(
      { error: "Username must be 3–20 letters, numbers, or underscores." },
      { status: 400 }
    );
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return Response.json({ error: "That username is reserved." }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }
  if (password !== body.confirm) {
    return Response.json({ error: "Passwords do not match." }, { status: 400 });
  }

  const redis = getRedis()!;
  const key = userKey(username);
  const { salt, hash } = hashPassword(password);
  const user: UserRecord = {
    username,
    displayName: username,
    salt,
    hash,
    provider: "credentials",
    createdAt: new Date().toISOString(),
  };
  // NX write doubles as the duplicate check (atomic).
  const created = await redis.set(key, user, { nx: true });
  if (created !== "OK") {
    return Response.json(
      { error: "That username is already taken." },
      { status: 409 }
    );
  }

  return Response.json(
    { ok: true, user: { username, displayName: username } },
    {
      headers: {
        "Set-Cookie": sessionSetCookie({ username, displayName: username }),
      },
    }
  );
}
