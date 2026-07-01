import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { resolveSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: resolveSiteUrl(),
  title: "Lever — the media buyer's profit copilot",
  description:
    "Turn fragmented cross-platform ad performance into one ranked, dollar-backed action list. Pause leaks, scale winners, refresh fatigued creative — each move shown with the math.",
  keywords: [
    "media buying",
    "affiliate marketing",
    "ROAS",
    "ad optimization",
    "profit",
    "Google Ads",
    "Meta",
    "Taboola",
    "TikTok",
  ],
  openGraph: {
    title: "Lever — the media buyer's profit copilot",
    description:
      "One ranked, dollar-backed action list across Google, Meta, Taboola, and TikTok. Explainable, profit-objective, deterministic.",
    type: "website",
    siteName: "Lever",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lever — the media buyer's profit copilot",
    description:
      "Pause leaks, scale winners, refresh fatigued creative — each move shown with the math.",
  },
  // Safari's legacy pinned-tab icon: a single-color SVG silhouette, recolored
  // via `color` (Safari ignores the SVG's own fill). Same lever-on-fulcrum
  // geometry as the header LeverMark and the registered app icon, so the
  // pinned tab still reads as the Lever mark. See docs/BRAND.md.
  icons: {
    other: [
      {
        rel: "mask-icon",
        url: "/safari-pinned-tab.svg",
        color: "#0f172a",
      },
    ],
  },
};

/**
 * JSON-LD (schema.org SoftwareApplication) so search engines and AI
 * crawlers can resolve what Lever *is* without scraping the UI — real-service
 * SEO hygiene, not just an OG image. Deliberately omits fields we can't
 * truthfully claim yet (price, aggregateRating, review count).
 */
const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Lever",
  description:
    "Turn fragmented cross-platform ad performance into one ranked, dollar-backed action list. Pause leaks, scale winners, refresh fatigued creative — each move shown with the math.",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: resolveSiteUrl().toString(),
};

// Tint mobile browser chrome with brand ink so the app reads as a product, not a
// page. `width=device-width, initialScale=1` keeps the dense numeric UI honest on
// phones. themeColor lives in the dedicated viewport export per Next.js metadata API.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />

      </head>
      <body className="min-h-full flex flex-col">{children}</body>

    </html>
  );
}
