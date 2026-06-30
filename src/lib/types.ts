// Canonical domain types for Lever — the media buyer's profit copilot.

export type Channel = "google" | "meta" | "taboola" | "tiktok" | "other";

export const CHANNELS: Channel[] = ["google", "meta", "taboola", "tiktok", "other"];

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
  /** This entity's CTR in the prior reporting period, for trend-fatigue detection (optional). */
  priorCtr?: number;
  /**
   * Known first-party lifetime value per conversion (optional). When present,
   * the engine values revenue as `conversions × ltvPerConversion` instead of the
   * immediately-attributed `revenue`, so profit decisions reflect downstream value.
   */
  ltvPerConversion?: number;
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
  /** Confidence in the recommendation, 0..1, from spend/conversion signal strength. */
  confidence: number;
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

export interface ChannelSummary {
  channel: Channel;
  spend: number;
  revenue: number;
  profit: number;
  roas: number;
  entities: number;
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
  /** Portfolio health 0..100: blends profitability against target with budget-leak share. */
  accountHealth: number;
  byChannel: ChannelSummary[];
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
  /** Period-over-period CTR drop (vs the entity's own priorCtr) that signals fatigue. */
  fatigueDeclineRatio: number;
  /** Cap REFRESH projected impact at refreshCap × profit. */
  refreshCap: number;
  /** Minimum spend before an entity carries enough signal to act on. */
  minSpend: number;
  /** Minimum conversions before PAUSE is trusted. */
  minConversions: number;
}
