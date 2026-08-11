"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// App navigation: a bar across the top on desktop, and a tab bar fixed to
// the bottom on mobile. The login item shows the signed-in name.
export default function NavBar() {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setDisplayName(d?.user?.displayName ?? null))
      .catch(() => setDisplayName(null));
  }, [pathname]);

  const item = (href: string, icon: string, label: string) => (
    <Link href={href} className={`nav-item${pathname === href ? " active" : ""}`}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </Link>
  );

  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">
          🍷 Wine <em>(a)ID</em>
        </span>
        <div className="nav-items">
          {item("/", "📷", "Scan")}
          {item("/gallery", "🗂️", "Scans")}
          {item("/my", "🍇", "My Wines")}
          {item("/restaurants", "🍽️", "Restaurants")}
          {item("/login", "👤", displayName ?? "Login")}
        </div>
      </div>
    </nav>
  );
}
