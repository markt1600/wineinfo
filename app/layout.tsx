import type { Metadata, Viewport } from "next";
import NavBar from "@/components/NavBar";
import "./globals.css";

const DESCRIPTION =
  "Snap a photo of wine bottles, a store shelf, or a wine menu — identify the wines, get prices and ratings, and find the best value.";

// Absolute base URL so link previews (WhatsApp etc.) get absolute image URLs.
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "Wine (a)ID",
  description: DESCRIPTION,
  openGraph: {
    title: "Wine (a)ID",
    description: DESCRIPTION,
    siteName: "Wine (a)ID",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wine (a)ID",
    description: DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    title: "Wine (a)ID",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f5efe2",
  viewportFit: "cover",
  // Keyboard resizes the viewport, so the fixed bottom nav stays put
  // instead of floating mid-screen above the keyboard.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Same type system as marktan.ai: Fraunces (display), Newsreader
            (body), JetBrains Mono (labels). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,800;1,9..144,400;1,9..144,500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
