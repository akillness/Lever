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
  spendConfidence,
  sustainedFatigue,
  summarizeByChannel,
} from "./metrics";

/** The hard money-loss line: ROAS below this means an entity costs more than it returns. */
export const BREAKEVEN_ROAS = 1.0;

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
  pacingThreshold: 0.9,
};

/**
 * Profit-objective recommendation engine — Lever's core technology.
 *
 * Deterministic: identical input + config always yields identical output.
 * Every recommendation carries a transparent, formula-backed rationale and a
 * projected dollar impact, so the buyer can trust (and defend) the move.
 *
 * Two distinct ROAS lines drive the tiers:
 *  - breakeven (fixed 1.0): below it you lose money → PAUSE;
 *  - targetRoas (the buyer's goal): profitable but below it → REVIEW;
 *  - targetRoas × scaleTrigger: a proven winner → SCALE.
 */
export function analyze(
  rows: AdRow[],
  config: Partial<EngineConfig> = {},
): AnalysisResult {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...config };
  const medianCtr = channelMedianCtr(rows);
  const recommendations: Recommendation[] = [];

  for (const row of rows) {
    const m = computeMetrics(row, cfg.channelLtv);
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
        // Zero-conversion waste is certain in proportion to how much is burning,
        // so confidence scales with spend depth, not the absent conversion volume.
        confidence: spendConfidence(row.spend, cfg.minSpend),
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
          `Losing money: ROAS ${m.roas} (< breakeven ${BREAKEVEN_ROAS.toFixed(1)}), ` +
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
        // Budget-capped winner: spend sits at/near its configured cap, so proven
        // demand is being throttled. The incremental budget converts at the
        // established rate rather than speculatively, so we lift confidence (as the
        // sustained-fatigue rule does for stronger evidence) and call out the cap.
        const budget = row.budget;
        const capped =
          budget != null && budget > 0 && row.spend >= budget * cfg.pacingThreshold;
        const scaleConfidence = capped
          ? round(Math.min(1, confidence + 0.1), 2)
          : confidence;
        const capNote =
          capped && budget != null
            ? ` Budget-capped: spent $${round(row.spend)} of a $${round(budget)} cap ` +
              `(${Math.round((row.spend / budget) * 100)}% pacing) — demand is throttled, ` +
              `so raise the cap to capture it.`
            : "";
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
            `marginal efficiency projects ~$${incProfit} extra profit.` +
            capNote,
          confidence: scaleConfidence,
          metrics: m,
        });
        continue;
      }
    }

    // REFRESH_CREATIVE — profitable but fatigued. Three independent fatigue signals:
    //  (a) cross-sectional: CTR well below the channel median this period;
    //  (b) period-over-period: CTR fell sharply vs this entity's own prior period;
    //  (c) multi-period: a sustained decline across 3+ periods toward the recent peak.
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

      // Sustained multi-period decline — the most trustworthy fatigue evidence.
      const trend = sustainedFatigue(m.ctr, row.ctrHistory, cfg.fatigueDeclineRatio);
      const seriesUplift = trend.declining
        ? Math.min(trend.peak / m.ctr - 1, cfg.refreshCap)
        : 0;

      const uplift = Math.max(medianUplift, trendUplift, seriesUplift);
      const impact = round(m.profit * uplift);
      if (uplift > 0 && impact > 0) {
        const seriesDominant =
          trend.declining && seriesUplift >= medianUplift && seriesUplift >= trendUplift;
        const trendDominant = !seriesDominant && declined && trendUplift >= medianUplift;
        let signal: string;
        // A sustained decline across N periods is high-certainty fatigue, so when it
        // leads we lift confidence in proportion to the length of the losing run.
        let refreshConfidence = confidence;
        if (seriesDominant) {
          signal =
            `CTR declined ${trend.consecutiveDrops} periods running to ${m.ctr} ` +
            `from a ${trend.periods}-period peak of ${trend.peak} (−${trend.dropPct}%)`;
          refreshConfidence = round(
            Math.min(1, confidence + 0.05 * trend.consecutiveDrops),
            2,
          );
        } else if (trendDominant) {
          signal =
            `CTR fell to ${m.ctr} from ${round(prior, 4)} last period ` +
            `(−${round((1 - m.ctr / prior) * 100, 1)}% vs ≥${cfg.fatigueDeclineRatio * 100}% trigger)`;
        } else {
          signal =
            `CTR ${m.ctr} vs ${row.channel} median ${round(baseCtr, 4)} ` +
            `(< ${cfg.fatigueRatio * 100}% of median)`;
        }
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
          confidence: refreshConfidence,
          metrics: m,
        });
        continue;
      }
    }

    // REVIEW — profitable, but below the buyer's own target ROAS (only fires when
    // targetRoas > breakeven). A profit copilot must not call a sub-target campaign
    // "healthy"; it flags the gap to close rather than promising a guaranteed dollar.
    if (hasSpendSignal && m.roas < cfg.targetRoas) {
      const shortfall = round(row.spend * (cfg.targetRoas - m.roas));
      recommendations.push({
        entityId: row.id,
        entityName: row.name,
        channel: row.channel,
        action: "REVIEW",
        severity: 1,
        projectedImpactUsd: 0,
        rationale:
          `Below target: ROAS ${m.roas} (< target ${round(cfg.targetRoas, 2)}) — ` +
          `profitable but ~$${shortfall} short of your goal on $${row.spend} spend. ` +
          `Optimize bid/creative/audience or trim before it slips under breakeven.`,
        confidence,
        metrics: m,
      });
      continue;
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

  // Rank by projected dollar impact, then severity, then entityId for a fully
  // stable, defensible deterministic order (no reliance on input ordering).
  recommendations.sort(
    (a, b) =>
      b.projectedImpactUsd - a.projectedImpactUsd ||
      b.severity - a.severity ||
      a.entityId.localeCompare(b.entityId),
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const reallocation = buildReallocation(recommendations, byId, cfg);

  const spend = round(rows.reduce((s, r) => s + r.spend, 0));
  const revenue = round(rows.reduce((s, r) => s + effectiveRevenue(r, cfg.channelLtv), 0));
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
    byChannel: summarizeByChannel(rows, cfg.channelLtv),
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
  const revenue = rows.reduce((s, r) => s + effectiveRevenue(r, cfg.channelLtv), 0);
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
 * Portfolio reallocation: redeploy the budget freed by the top PAUSE candidate
 * into the top SCALE candidate. To stay consistent with the engine's stated
 * diminishing-returns stance, only the share the winner can absorb at the quoted
 * marginal efficiency — `scaleStep × winner spend` — is moved at the full rate;
 * any remaining freed budget is called out for spreading rather than over-credited.
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
  const freedBudget = round(byId.get(pause.entityId)?.spend ?? 0);
  // The winner absorbs new budget at the same diminishing-returns step the SCALE
  // rule justifies; pushing the entire freed budget in at flat efficiency overstates.
  const winnerSpend = byId.get(scale.entityId)?.spend ?? 0;
  const absorbable = round(winnerSpend * cfg.scaleStep);
  const movedSpend = Math.min(freedBudget, absorbable);
  const remainder = round(freedBudget - movedSpend);
  const projected = Math.max(
    0,
    round(movedSpend * (scale.metrics.roas * cfg.marginalEfficiency - 1)),
  );

  const spreadNote =
    remainder > 0
      ? ` ~$${remainder} of the freed budget exceeds what this winner can absorb at quoted efficiency — spread it across other on-target entities.`
      : "";

  return {
    fromEntityId: pause.entityId,
    fromEntityName: pause.entityName,
    toEntityId: scale.entityId,
    toEntityName: scale.entityName,
    amountUsd: movedSpend,
    projectedImpactUsd: projected,
    rationale:
      `Reallocate ~$${movedSpend} freed from "${pause.entityName}" (${pause.channel}, losing) ` +
      `into "${scale.entityName}" (${scale.channel}, ROAS ${scale.metrics.roas}) ` +
      `for ~$${projected} projected net profit at ${cfg.marginalEfficiency * 100}% marginal efficiency.` +
      spreadNote,
  };
}
