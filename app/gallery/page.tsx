"use client";

import Link from "next/link";
import Gallery from "@/components/Gallery";

export default function GalleryPage() {
  return (
    <main>
      <header className="app">
        <h1>
          🍷 Wine <span>(a)ID</span>
        </h1>
        <p>All previously scanned summary cards.</p>
      </header>
      <Link href="/" className="btn secondary" style={{ marginTop: 8 }}>
        ← Back to scanning
      </Link>
      <Gallery
        title="🗂️ All scans"
        subtitle="Every saved summary card, newest first."
      />
    </main>
  );
}
