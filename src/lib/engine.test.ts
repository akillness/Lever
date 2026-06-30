import { describe, expect, it } from "vitest";
import { analyze, accountHealth } from "./engine";
import { computeMetrics, safeDiv, median, signalConfidence, spendConfidence, summarizeByChannel, effectiveRevenue, channelMedianCtr } from "./metrics";
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
  const cfg = { targetRoas: 1, scaleTrigger: 1.25, scaleStep: 0.3, marginalEfficiency: 0.8, fatigueRatio: 0.6, fatigueDeclineRatio: 0.25, refreshCap: 0.5, minSpend: 250, minConversions: 5 };

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
    // caps the move at what the winner can absorb at quoted efficiency:
    // scaleStep 0.3 × winner spend 1000 = $300 (the freed $1000 is larger)
    expect(reallocation!.amountUsd).toBe(300);
    // net profit redeploying $300 at ROAS 2 × 0.8 efficiency − 1 = $180
    expect(reallocation!.projectedImpactUsd).toBe(180);
    // the freed budget the winner can't absorb is flagged for spreading
    expect(reallocation!.rationale).toMatch(/spread/i);
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
describe("LTV-weighted revenue", () => {
  it("effectiveRevenue uses conversions × ltvPerConversion when provided, else immediate revenue", () => {
    expect(effectiveRevenue(row({ revenue: 1400, conversions: 40, ltvPerConversion: 95 }))).toBe(3800);
    expect(effectiveRevenue(row({ revenue: 1400, conversions: 40 }))).toBe(1400);
  });

  it("computeMetrics reflects LTV in roas and profit", () => {
    const m = computeMetrics(row({ spend: 2000, revenue: 1400, conversions: 40, clicks: 2600, ltvPerConversion: 95 }));
    expect(m.roas).toBe(1.9); // 3800 / 2000
    expect(m.profit).toBe(1800); // 3800 - 2000
  });

  it("rescues a creative that loses on immediate revenue but wins on first-party LTV", () => {
    const losing = row({ id: "g3", spend: 2000, revenue: 1400, conversions: 40, clicks: 2600, impressions: 88000 });
    expect(analyze([losing]).recommendations[0].action).toBe("PAUSE");
    const rescued = { ...losing, ltvPerConversion: 95 };
    expect(analyze([rescued]).recommendations[0].action).toBe("SCALE");
  });

  it("flows LTV into portfolio totals and account health", () => {
    const r = analyze([
      row({ id: "g3", spend: 2000, revenue: 1400, conversions: 40, clicks: 2600, impressions: 88000, ltvPerConversion: 95 }),
    ]);
    expect(r.totals.revenue).toBe(3800);
    expect(r.totals.roas).toBe(1.9);
  });

  it("csv ingests an ltv_per_conversion column as a positive rate", () => {
    const csv = "campaign,platform,cost,conversion_value,conv,ltv_per_conversion\nQuote,Google,2000,1400,40,95";
    const [r] = parseCsv(csv);
    expect(r.ltvPerConversion).toBe(95);
    expect(parseCsv("campaign,platform,cost\nX,Google,500")[0].ltvPerConversion).toBeUndefined();
  });
});
describe("REVIEW tier (profitable but below the buyer's target ROAS)", () => {
  it("flags a profitable sub-target entity as REVIEW when targetRoas > breakeven", () => {
    const { recommendations } = analyze(
      [row({ id: "u", spend: 1000, revenue: 1200, conversions: 40, clicks: 2000, impressions: 40000 })],
      { targetRoas: 1.5 },
    );
    const rec = recommendations[0];
    expect(rec.action).toBe("REVIEW");
    // a flag, not a promised dollar — never inflates the headline impact
    expect(rec.projectedImpactUsd).toBe(0);
    expect(rec.rationale).toMatch(/below target/i);
    // shortfall = spend × (target − roas) = 1000 × (1.5 − 1.2) = $300
    expect(rec.rationale).toContain("$300");
  });

  it("is backward compatible: at the default target 1.0 a profitable entity is KEEP, never REVIEW", () => {
    const { recommendations } = analyze([
      row({ id: "k", spend: 1000, revenue: 1200, conversions: 40, clicks: 2000, impressions: 40000 }),
    ]);
    expect(recommendations[0].action).toBe("KEEP");
  });

  it("still PAUSEs a money-loser even when the target is raised (breakeven stays 1.0)", () => {
    const { recommendations } = analyze(
      [row({ id: "p", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 })],
      { targetRoas: 2 },
    );
    expect(recommendations[0].action).toBe("PAUSE");
    // breakeven is the fixed 1.0 line, not the (raised) target
    expect(recommendations[0].rationale).toMatch(/breakeven 1\.0/);
  });
});

