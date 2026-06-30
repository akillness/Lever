import type { Recommendation } from "./types";

/**
 * CSV-escape a single field.
 *  - Quotes when it contains a comma, quote, or newline (RFC-4180).
 *  - Neutralizes spreadsheet formula injection: a field that an attacker-controlled
 *    name/rationale could start with (= + - @, or a tab/CR) is prefixed with a
 *    single quote so Excel/Sheets treat it as text, never an executable formula.
 */
function esc(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  "action",
  "entity",
  "channel",
  "projected_impact_usd",
  "confidence",
  "roas",
  "cpa",
  "epc",
  "profit",
  "rationale",
] as const;

/**
 * Serialize ranked recommendations to a CSV a buyer can paste into a sheet or
 * hand to ad-ops. Deterministic column order; fully escaped.
 */
export function recommendationsToCsv(recs: Recommendation[]): string {
  const header = COLUMNS.join(",");
  const lines = recs.map((r) =>
    [
      r.action,
      r.entityName,
      r.channel,
      r.projectedImpactUsd,
      r.confidence,
      r.metrics.roas,
      r.metrics.cpa,
      r.metrics.epc,
      r.metrics.profit,
      r.rationale,
    ]
      .map(esc)
      .join(","),
  );
  return [header, ...lines].join("\n");
}
