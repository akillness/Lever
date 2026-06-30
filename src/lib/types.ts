// Canonical domain types for Lever — the media buyer's profit copilot.

export type Channel = "google" | "meta" | "taboola" | "tiktok";

export const CHANNELS: Channel[] = ["google", "meta", "taboola", "tiktok"];

/** A normalized ad entity (campaign / ad set) for a reporting period. */
export interface AdRow {
  id: string;
  name: string;
  channel: Channel;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  /** ISO date of the reporting period (optional). */
  date?: string;
}

/** Derived performance metrics. Computed, never persisted. */
export interface Metrics {
  cpa: number; // cost per acquisition
  epc: number; // earnings per click
  roas: number; // revenue / spend
  cvr: number; // conversion rate (conversions / clicks)
  ctr: number; // click-through rate (clicks / impressions)
  cpc: number; // cost per click
  profit: number; // revenue - spend
}

export type RecommendationAction =
  | "PAUSE"
  | "SCALE"
  | "REFRESH_CREATIVE"
  | "KEEP";

export interface Recommendation {
  entityId: string;
  entityName: string;
  channel: Channel;
  action: RecommendationAction;
  /** Higher = more urgent. Used as a tie-break behind projected impact. */
  severity: number;
  /** Plain-English, formula-backed explanation. */
  rationale: string;
  /** Projected dollar impact per reporting period (savings or incremental profit). */
  projectedImpactUsd: number;
  metrics: Metrics;
}

export interface PortfolioReallocation {
  fromEntityId: string;
  fromEntityName: string;
  toEntityId: string;
  toEntityName: string;
  amountUsd: number;
  projectedImpactUsd: number;
  rationale: string;
}

export interface AnalysisResult {
  recommendations: Recommendation[];
  reallocation: PortfolioReallocation | null;
  totals: {
    spend: number;
    revenue: number;
    profit: number;
    roas: number;
    projectedImpactUsd: number;
  };
}

/** Tunable engine configuration. Defaults are in `engine.ts`. */
export interface EngineConfig {
  /** ROAS at/above which an entity is healthy (e.g. 1.0 = breakeven). */
  targetRoas: number;
  /** Multiplier on targetRoas above which we recommend scaling. */
  scaleTrigger: number;
  /** Fraction of current budget proposed when scaling. */
  scaleStep: number;
  /** Efficiency of marginal spend vs. current (diminishing returns). */
  marginalEfficiency: number;
  /** CTR below channelMedian × fatigueRatio signals creative fatigue. */
  fatigueRatio: number;
  /** Cap REFRESH projected impact at refreshCap × profit. */
  refreshCap: number;
  /** Minimum spend before an entity carries enough signal to act on. */
  minSpend: number;
  /** Minimum conversions before PAUSE is trusted. */
  minConversions: number;
}
