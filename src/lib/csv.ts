import type { AdRow, Channel } from "./types";
import { CHANNELS } from "./types";

/** Header aliases so the parser tolerates real-world ad-platform exports. */
const FIELD_ALIASES: Record<keyof AdRow, string[]> = {
  id: ["id", "campaign_id", "adset_id", "ad_id"],
  name: ["name", "campaign", "campaign_name", "adset", "adset_name", "ad_name"],
  channel: ["channel", "platform", "source", "network"],
  spend: ["spend", "cost", "amount_spent", "spend_usd"],
  revenue: ["revenue", "conversion_value", "value", "sales", "payout"],
  conversions: ["conversions", "conv", "leads", "results", "purchases"],
  clicks: ["clicks", "link_clicks"],
  impressions: ["impressions", "impr", "imps"],
  date: ["date", "day", "reporting_date"],
};

function normalizeChannel(value: string): Channel {
  const v = value.trim().toLowerCase();
  if (v.includes("google") || v === "adwords" || v === "gads") return "google";
  if (v.includes("meta") || v.includes("facebook") || v === "fb" || v.includes("instagram"))
    return "meta";
  if (v.includes("taboola")) return "taboola";
  if (v.includes("tiktok") || v === "tt") return "tiktok";
  return (CHANNELS.includes(v as Channel) ? v : "google") as Channel;
}

function toNumber(value: string | undefined): number {
  if (value == null) return 0;
  const n = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Split a CSV line respecting double-quoted fields. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function resolveIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a schema-tolerant CSV export into canonical AdRows.
 * Unknown rows are skipped; missing numerics default to 0.
 */
export function parseCsv(text: string): AdRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {} as Record<keyof AdRow, number>;
  (Object.keys(FIELD_ALIASES) as (keyof AdRow)[]).forEach((field) => {
    idx[field] = resolveIndex(headers, FIELD_ALIASES[field]);
  });

  const rows: AdRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const get = (field: keyof AdRow) =>
      idx[field] === -1 ? undefined : cells[idx[field]];

    const name = get("name") ?? `Row ${i}`;
    rows.push({
      id: get("id") || `row-${i}`,
      name,
      channel: normalizeChannel(get("channel") ?? "google"),
      spend: toNumber(get("spend")),
      revenue: toNumber(get("revenue")),
      conversions: toNumber(get("conversions")),
      clicks: toNumber(get("clicks")),
      impressions: toNumber(get("impressions")),
      date: get("date") || undefined,
    });
  }
  return rows;
}