describe("budget-leak confidence (spend-depth, not conversion-weighted)", () => {
  it("scores a high-spend zero-conversion leak as highly certain waste", () => {
    const { recommendations } = analyze([
      row({ id: "leak", spend: 2000, revenue: 0, conversions: 0, clicks: 500, impressions: 40000 }),
    ]);
    const rec = recommendations[0];
    expect(rec.action).toBe("PAUSE");
    // spend 2000 vs minSpend*4 (1000) saturates → confidence 1.0,
    // not the 0.4 a conversion-weighted score would have produced
    expect(rec.confidence).toBe(1);
  });

  it("spendConfidence rises with spend depth and clamps to 0..1", () => {
    expect(spendConfidence(0, 250)).toBe(0);
    expect(spendConfidence(500, 250)).toBe(0.5);
    expect(spendConfidence(1e9, 250)).toBe(1);
  });
});

describe("channelMedianCtr excludes zero-impression rows", () => {
  it("does not let an undefined-CTR (0 impressions) row drag the fatigue baseline down", () => {
    const medians = channelMedianCtr([
      row({ channel: "meta", clicks: 200, impressions: 10000 }), // ctr 0.02
      row({ channel: "meta", clicks: 400, impressions: 10000 }), // ctr 0.04
      row({ channel: "meta", clicks: 0, impressions: 0 }), // undefined CTR, excluded
    ]);
    // median of {0.02, 0.04} = 0.03, not median of {0, 0.02, 0.04} = 0.02
    expect(medians.meta).toBe(0.03);
  });
});

describe("fully deterministic ordering (entityId tiebreak)", () => {
  it("orders equal-impact, equal-severity entities by entityId regardless of input order", () => {
    const healthy = (id: string) =>
      row({ id, spend: 1000, revenue: 1100, conversions: 20, clicks: 2000, impressions: 40000 });
    const forward = analyze([healthy("b"), healthy("a")]);
    const reverse = analyze([healthy("a"), healthy("b")]);
    expect(forward.recommendations.map((r) => r.entityId)).toEqual(["a", "b"]);
    expect(reverse.recommendations.map((r) => r.entityId)).toEqual(["a", "b"]);
  });
});

describe("reallocation respects diminishing returns", () => {
  it("caps the moved budget at scaleStep × winner spend and flags the remainder", () => {
    const { reallocation } = analyze([
      // winner spend 1000 → absorbs 0.3 × 1000 = $300
      row({ id: "win", spend: 1000, revenue: 2000, conversions: 50, clicks: 1000, impressions: 30000 }),
      // loser frees $2000 — far more than the winner can absorb at quoted efficiency
      row({ id: "lose", spend: 2000, revenue: 800, conversions: 40, clicks: 1600, impressions: 100000 }),
    ]);
    expect(reallocation!.amountUsd).toBe(300);
    expect(reallocation!.projectedImpactUsd).toBe(180); // 300 × (2×0.8 − 1)
    expect(reallocation!.rationale).toMatch(/spread/i); // $1700 remainder flagged
  });
});