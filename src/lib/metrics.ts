import type { AdRow, Channel, Metrics } from "./types";

/** Safe divide: returns 0 when the denominator is 0 (avoids NaN/Infinity in the UI). */
export function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Round to a fixed number of decimals (default 2). */
export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Derive performance metrics for a single ad row. Pure, no side effects. */
export function computeMetrics(row: AdRow): Metrics {
  return {
    cpa: round(safeDiv(row.spend, row.conversions)),
    epc: round(safeDiv(row.revenue, row.clicks)),
    roas: round(safeDiv(row.revenue, row.spend), 3),
    cvr: round(safeDiv(row.conversions, row.clicks), 4),
    ctr: round(safeDiv(row.clicks, row.impressions), 4),
    cpc: round(safeDiv(row.spend, row.clicks)),
    profit: round(row.revenue - row.spend),
  };
}

/** Median of a numeric list (returns 0 for empty input). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Median CTR per channel across the dataset — the fatigue baseline. */
export function channelMedianCtr(rows: AdRow[]): Record<Channel, number> {
  const byChannel = new Map<Channel, number[]>();
  for (const row of rows) {
    const ctr = safeDiv(row.clicks, row.impressions);
    const list = byChannel.get(row.channel) ?? [];
    list.push(ctr);
    byChannel.set(row.channel, list);
  }
  const result = {} as Record<Channel, number>;
  for (const [channel, ctrs] of byChannel) {
    result[channel] = median(ctrs);
  }
  return result;
}
