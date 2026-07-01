import { describe, it, expect } from "vitest";
import { analyze } from "./engine";
import { SAMPLE_DATA, sampleCsv } from "./sampleData";
import { parseCsv } from "./csv";
import type { RecommendationAction } from "./types";

/**
 * Data-driven verification of the seeded demo dataset.
 *
 * `SAMPLE_DATA` is what `/api/analyze` (GET) and the CSV-upload demo both
 * fall back to, and every row carries an inline comment claiming which
 * recommendation type it's meant to demonstrate (PAUSE / SCALE /
 * REFRESH_CREATIVE / KEEP). Nothing previously asserted those comments were
 * still true — a dataset edit could silently drift from its own documentation
 * with no test catching it (this is exactly what happened to row "m-2": its
 * ROAS crossed the SCALE trigger, so the engine classified it SCALE while the
 * comment still claimed REFRESH_CREATIVE, until this test was added and the
 * row's numbers were corrected).
 *
 * This test locks the mapping in as executable documentation and proves the
 * engine's output is genuinely a function of each row's numbers, not a fixed
 * demo response: it asserts against `analyze()` directly (no mocked engine),
 * covers every row exactly once, and cross-checks the CSV-export encoding of
 * the same dataset round-trips to an identical result.
 */

// Ground truth, one entry per SAMPLE_DATA row — kept in id order for
// readability; sourced from and must match each row's own comment.
const EXPECTED_ACTIONS: Record<string, RecommendationAction> = {
  "g-1": "SCALE", // budget-capped winner
  "m-1": "PAUSE", // deep in the red
  "m-2": "REFRESH_CREATIVE", // profitable but CTR far below Meta median
  "m-3": "KEEP", // healthy, near target
  "t-1": "SCALE", // Taboola winner
  "t-2": "PAUSE", // Taboola loser
  "tt-1": "SCALE", // TikTok winner
  "tt-2": "KEEP", // below spend threshold
  "tt-3": "REFRESH_CREATIVE", // period-over-period CTR fatigue
  "t-3": "REFRESH_CREATIVE", // multi-period CTR fatigue
  "g-2": "PAUSE", // budget leak: real spend, zero conversions
  "g-3": "SCALE", // LTV rescue: revenue alone looks weak, LTV-adjusted profit is strong
};

describe("SAMPLE_DATA — data-driven verification", () => {
  it("covers every row exactly once with a distinct id", () => {
    const ids = SAMPLE_DATA.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(Object.keys(EXPECTED_ACTIONS)));
  });

  it("analyze(SAMPLE_DATA) recommends exactly one action per row, matching each row's documented intent", () => {
    const result = analyze(SAMPLE_DATA);
    expect(result.recommendations).toHaveLength(SAMPLE_DATA.length);

    const byId = new Map(result.recommendations.map((r) => [r.entityId, r]));
    for (const row of SAMPLE_DATA) {
      const rec = byId.get(row.id);
      expect(rec, `missing recommendation for ${row.id}`).toBeDefined();
      expect(rec!.action, `${row.id} (${row.name}): ${rec!.rationale}`).toBe(
        EXPECTED_ACTIONS[row.id],
      );
    }
  });

  it("g-3's LTV-adjusted profit — not its immediate revenue — drives the SCALE call", () => {
    // Immediate revenue (1400) is below spend (2000): naive ROAS is a loser.
    // Only the known $95/conversion LTV flips this to a winner. Prove the
    // engine actually used it, not that it happened to also pass on raw revenue.
    const g3 = SAMPLE_DATA.find((r) => r.id === "g-3")!;
    expect(g3.revenue).toBeLessThan(g3.spend);
    expect(g3.ltvPerConversion).toBeGreaterThan(0);

    const withLtv = analyze(SAMPLE_DATA).recommendations.find((r) => r.entityId === "g-3")!;
    const withoutLtv = analyze(
      SAMPLE_DATA.map((r) => (r.id === "g-3" ? { ...r, ltvPerConversion: undefined } : r)),
    ).recommendations.find((r) => r.entityId === "g-3")!;

    expect(withLtv.action).toBe("SCALE");
    expect(withoutLtv.action).toBe("PAUSE");
  });

  it("reports a coherent portfolio: real spend/revenue totals and a health score in range", () => {
    const result = analyze(SAMPLE_DATA);
    const expectedSpend = SAMPLE_DATA.reduce((s, r) => s + r.spend, 0);
    // Totals use the engine's *valued* revenue: conversions × ltvPerConversion
    // when a row carries a known LTV (g-3), immediate revenue otherwise — this
    // is the same profit objective the recommendations are computed against.
    const expectedRevenue = SAMPLE_DATA.reduce(
      (s, r) => s + (r.ltvPerConversion ? r.conversions * r.ltvPerConversion : r.revenue),
      0,
    );

    expect(result.totals.spend).toBe(expectedSpend);
    expect(result.totals.revenue).toBe(expectedRevenue);
    expect(result.accountHealth).toBeGreaterThanOrEqual(0);
    expect(result.accountHealth).toBeLessThanOrEqual(100);
  });

  it("proposes a reallocation from a PAUSE candidate toward the top SCALE candidate", () => {
    const result = analyze(SAMPLE_DATA);
    expect(result.reallocation).not.toBeNull();
    const pauseIds = new Set(
      result.recommendations.filter((r) => r.action === "PAUSE").map((r) => r.entityId),
    );
    const scaleIds = new Set(
      result.recommendations.filter((r) => r.action === "SCALE").map((r) => r.entityId),
    );
    expect(pauseIds.has(result.reallocation!.fromEntityId)).toBe(true);
    expect(scaleIds.has(result.reallocation!.toEntityId)).toBe(true);
  });

  it("the CSV export of SAMPLE_DATA round-trips through the real parser to an identical analysis", () => {
    // Exercises the exact path the upload-demo UI takes: sampleCsv() -> paste
    // into the CSV box -> parseCsv() -> analyze(). Confirms the CSV encoding
    // (including the pipe-delimited ctrHistory column) loses no signal.
    const parsed = parseCsv(sampleCsv());
    expect(parsed).toHaveLength(SAMPLE_DATA.length);

    const direct = analyze(SAMPLE_DATA).recommendations.map((r) => [r.entityId, r.action]);
    const viaCsv = analyze(parsed).recommendations.map((r) => [r.entityId, r.action]);
    expect(new Map(viaCsv)).toEqual(new Map(direct));
  });
});
