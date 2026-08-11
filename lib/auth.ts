import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import { getRedis } from "@/lib/redis";

// Minimal session + account plumbing. Accounts live in Redis
// (user:<username> / user:google:<sub>); sessions are HMAC-signed
// cookies, so no session storage is needed.

export const SESSION_COOKIE = "waid_session";
const SESSION_DAYS = 30;

export interface Session {
  username: string; // stable account key ("markt", "google:1234...")
  displayName: string; // what the feed shows ("Mark T." or "markt")
  email?: string; // verified email from Google sign-in (absent for others)
}

export interface UserRecord {
  username: string;
  displayName: string;
  email?: string;
  salt?: string;
  hash?: string;
  provider: "credentials" | "google";
  createdAt: string;
}

// AUTH_SECRET is recommended; the fallback derivation keeps sessions
// stable across serverless instances without extra setup.
function secret(): string {
  return (
    process.env.AUTH_SECRET ||
    createHmac("sha256", "wine-aid-sessions")
      .update(process.env.ANTHROPIC_API_KEY ?? "insecure-dev")
      .digest("hex")
  );
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

export function createSessionToken(session: Session): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        u: session.username,
        d: session.displayName,
        ...(session.email ? { e: session.email } : {}),
        exp: Date.now() + SESSION_DAYS * 86400_000,
      })
    )
  );
  return `${payload}.${hmac(payload)}`;
}

export function readSession(cookieHeader: string | null): Session | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(SESSION_COOKIE.length + 1);
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (!data.u || !data.d) return null;
    return {
      username: String(data.u),
      displayName: String(data.d),
      ...(data.e ? { email: String(data.e) } : {}),
    };
  } catch {
    return null;
  }
}

export function sessionSetCookie(session: Session): string {
  const token = createSessionToken(session);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---- Password accounts -------------------------------------------------

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(
  password: string,
  salt: string,
  hash: string
): boolean {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function accountsEnabled(): boolean {
  return getRedis() !== null;
}

// The admin UI (footer link + admin page shortcuts) is only surfaced to the
// deployment owner, identified by their Google-verified email. Override with
// the ADMIN_EMAIL env var; the admin API itself is still PIN-protected.
const DEFAULT_ADMIN_EMAIL = "markh.tan@gmail.com";

export function isAdminSession(session: Session | null): boolean {
  const adminEmail = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
  return !!session?.email && session.email.trim().toLowerCase() === adminEmail;
}

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const RESERVED_USERNAMES = new Set(["guest", "admin", "wine", "system"]);

export function userKey(username: string): string {
  return `user:${username.toLowerCase()}`;
}

export async function getUser(username: string): Promise<UserRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  return (await redis.get<UserRecord>(userKey(username))) ?? null;
}

// ---- Display names ------------------------------------------------------

// "Mark Tanner" -> "Mark T."
export function firstNameLastInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
