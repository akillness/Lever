import type {
  AdRow,
  AnalysisResult,
  EngineConfig,
  PortfolioReallocation,
  Recommendation,
} from "./types";
import { channelMedianCtr, computeMetrics, round } from "./metrics";

export const DEFAULT_CONFIG: EngineConfig = {
  targetRoas: 1.0,
  scaleTrigger: 1.25,
  scaleStep: 0.3,
  marginalEfficiency: 0.8,
  fatigueRatio: 0.6,
  refreshCap: 0.5,
  minSpend: 250,
  minConversions: 5,
};

/**
 * Profit-objective recommendation engine — Lever's core technology.
 *
 * Deterministic: identical input + config always yields identical output.
 * Every recommendation carries a transparent, formula-backed rationale and a
 * projected dollar impact, so the buyer can trust (and defend) the move.
 */
export function analyze(
  rows: AdRow[],
  config: Partial<EngineConfig> = {},
): AnalysisResult {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...config };
  const medianCtr = channelMedianCtr(rows);
  const recommendations: Recommendation[] = [];

  for (const row of rows) {
    const m = computeMetrics(row);
    const hasSpendSignal = row.spend >= cfg.minSpend;

    // PAUSE — stop the bleed on a losing, high-signal entity.
    if (m.profit < 0 && hasSpendSignal && row.conversions >= cfg.minConversions) {
      recommendations.push({
        entityId: row.id,
        entityName: row.name,
        channel: row.channel,
        action: "PAUSE",
        severity: 3,
        projectedImpactUsd: round(Math.abs(m.profit)),
        rationale:
          `Losing money: ROAS ${m.roas} (< breakeven ${cfg.targetRoas}), ` +
          `profit $${m.profit} on $${row.spend} spend. ` +
          `Pausing stops ~$${round(Math.abs(m.profit))} of loss this period.`,
        metrics: m,
      });
      continue;
    }

    // SCALE — push more budget into a proven winner (with diminishing returns).
    if (m.roas >= cfg.targetRoas * cfg.scaleTrigger && hasSpendSignal) {
      const incSpend = round(row.spend * cfg.scaleStep);
      const incRevenue = round(incSpend * m.roas * cfg.marginalEfficiency);
      const incProfit = round(incRevenue - incSpend);
      if (incProfit > 0) {
        recommendations.push({
          entityId: row.id,
          entityName: row.name,
          channel: row.channel,
          action: "SCALE",
          severity: 2,
          projectedImpactUsd: incProfit,
          rationale:
            `Strong performer: ROAS ${m.roas} (≥ ${round(cfg.targetRoas * cfg.scaleTrigger, 2)}). ` +
            `Scaling budget +${cfg.scaleStep * 100}% ($${incSpend}) at ${cfg.marginalEfficiency * 100}% ` +
            `marginal efficiency projects ~$${incProfit} extra profit.`,
          metrics: m,
        });
        continue;
      }
    }

    // REFRESH_CREATIVE — profitable but fatigued (CTR well below channel median).
    const baseCtr = medianCtr[row.channel] ?? 0;
    if (
      m.profit > 0 &&
      hasSpendSignal &&
      baseCtr > 0 &&
      m.ctr > 0 &&
      m.ctr < baseCtr * cfg.fatigueRatio
    ) {
      const uplift = Math.min(baseCtr / m.ctr - 1, cfg.refreshCap);
      const impact = round(m.profit * uplift);
      if (impact > 0) {
        recommendations.push({
          entityId: row.id,
          entityName: row.name,
          channel: row.channel,
          action: "REFRESH_CREATIVE",
          severity: 1,
          projectedImpactUsd: impact,
          rationale:
            `Creative fatigue: CTR ${m.ctr} vs ${row.channel} median ${round(baseCtr, 4)} ` +
            `(< ${cfg.fatigueRatio * 100}% of median). Refreshing toward median could recover ~$${impact} profit.`,
          metrics: m,
        });
        continue;
      }
    }

    // KEEP — no high-leverage action; hold.
    recommendations.push({
      entityId: row.id,
      entityName: row.name,
      channel: row.channel,
      action: "KEEP",
      severity: 0,
      projectedImpactUsd: 0,
      rationale: hasSpendSignal
        ? `Healthy and stable: ROAS ${m.roas}, profit $${m.profit}. Hold and monitor.`
        : `Insufficient signal: $${row.spend} spend below $${cfg.minSpend} threshold. Gather more data.`,
      metrics: m,
    });
  }

  // Rank by projected dollar impact, then severity.
  recommendations.sort(
    (a, b) =>
      b.projectedImpactUsd - a.projectedImpactUsd || b.severity - a.severity,
  );

  const reallocation = buildReallocation(recommendations, cfg);

  const spend = round(rows.reduce((s, r) => s + r.spend, 0));
  const revenue = round(rows.reduce((s, r) => s + r.revenue, 0));
  const profit = round(revenue - spend);
  const projectedImpactUsd = round(
    recommendations.reduce((s, r) => s + r.projectedImpactUsd, 0) +
      (reallocation?.projectedImpactUsd ?? 0),
  );

  return {
    recommendations,
    reallocation,
    totals: {
      spend,
      revenue,
      profit,
      roas: spend === 0 ? 0 : round(revenue / spend, 3),
      projectedImpactUsd,
    },
  };
}

/**
 * Portfolio reallocation: take budget freed by the top PAUSE candidate and
 * direct it to the top SCALE candidate, projecting the net swing.
 */
function buildReallocation(
  recs: Recommendation[],
  cfg: EngineConfig,
): PortfolioReallocation | null {
  const pause = recs.find((r) => r.action === "PAUSE");
  const scale = recs.find((r) => r.action === "SCALE");
  if (!pause || !scale) return null;

  const amount = round(scale.metrics.profit > 0 ? scale.projectedImpactUsd / cfg.scaleStep : 0);
  const movedSpend = round(Math.min(pause.projectedImpactUsd, scale.metrics.roas > 0 ? amount : 0) || pause.projectedImpactUsd);
  const projected = round(movedSpend * (scale.metrics.roas * cfg.marginalEfficiency - 1));

  return {
    fromEntityId: pause.entityId,
    fromEntityName: pause.entityName,
    toEntityId: scale.entityId,
    toEntityName: scale.entityName,
    amountUsd: movedSpend,
    projectedImpactUsd: projected > 0 ? projected : 0,
    rationale:
      `Reallocate ~$${movedSpend} from "${pause.entityName}" (${pause.channel}, losing) ` +
      `to "${scale.entityName}" (${scale.channel}, ROAS ${scale.metrics.roas}) ` +
      `for ~$${projected > 0 ? projected : 0} projected net profit.`,
  };
}
