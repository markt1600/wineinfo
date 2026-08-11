"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Me {
  user: { username: string; displayName: string } | null;
  accountsEnabled: boolean;
  googleEnabled: boolean;
}

function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  const loadMe = () =>
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));

  useEffect(() => {
    loadMe();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        mode === "signin" ? "/api/auth/login" : "/api/auth/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, confirm }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Something went wrong.");
      router.push("/");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUsername("");
    setPassword("");
    setConfirm("");
    await loadMe();
  };

  const canSubmit =
    username.length > 0 &&
    password.length > 0 &&
    (mode === "signin" || confirm.length > 0);

  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
        </h1>
        <p>Sign in to put your name on your scans — or keep using guest mode.</p>
      </header>

      {me?.user ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ marginBottom: 12 }}>
            Signed in as <strong>{me.user.displayName}</strong>
          </p>
          <button className="btn secondary" onClick={signOut}>
            Sign out
          </button>
          <button className="btn" onClick={() => router.push("/")}>
            Back to scanning
          </button>
        </div>
      ) : (
        <>
          {me?.googleEnabled && (
            <div className="card">
              <a className="btn secondary" href="/api/auth/google">
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.1-6.9-5.1l-3.9 3C3.2 21.3 7.3 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.1 14.3c-.3-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3l-4-3C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.3l3.9-3z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.7c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0 7.3 0 3.2 2.7 1.2 6.7l4 3c.9-3 3.6-5 6.8-5z"
                  />
                </svg>
                Continue with Google
              </a>
            </div>
          )}

          <div className="card">
            {!me?.accountsEnabled && me !== null && (
              <p className="error" style={{ paddingBottom: 10 }}>
                Accounts are unavailable — this deployment has no Redis
                database configured. You can keep using guest mode.
              </p>
            )}
            <div className="auth-tabs">
              <button
                className={mode === "signin" ? "active" : ""}
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
              >
                Sign in
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Create account
              </button>
            </div>
            <input
              className="currency"
              placeholder="Username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="currency"
              type="password"
              placeholder="Password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" && (
              <input
                className="currency"
                type="password"
                placeholder="Confirm password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && canSubmit && !busy && submit()
                }
              />
            )}
            <button
              className="btn"
              disabled={busy || !canSubmit || !me?.accountsEnabled}
              onClick={submit}
            >
              {busy
                ? "Working…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
            {error && <div className="error">{error}</div>}
            <p
              style={{
                color: "var(--muted)",
                fontSize: "0.82rem",
                marginTop: 12,
                textAlign: "center",
              }}
            >
              No email needed — just a username and password.
            </p>
          </div>

          <button
            className="btn secondary"
            style={{ marginTop: 16 }}
            onClick={() => router.push("/")}
          >
            Continue as guest
          </button>
        </>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main />}>
      <LoginView />
    </Suspense>
  );
}
