import type { AdRow } from "./types";

/**
 * Seeded, realistic cross-platform dataset for an affiliate list-builder.
 * Designed so the engine surfaces each recommendation type:
 *  - clear losers (PAUSE), clear winners (SCALE), fatigued-but-profitable (REFRESH),
 *    and steady holds (KEEP).
 * Fully synthetic — no real account data.
 */
export const SAMPLE_DATA: AdRow[] = [
  // SCALE: strong ROAS, plenty of signal.
  {
    id: "g-1",
    name: "Google · Solar Leads — Exact",
    channel: "google",
    spend: 4200,
    revenue: 9450,
    conversions: 168,
    clicks: 5200,
    impressions: 142000,
    date: "2026-06-01",
  },
  // PAUSE: deep in the red despite real volume.
  {
    id: "m-1",
    name: "Meta · Medicare ABO — Broad",
    channel: "meta",
    spend: 3800,
    revenue: 2280,
    conversions: 76,
    clicks: 6100,
    impressions: 410000,
    date: "2026-06-01",
  },
  // REFRESH_CREATIVE: profitable but CTR far below Meta median.
  {
    id: "m-2",
    name: "Meta · Auto Insurance — Lookalike",
    channel: "meta",
    spend: 2600,
    revenue: 3640,
    conversions: 91,
    clicks: 1450,
    impressions: 520000,
    date: "2026-06-01",
  },
  // KEEP: healthy, near target, nothing urgent.
  {
    id: "m-3",
    name: "Meta · Home Services — Retarget",
    channel: "meta",
    spend: 1900,
    revenue: 2280,
    conversions: 57,
    clicks: 3050,
    impressions: 165000,
    date: "2026-06-01",
  },
  // SCALE: Taboola winner.
  {
    id: "t-1",
    name: "Taboola · Debt Relief — Desktop",
    channel: "taboola",
    spend: 3100,
    revenue: 6510,
    conversions: 130,
    clicks: 8700,
    impressions: 980000,
    date: "2026-06-01",
  },
  // PAUSE: Taboola loser, weak conversion.
  {
    id: "t-2",
    name: "Taboola · Crypto — Native",
    channel: "taboola",
    spend: 2750,
    revenue: 1100,
    conversions: 22,
    clicks: 9400,
    impressions: 1320000,
    date: "2026-06-01",
  },
  // SCALE: TikTok winner with strong CTR.
  {
    id: "tt-1",
    name: "TikTok · Beauty Sample — Spark",
    channel: "tiktok",
    spend: 2200,
    revenue: 4180,
    conversions: 110,
    clicks: 7700,
    impressions: 690000,
    date: "2026-06-01",
  },
  // KEEP: below spend threshold — insufficient signal.
  {
    id: "tt-2",
    name: "TikTok · Pet Insurance — Test",
    channel: "tiktok",
    spend: 180,
    revenue: 240,
    conversions: 6,
    clicks: 520,
    impressions: 38000,
    date: "2026-06-01",
  },
  // REFRESH_CREATIVE (trend): still above the TikTok median, but CTR fell hard
  // versus its own prior period — caught by period-over-period fatigue detection.
  {
    id: "tt-3",
    name: "TikTok · Weight Loss — UGC",
    channel: "tiktok",
    spend: 1500,
    revenue: 1800,
    conversions: 45,
    clicks: 9000,
    impressions: 600000,
    priorCtr: 0.024,
    date: "2026-06-01",
  },
  // BUDGET LEAK: real spend, zero conversions — the most urgent PAUSE.
  {
    id: "g-2",
    name: "Google · Mortgage Refi — Phrase",
    channel: "google",
    spend: 2400,
    revenue: 0,
    conversions: 0,
    clicks: 1800,
    impressions: 96000,
    date: "2026-06-01",
  },
  // LTV RESCUE: immediate revenue says "loser", but a known $95 first-party LTV
  // per conversion makes it a clear winner — the engine optimizes on true value.
  {
    id: "g-3",
    name: "Google · Insurance Quote — Broad",
    channel: "google",
    spend: 2000,
    revenue: 1400,
    conversions: 40,
    clicks: 2600,
    impressions: 88000,
    ltvPerConversion: 95,
    date: "2026-06-01",
  },
];

/** CSV string of the sample dataset, used to demo the upload path. */
export function sampleCsv(): string {
  const header =
    "id,name,channel,spend,revenue,conversions,clicks,impressions,date,prior_ctr,ltv_per_conversion";
  const lines = SAMPLE_DATA.map((r) =>
    [
      r.id,
      `"${r.name}"`,
      r.channel,
      r.spend,
      r.revenue,
      r.conversions,
      r.clicks,
      r.impressions,
      r.date ?? "",
      r.priorCtr ?? "",
      r.ltvPerConversion ?? "",
    ].join(","),
  );
  return [header, ...lines].join("\n");
}
