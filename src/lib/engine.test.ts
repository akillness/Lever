import { describe, expect, it } from "vitest";
import { analyze } from "./engine";
import { computeMetrics, safeDiv, median } from "./metrics";
import { parseCsv } from "./csv";
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

  it("returns empty for header-only or blank input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("id,name,spend")).toEqual([]);
  });
});
