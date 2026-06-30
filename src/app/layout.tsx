import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Resolve the canonical site origin for absolute OG / Twitter / canonical URLs.
 * On Vercel this is derived from system env vars, so production and preview
 * deployments always emit correct absolute URLs without hardcoding a domain:
 *  - NEXT_PUBLIC_SITE_URL        explicit override (custom domain / self-host)
 *  - VERCEL_PROJECT_PRODUCTION_URL  stable production domain, present on every
 *                                deployment (custom domain or <project>.vercel.app)
 *  - VERCEL_URL                  unique per-deployment URL (preview deploys)
 * Falls back to localhost for `next dev` / `next start` outside Vercel.
 */
function resolveSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return new URL(`https://${production}`);
  const deployment = process.env.VERCEL_URL;
  if (deployment) return new URL(`https://${deployment}`);
  return new URL("http://localhost:3000");
}

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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
