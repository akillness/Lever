import type {
  AdRow,
  AnalysisResult,
  EngineConfig,
  PortfolioReallocation,
  Recommendation,
} from "./types";
import {
  channelMedianCtr,
  computeMetrics,
  effectiveRevenue,
  round,
  signalConfidence,
  summarizeByChannel,
} from "./metrics";

export const DEFAULT_CONFIG: EngineConfig = {
  targetRoas: 1.0,
  scaleTrigger: 1.25,
  scaleStep: 0.3,
  marginalEfficiency: 0.8,
  fatigueRatio: 0.6,
  fatigueDeclineRatio: 0.25,
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
    const confidence = signalConfidence(
      row.spend,
      row.conversions,
      cfg.minSpend,
      cfg.minConversions,
    );

    // BUDGET LEAK — meaningful spend with zero conversions: pure waste, most urgent.
    if (hasSpendSignal && row.conversions === 0) {
      recommendations.push({
        entityId: row.id,
        entityName: row.name,
        channel: row.channel,
        action: "PAUSE",
        severity: 4,
        projectedImpactUsd: round(row.spend),
        rationale:
          `Budget leak: $${row.spend} spend, 0 conversions (ROAS ${m.roas}). ` +
          `No signal of working — pausing recovers the full ~$${round(row.spend)}.`,
        confidence,
        metrics: m,
      });
      continue;
    }

    // PAUSE — stop the bleed on any losing, high-spend entity. Thin-signal losers
    // still surface (a money-loser is never "healthy"); their confidence reflects it.
    if (m.profit < 0 && hasSpendSignal) {
      const thin = row.conversions < cfg.minConversions;
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
          `Pausing stops ~$${round(Math.abs(m.profit))} of loss this period.` +
          (thin
            ? ` Thin signal (${row.conversions} conv) — low confidence; verify before pausing.`
            : ""),
        confidence,
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
          confidence,
          metrics: m,
        });
        continue;
      }
    }

    // REFRESH_CREATIVE — profitable but fatigued. Two independent fatigue signals:
    //  (a) cross-sectional: CTR well below the channel median this period;
    //  (b) period-over-period: CTR fell sharply vs this entity's own prior period.
    // We take whichever recovery estimate is larger (capped), so a creative that is
    // decaying against itself is caught even while still above the channel median.
    const baseCtr = medianCtr[row.channel] ?? 0;
    if (m.profit > 0 && hasSpendSignal && m.ctr > 0) {
      const belowMedian = baseCtr > 0 && m.ctr < baseCtr * cfg.fatigueRatio;
      const medianUplift = belowMedian
        ? Math.min(baseCtr / m.ctr - 1, cfg.refreshCap)
        : 0;

      const prior = row.priorCtr ?? 0;
      const declined = prior > 0 && m.ctr <= prior * (1 - cfg.fatigueDeclineRatio);
      const trendUplift = declined
        ? Math.min(prior / m.ctr - 1, cfg.refreshCap)
        : 0;

      const uplift = Math.max(medianUplift, trendUplift);
      const impact = round(m.profit * uplift);
      if (uplift > 0 && impact > 0) {
        const trendDominant = declined && trendUplift >= medianUplift;
        const signal = trendDominant
          ? `CTR fell to ${m.ctr} from ${round(prior, 4)} last period ` +
            `(−${round((1 - m.ctr / prior) * 100, 1)}% vs ≥${cfg.fatigueDeclineRatio * 100}% trigger)`
          : `CTR ${m.ctr} vs ${row.channel} median ${round(baseCtr, 4)} ` +
            `(< ${cfg.fatigueRatio * 100}% of median)`;
        recommendations.push({
          entityId: row.id,
          entityName: row.name,
          channel: row.channel,
          action: "REFRESH_CREATIVE",
          severity: 1,
          projectedImpactUsd: impact,
          rationale:
            `Creative fatigue: ${signal}. ` +
            `Refreshing toward the baseline could recover ~$${impact} profit.`,
          confidence,
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
      confidence,
      metrics: m,
    });
  }

  // Rank by projected dollar impact, then severity.
  recommendations.sort(
    (a, b) =>
      b.projectedImpactUsd - a.projectedImpactUsd || b.severity - a.severity,
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const reallocation = buildReallocation(recommendations, byId, cfg);

  const spend = round(rows.reduce((s, r) => s + r.spend, 0));
  const revenue = round(rows.reduce((s, r) => s + effectiveRevenue(r), 0));
  const profit = round(revenue - spend);
  // Headline impact = the ranked recommendations only. Reallocation is an
  // alternative framing of redeploying the SAME freed budget, so it is reported
  // separately (in `reallocation`) and never double-counted into this number.
  const projectedImpactUsd = round(
    recommendations.reduce((s, r) => s + r.projectedImpactUsd, 0),
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
    accountHealth: accountHealth(rows, recommendations, cfg),
    byChannel: summarizeByChannel(rows),
  };
}

/**
 * Portfolio health, 0..100. Blends two interpretable factors:
 *  - ROAS vs target (60%): blended ROAS relative to 1.5× the breakeven target.
 *  - Budget discipline (40%): the inverse share of spend sitting on PAUSE'd entities.
 * Deterministic and clamped, so it reads as a stable exec-level number.
 */
export function accountHealth(
  rows: AdRow[],
  recs: Recommendation[],
  cfg: EngineConfig,
): number {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const revenue = rows.reduce((s, r) => s + effectiveRevenue(r), 0);
  if (spend === 0) return 0;

  const blendedRoas = revenue / spend;
  const roasFactor = Math.min(1, blendedRoas / (cfg.targetRoas * 1.5));

  const pausedIds = new Set(
    recs.filter((r) => r.action === "PAUSE").map((r) => r.entityId),
  );
  const leakSpend = rows
    .filter((r) => pausedIds.has(r.id))
    .reduce((s, r) => s + r.spend, 0);
  const disciplineFactor = 1 - leakSpend / spend;

  const score = 0.6 * roasFactor + 0.4 * disciplineFactor;
  return Math.round(100 * Math.max(0, Math.min(1, score)));
}

/**
 * Portfolio reallocation: redeploy the budget actually freed by the top PAUSE
 * candidate into the top SCALE candidate, and project the net incremental profit
 * on that real freed budget (winner's ROAS × marginal efficiency − 1).
 */
function buildReallocation(
  recs: Recommendation[],
  byId: Map<string, AdRow>,
  cfg: EngineConfig,
): PortfolioReallocation | null {
  const pause = recs.find((r) => r.action === "PAUSE");
  const scale = recs.find((r) => r.action === "SCALE");
  if (!pause || !scale) return null;

  // The freed budget is the loser's actual spend — the dollars you stop wasting.
  const freedBudget = byId.get(pause.entityId)?.spend ?? 0;
  const movedSpend = round(freedBudget);
  const projected = Math.max(
    0,
    round(movedSpend * (scale.metrics.roas * cfg.marginalEfficiency - 1)),
  );

  return {
    fromEntityId: pause.entityId,
    fromEntityName: pause.entityName,
    toEntityId: scale.entityId,
    toEntityName: scale.entityName,
    amountUsd: movedSpend,
    projectedImpactUsd: projected,
    rationale:
      `Reallocate the ~$${movedSpend} freed from "${pause.entityName}" (${pause.channel}, losing) ` +
      `into "${scale.entityName}" (${scale.channel}, ROAS ${scale.metrics.roas}) ` +
      `for ~$${projected} projected net profit at ${cfg.marginalEfficiency * 100}% marginal efficiency.`,
  };
}
