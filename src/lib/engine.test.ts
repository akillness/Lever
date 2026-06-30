import { describe, expect, it } from "vitest";
import { analyze, accountHealth } from "./engine";
import { computeMetrics, safeDiv, median, signalConfidence, summarizeByChannel } from "./metrics";
import { parseCsv, sanitizeAdRows } from "./csv";
import type { AdRow } from "./types";

const row = (over: Partial<AdRow>): AdRow => ({
  id: "x",
  name: "Ad",
  channel: "google",
  spend: 0,
  revenue: 0,
  conversions: 0,
  clicks: 0,
  impressions: 0,
  ...over,
});

describe("metrics", () => {
  it("derives metrics correctly", () => {
    const m = computeMetrics(
      row({ spend: 100, revenue: 250, conversions: 10, clicks: 50, impressions: 1000 }),
    );
    expect(m.cpa).toBe(10);
    expect(m.epc).toBe(5);
    expect(m.roas).toBe(2.5);
    expect(m.cvr).toBe(0.2);
    expect(m.ctr).toBe(0.05);
    expect(m.cpc).toBe(2);
    expect(m.profit).toBe(150);
  });

  it("safeDiv guards against divide-by-zero", () => {
    expect(safeDiv(5, 0)).toBe(0);
    expect(safeDiv(0, 0)).toBe(0);
    expect(safeDiv(10, 4)).toBe(2.5);
  });

  it("median handles even and odd lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("accountHealth", () => {
  const cfg = { targetRoas: 1, scaleTrigger: 1.25, scaleStep: 0.3, marginalEfficiency: 0.8, fatigueRatio: 0.6, refreshCap: 0.5, minSpend: 250, minConversions: 5 };

  it("is 0 for an empty / zero-spend portfolio", () => {
    expect(accountHealth([], [], cfg)).toBe(0);
  });

  it("rises with ROAS and falls when spend leaks into PAUSE'd entities", () => {
    const healthy = analyze([
      row({ id: "w", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
    ]);
    const leaky = analyze([
      row({ id: "w", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "leak", spend: 2000, revenue: 0, conversions: 0, clicks: 300, impressions: 20000 }),
    ]);
    expect(healthy.accountHealth).toBeGreaterThan(leaky.accountHealth);
    expect(healthy.accountHealth).toBeGreaterThanOrEqual(0);
    expect(healthy.accountHealth).toBeLessThanOrEqual(100);
  });

  it("analyze() exposes accountHealth in range 0..100", () => {
    const { accountHealth: h } = analyze([
      row({ id: "g", spend: 1000, revenue: 1500, conversions: 30, clicks: 800, impressions: 25000 }),
    ]);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(100);
  });
});

describe("summarizeByChannel", () => {
  it("aggregates spend/revenue/profit/ROAS per channel and sorts by spend desc", () => {
    const summary = summarizeByChannel([
      row({ channel: "google", spend: 100, revenue: 250, conversions: 5 }),
      row({ channel: "google", spend: 100, revenue: 150, conversions: 5 }),
      row({ channel: "meta", spend: 400, revenue: 600, conversions: 5 }),
    ]);
    expect(summary.map((s) => s.channel)).toEqual(["meta", "google"]); // 400 > 200
    const google = summary.find((s) => s.channel === "google")!;
    expect(google.spend).toBe(200);
    expect(google.revenue).toBe(400);
    expect(google.profit).toBe(200);
    expect(google.roas).toBe(2);
    expect(google.entities).toBe(2);
  });

  it("analyze() exposes the per-channel breakdown", () => {
    const { byChannel } = analyze([
      row({ id: "g", channel: "google", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "t", channel: "taboola", spend: 500, revenue: 200, conversions: 10, clicks: 400, impressions: 20000 }),
    ]);
    expect(byChannel).toHaveLength(2);
    expect(byChannel[0].channel).toBe("google"); // higher spend first
  });
});

describe("engine rules", () => {
  it("PAUSE fires on a losing high-signal entity with savings = |profit|", () => {
    const { recommendations } = analyze([
      row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ]);
    const rec = recommendations[0];
    expect(rec.action).toBe("PAUSE");
    expect(rec.projectedImpactUsd).toBe(600);
  });

  it("does NOT pause a loser below the spend threshold (insufficient signal)", () => {
    const { recommendations } = analyze([
      row({ id: "lp", spend: 100, revenue: 10, conversions: 6, clicks: 80, impressions: 5000 }),
    ]);
    expect(recommendations[0].action).toBe("KEEP");
    expect(recommendations[0].rationale).toMatch(/insufficient signal/i);
  });

  it("PAUSEs a high-spend money-loser even with thin conversion signal (never 'healthy')", () => {
    const { recommendations } = analyze([
      row({ id: "thin", spend: 1000, revenue: 400, conversions: 3, clicks: 800, impressions: 50000 }),
    ]);
    const rec = recommendations[0];
    expect(rec.action).toBe("PAUSE"); // not KEEP "healthy"
    expect(rec.projectedImpactUsd).toBe(600);
    expect(rec.rationale).toMatch(/thin signal/i);
    expect(rec.confidence).toBeLessThan(0.6); // low confidence flagged
  });

  it("flags a BUDGET LEAK (high spend, zero conversions) as the most urgent PAUSE", () => {
    const { recommendations } = analyze([
      row({ id: "leak", spend: 2000, revenue: 0, conversions: 0, clicks: 500, impressions: 40000 }),
    ]);
    const rec = recommendations[0];
    expect(rec.action).toBe("PAUSE");
    expect(rec.severity).toBe(4); // outranks an ordinary loser (severity 3)
    expect(rec.projectedImpactUsd).toBe(2000); // full spend recoverable
    expect(rec.rationale).toMatch(/budget leak/i);
  });

  it("a budget leak outranks a smaller ordinary loss in the action feed", () => {
    const { recommendations } = analyze([
      row({ id: "loss", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
      row({ id: "leak", spend: 1200, revenue: 0, conversions: 0, clicks: 300, impressions: 20000 }),
    ]);
    expect(recommendations[0].entityId).toBe("leak"); // 1200 > 600
  });

  it("SCALE fires on a strong performer with positive incremental profit", () => {
    const { recommendations } = analyze([
      row({ id: "s", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
    ]);
    const rec = recommendations[0];
    expect(rec.action).toBe("SCALE");
    // incSpend 300, incRevenue 300*2*0.8=480, incProfit 180
    expect(rec.projectedImpactUsd).toBe(180);
  });

  it("REFRESH_CREATIVE fires on a profitable entity with CTR below channel-median fatigue line", () => {
    const data: AdRow[] = [
      row({ id: "h1", channel: "meta", spend: 300, revenue: 330, conversions: 6, clicks: 15, impressions: 300 }),
      row({ id: "h2", channel: "meta", spend: 300, revenue: 330, conversions: 6, clicks: 15, impressions: 300 }),
      row({ id: "fat", channel: "meta", spend: 1000, revenue: 1100, conversions: 20, clicks: 1000, impressions: 100000 }),
    ];
    const { recommendations } = analyze(data);
    const fat = recommendations.find((r) => r.entityId === "fat")!;
    expect(fat.action).toBe("REFRESH_CREATIVE");
    // profit 100, uplift capped at 0.5 -> impact 50
    expect(fat.projectedImpactUsd).toBe(50);
  });

  it("KEEP for a lone healthy entity (no rule fires)", () => {
    const { recommendations } = analyze([
      row({ id: "k", spend: 1000, revenue: 1100, conversions: 20, clicks: 2000, impressions: 40000 }),
    ]);
    expect(recommendations[0].action).toBe("KEEP");
    expect(recommendations[0].rationale).toMatch(/healthy/i);
  });

  it("ranks recommendations by projected dollar impact, highest first", () => {
    const { recommendations } = analyze([
      row({ id: "s", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ]);
    expect(recommendations.map((r) => r.entityId)).toEqual(["p", "s"]); // 600 before 180
  });

  it("is deterministic across runs", () => {
    const data = [
      row({ id: "a", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "b", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ];
    expect(analyze(data)).toEqual(analyze(data));
  });

  it("produces a portfolio reallocation when both a PAUSE and a SCALE exist", () => {
    const { reallocation } = analyze([
      row({ id: "s", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ]);
    expect(reallocation).not.toBeNull();
    expect(reallocation!.fromEntityId).toBe("p");
    expect(reallocation!.toEntityId).toBe("s");
    // moves the loser's actual freed spend ($1000), not a derived proxy
    expect(reallocation!.amountUsd).toBe(1000);
    // net profit redeploying $1000 at ROAS 2 × 0.8 efficiency − 1 = $600
    expect(reallocation!.projectedImpactUsd).toBe(600);
  });

  it("does NOT double-count reallocation into the headline projected impact", () => {
    const { totals, recommendations, reallocation } = analyze([
      row({ id: "s", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ]);
    const recSum = recommendations.reduce((n, r) => n + r.projectedImpactUsd, 0);
    expect(totals.projectedImpactUsd).toBe(Math.round(recSum * 100) / 100);
    // reallocation is reported separately and is non-zero here
    expect(reallocation!.projectedImpactUsd).toBeGreaterThan(0);
  });

  it("computes portfolio totals from the raw rows", () => {
    const { totals } = analyze([
      row({ id: "s", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ]);
    expect(totals.spend).toBe(2000);
    expect(totals.revenue).toBe(2400);
    expect(totals.profit).toBe(400);
    expect(totals.roas).toBe(1.2);
  });
});

describe("csv parsing", () => {
  it("parses aliased headers and strips currency/commas", () => {
    const csv = [
      "campaign,platform,cost,conversion_value,leads,clicks,impressions",
      '"Solar — Exact",Google Ads,"$1,000",2500,40,500,12000',
    ].join("\n");
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("google");
    expect(rows[0].name).toBe("Solar — Exact");
    expect(rows[0].spend).toBe(1000);
    expect(rows[0].revenue).toBe(2500);
    expect(rows[0].conversions).toBe(40);
  });

  it("tags an unrecognized platform as 'other' (no silent misattribution)", () => {
    const csv = "campaign,platform,cost,conversion_value\nBing Test,Microsoft Bing,500,800";
    const [r] = parseCsv(csv);
    expect(r.channel).toBe("other");
  });


  it("returns empty for header-only or blank input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("id,name,spend")).toEqual([]);
  });

  it("clamps negative numeric values to zero", () => {
    const csv = "campaign,platform,cost,conversion_value\nGlitch,Meta,-500,-100";
    const [r] = parseCsv(csv);
    expect(r.spend).toBe(0);
    expect(r.revenue).toBe(0);
  });

  it("preserves quoted fields containing embedded newlines and commas", () => {
    const csv = [
      "campaign,platform,cost,conversion_value",
      '"Summer Sale,\nLine Two",Meta,"1,200",3000',
      "Plain,Google,800,1500",
    ].join("\n");
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Summer Sale,\nLine Two");
    expect(rows[0].spend).toBe(1200);
    expect(rows[1].name).toBe("Plain");
    expect(rows[1].spend).toBe(800);
  });
});

describe("sanitizeAdRows", () => {
  it("coerces untrusted objects into safe AdRows", () => {
    const rows = sanitizeAdRows([
      { name: "Ad", channel: "Facebook", spend: "1000", revenue: -5, conversions: 3.2 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("meta");
    expect(rows[0].spend).toBe(1000);
    expect(rows[0].revenue).toBe(0); // negative clamped
    expect(rows[0].id).toBe("row-1");
  });

  it("drops non-object entries and returns [] for non-arrays", () => {
    expect(sanitizeAdRows([null, 7, "x"])).toEqual([]);
    expect(sanitizeAdRows("nope")).toEqual([]);
    expect(sanitizeAdRows({})).toEqual([]);
  });
});

describe("recommendation confidence", () => {
  it("signalConfidence rises with spend depth and conversion volume", () => {
    const thin = signalConfidence(250, 5, 250, 5);
    const deep = signalConfidence(4000, 80, 250, 5);
    expect(deep).toBeGreaterThan(thin);
    expect(deep).toBe(1); // saturates at full signal
    expect(thin).toBeGreaterThan(0);
    expect(thin).toBeLessThan(1);
  });

  it("clamps to the 0..1 range and never returns NaN", () => {
    expect(signalConfidence(0, 0, 250, 5)).toBe(0);
    expect(signalConfidence(1e9, 1e9, 250, 5)).toBe(1);
  });

  it("weights conversion volume above spend (0.6 vs 0.4)", () => {
    // full conversions, zero spend vs full spend, zero conversions
    expect(signalConfidence(0, 20, 250, 5)).toBe(0.6);
    expect(signalConfidence(1000, 0, 250, 5)).toBe(0.4);
  });

  it("attaches a confidence score to every recommendation", () => {
    const { recommendations } = analyze([
      row({ id: "s", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 }),
    ]);
    for (const r of recommendations) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});
describe("trend creative fatigue (period-over-period)", () => {
  it("fires REFRESH when CTR drops sharply vs the entity's own prior period, even above channel median", () => {
    const { recommendations } = analyze([
      // Lone entity → channel median == its own CTR, so the cross-sectional rule
      // can never fire; only the prior-period trend signal can.
      row({ id: "tf", spend: 1500, revenue: 1800, conversions: 45, clicks: 9000, impressions: 600000, priorCtr: 0.024 }),
    ]);
    const rec = recommendations[0];
    expect(rec.action).toBe("REFRESH_CREATIVE");
    // ctr 0.015 vs prior 0.024 → uplift capped at 0.5 → profit 300 × 0.5 = 150
    expect(rec.projectedImpactUsd).toBe(150);
    expect(rec.rationale).toMatch(/last period/i);
  });

  it("does NOT fire when the period-over-period decline is below the trigger", () => {
    const { recommendations } = analyze([
      // 0.015 vs 0.017 ≈ 12% drop < 25% trigger → hold.
      row({ id: "mild", spend: 1500, revenue: 1800, conversions: 45, clicks: 9000, impressions: 600000, priorCtr: 0.017 }),
    ]);
    expect(recommendations[0].action).toBe("KEEP");
  });

  it("is backward compatible: no priorCtr and above median ⇒ KEEP (no spurious refresh)", () => {
    const { recommendations } = analyze([
      row({ id: "noprior", spend: 1500, revenue: 1800, conversions: 45, clicks: 9000, impressions: 600000 }),
    ]);
    expect(recommendations[0].action).toBe("KEEP");
  });
});

describe("csv prior_ctr ingest", () => {
  it("parses an optional prior_ctr column as a positive rate", () => {
    const csv = "campaign,platform,cost,conversion_value,clicks,impressions,prior_ctr\nUGC,TikTok,1500,1800,9000,600000,0.024";
    const [r] = parseCsv(csv);
    expect(r.priorCtr).toBe(0.024);
  });

  it("leaves priorCtr undefined when the column is absent or non-positive", () => {
    expect(parseCsv("campaign,platform,cost\nX,Meta,500")[0].priorCtr).toBeUndefined();
    const [z] = parseCsv("campaign,platform,cost,prior_ctr\nY,Meta,500,0");
    expect(z.priorCtr).toBeUndefined();
  });
});