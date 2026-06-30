import { describe, expect, it } from "vitest";
import { recommendationsToCsv } from "./export";
import { analyze } from "./engine";
import type { AdRow, Recommendation } from "./types";

const rec = (over: Partial<Recommendation>): Recommendation => ({
  entityId: "e",
  entityName: "Ad",
  channel: "google",
  action: "KEEP",
  severity: 0,
  rationale: "ok",
  confidence: 0.5,
  projectedImpactUsd: 0,
  metrics: {
    cpa: 1,
    epc: 2,
    roas: 3,
    cvr: 0.1,
    ctr: 0.05,
    cpc: 0.5,
    profit: 10,
  },
  ...over,
});

describe("recommendationsToCsv", () => {
  it("emits a header plus one line per recommendation", () => {
    const csv = recommendationsToCsv([rec({}), rec({ entityId: "e2" })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "action,entity,channel,projected_impact_usd,confidence,roas,cpa,epc,profit,rationale",
    );
  });

  it("escapes commas, quotes, and newlines in fields", () => {
    const csv = recommendationsToCsv([
      rec({ entityName: 'Solar, "Exact"', rationale: "line1\nline2" }),
    ]);
    expect(csv).toContain('"Solar, ""Exact"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("round-trips real engine output without throwing", () => {
    const rows: AdRow[] = [
      { id: "p", name: "Loser", channel: "taboola", spend: 1000, revenue: 400, conversions: 20, clicks: 800, impressions: 50000 },
    ];
    const { recommendations } = analyze(rows);
    const csv = recommendationsToCsv(recommendations);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("PAUSE");
  });
});
describe("CSV formula-injection hardening", () => {
  it("prefixes fields that begin with a formula trigger so sheets treat them as text", () => {
    const csv = recommendationsToCsv([
      rec({ entityName: "=HYPERLINK(\"http://evil\")", rationale: "+1+1" }),
    ]);
    // a leading = or + is neutralized with a single quote, then quoted because it
    // now contains a quote / would otherwise execute in Excel/Sheets
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1+1");
    // and never emits a raw cell that starts with the bare formula trigger
    for (const line of csv.split("\n").slice(1)) {
      for (const cell of line.split(",")) {
        expect(/^[=+\-@]/.test(cell)).toBe(false);
      }
    }
  });

  it("leaves ordinary fields untouched", () => {
    const csv = recommendationsToCsv([rec({ entityName: "Solar Leads" })]);
    expect(csv).toContain("Solar Leads");
    expect(csv).not.toContain("'Solar");
  });
});