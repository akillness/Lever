import { describe, expect, it } from "vitest";
import type { AdRow, AnalysisResult, Recommendation } from "./types";
import type { Fetcher } from "./channels/types";
import {
  SHEET_HEADER,
  buildSheetRows,
  buildSyncPayload,
  dedupe,
  dedupeKey,
  pushToSheet,
  sortNewestFirst,
} from "./sheets";

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    entityId: "x",
    entityName: "X",
    channel: "google",
    action: "KEEP",
    severity: 1,
    rationale: "ok",
    confidence: 0.8,
    projectedImpactUsd: 0,
    metrics: { cpa: 0, epc: 0, roas: 2, cvr: 0, ctr: 0, cpc: 0, profit: 50 },
    ...over,
  };
}

function adRow(over: Partial<AdRow>): AdRow {
  return {
    id: "x",
    name: "X",
    channel: "google",
    spend: 100,
    revenue: 200,
    conversions: 10,
    clicks: 50,
    impressions: 1000,
    ...over,
  };
}

function result(recs: Recommendation[]): AnalysisResult {
  return {
    recommendations: recs,
    reallocation: null,
    totals: { spend: 0, revenue: 0, profit: 0, roas: 0, projectedImpactUsd: 0 },
    accountHealth: 50,
    byChannel: [],
  };
}

describe("buildSheetRows", () => {
  it("joins recommendations to source rows and stamps runDate when no row date", () => {
    const rows = [adRow({ id: "a", spend: 300, revenue: 600, date: "2026-06-10" })];
    const recs = [
      rec({ entityId: "a", action: "SCALE", projectedImpactUsd: 120, metrics: { cpa: 30, epc: 1, roas: 2, cvr: 0.2, ctr: 0.05, cpc: 6, profit: 300 } }),
    ];
    const [row] = buildSheetRows(rows, result(recs), "2026-06-30");
    expect(row).toMatchObject({
      date: "2026-06-10",
      entityId: "a",
      action: "SCALE",
      spend: 300,
      revenue: 600,
      roas: 2,
      profit: 300,
      projectedImpactUsd: 120,
    });
  });

  it("falls back to runDate when the source row has no date", () => {
    const rows = [adRow({ id: "a" })];
    const [row] = buildSheetRows(rows, result([rec({ entityId: "a" })]), "2026-06-30");
    expect(row.date).toBe("2026-06-30");
  });

  it("sorts newest-first and de-duplicates by date|channel|entityId", () => {
    const rows = [adRow({ id: "a", date: "2026-06-01" }), adRow({ id: "b", date: "2026-06-20" })];
    const recs = [
      rec({ entityId: "a", projectedImpactUsd: 10 }),
      rec({ entityId: "b", projectedImpactUsd: 90 }),
      rec({ entityId: "b", projectedImpactUsd: 5 }), // dup key for b/2026-06-20
    ];
    const out = buildSheetRows(rows, result(recs), "2026-06-30");
    expect(out.map((r) => r.entityId)).toEqual(["b", "a"]);
    // The higher-impact b row survives dedupe after sorting.
    expect(out[0].projectedImpactUsd).toBe(90);
  });
});

describe("sort + dedupe helpers", () => {
  const base = {
    channel: "google" as const,
    entityName: "n",
    spend: 0,
    revenue: 0,
    conversions: 0,
    clicks: 0,
    impressions: 0,
    roas: 0,
    cpa: 0,
    profit: 0,
    action: "KEEP" as const,
    rationale: "",
  };

  it("sortNewestFirst orders by date desc then impact desc", () => {
    const sorted = sortNewestFirst([
      { ...base, date: "2026-06-01", entityId: "a", projectedImpactUsd: 5 },
      { ...base, date: "2026-06-05", entityId: "b", projectedImpactUsd: 1 },
      { ...base, date: "2026-06-05", entityId: "c", projectedImpactUsd: 9 },
    ]);
    expect(sorted.map((r) => r.entityId)).toEqual(["c", "b", "a"]);
  });

  it("dedupeKey combines date, channel, entityId", () => {
    expect(dedupeKey({ date: "2026-06-01", channel: "meta", entityId: "z" })).toBe(
      "2026-06-01|meta|z",
    );
  });

  it("dedupe keeps first occurrence per key", () => {
    const out = dedupe([
      { ...base, date: "d", entityId: "a", projectedImpactUsd: 2 },
      { ...base, date: "d", entityId: "a", projectedImpactUsd: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].projectedImpactUsd).toBe(2);
  });
});

describe("buildSyncPayload + pushToSheet", () => {
  it("packages header + rows + token", () => {
    const payload = buildSyncPayload(
      [adRow({ id: "a", date: "2026-06-10" })],
      result([rec({ entityId: "a" })]),
      "2026-06-30",
      "secret",
    );
    expect(payload.header).toEqual(SHEET_HEADER);
    expect(payload.token).toBe("secret");
    expect(payload.rows).toHaveLength(1);
  });

  it("posts JSON to the webhook and returns the parsed result", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetcher: Fetcher = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ appended: 1, updated: 0 }) };
    };
    const payload = buildSyncPayload([], result([]), "2026-06-30", "t");
    const out = await pushToSheet("https://script.example/exec", payload, fetcher);
    expect(out).toEqual({ appended: 1, updated: 0 });
    expect(captured!.url).toBe("https://script.example/exec");
    expect(captured!.init?.method).toBe("POST");
    expect(String(captured!.init?.body)).toContain('"token":"t"');
  });

  it("throws on a missing URL or non-2xx response", async () => {
    await expect(
      pushToSheet("", buildSyncPayload([], result([]), "d")),
    ).rejects.toThrow(/URL is required/);
    const fail: Fetcher = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      pushToSheet("https://x", buildSyncPayload([], result([]), "d"), fail, {
        retries: 0,
      }),
    ).rejects.toThrow(/500/);
  });

  it("retries a transient 503 then returns the eventual success", async () => {
    const statuses = [503, 200];
    let i = 0;
    const delays: number[] = [];
    const fetcher: Fetcher = async () => {
      const status = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      return {
        ok: status < 400,
        status,
        json: async () => ({ appended: 2, updated: 1 }),
      };
    };
    const out = await pushToSheet(
      "https://script.example/exec",
      buildSyncPayload([], result([]), "2026-06-30"),
      fetcher,
      { baseDelayMs: 1, sleep: async (ms) => void delays.push(ms) },
    );
    expect(out).toEqual({ appended: 2, updated: 1 });
    expect(i).toBe(2); // one retry after the 503
    expect(delays).toEqual([1]);
  });
});
