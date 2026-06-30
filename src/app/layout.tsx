import type { Metadata } from "next";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://lever.vercel.app"),
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
