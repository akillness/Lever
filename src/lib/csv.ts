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
  priorCtr: ["prior_ctr", "previous_ctr", "ctr_prev", "last_ctr"],
  ltvPerConversion: ["ltv", "ltv_per_conversion", "value_per_conversion", "payout_ltv"],
};

function normalizeChannel(value: string): Channel {
  const v = value.trim().toLowerCase();
  if (v.includes("google") || v === "adwords" || v === "gads") return "google";
  if (v.includes("meta") || v.includes("facebook") || v === "fb" || v.includes("instagram"))
    return "meta";
  if (v.includes("taboola")) return "taboola";
  if (v.includes("tiktok") || v === "tt") return "tiktok";
  // Unrecognized platforms are tagged "other" — never silently misattributed.
  return (CHANNELS.includes(v as Channel) ? v : "other") as Channel;
}

function toNumber(value: string | undefined): number {
  if (value == null) return 0;
  const n = Number(value.replace(/[$,%\s]/g, ""));
  // Negative spend/revenue/etc. is invalid in this domain — clamp to 0.
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Parse an optional positive rate (e.g. a prior-period CTR like 0.05).
 * Blank, non-numeric, or non-positive values mean "no prior signal" (undefined),
 * so the trend-fatigue rule simply does not fire rather than misreading a 0.
 */
function toOptionalRate(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Tokenize an entire CSV document into records, respecting RFC-4180 quoting:
 * double-quoted fields may contain commas, embedded newlines, and "" escapes.
 */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // any char seen for the current record?
  const pushField = () => {
    record.push(field.trim());
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ",") {
      pushField();
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      // Swallow \r\n as a single break; end the record only if non-empty.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (started || field.length > 0) pushRecord();
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field.length > 0 || record.length > 0) pushRecord();
  return records;
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
  const records = parseRecords(text);
  if (records.length < 2) return [];

  const headers = records[0].map((h) => h.toLowerCase());
  const idx = {} as Record<keyof AdRow, number>;
  (Object.keys(FIELD_ALIASES) as (keyof AdRow)[]).forEach((field) => {
    idx[field] = resolveIndex(headers, FIELD_ALIASES[field]);
  });

  const rows: AdRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
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
      priorCtr: toOptionalRate(get("priorCtr")),
      ltvPerConversion: toOptionalRate(get("ltvPerConversion")),
    });
  }
  return rows;
}

/** Coerce one untrusted value into a finite, non-negative number. */
function nonNeg(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Coerce one untrusted value into a positive rate, or undefined (no signal). */
function optRate(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Validate/coerce an arbitrary JSON payload (e.g. an API body) into safe AdRows.
 * Drops non-object entries; normalizes channel; clamps negatives; never throws.
 */
export function sanitizeAdRows(input: unknown): AdRow[] {
  if (!Array.isArray(input)) return [];
  const rows: AdRow[] = [];
  input.forEach((raw, i) => {
    if (raw == null || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    rows.push({
      id: typeof r.id === "string" && r.id ? r.id : `row-${i + 1}`,
      name: typeof r.name === "string" && r.name ? r.name : `Row ${i + 1}`,
      channel: normalizeChannel(typeof r.channel === "string" ? r.channel : "google"),
      spend: nonNeg(r.spend),
      revenue: nonNeg(r.revenue),
      conversions: nonNeg(r.conversions),
      clicks: nonNeg(r.clicks),
      impressions: nonNeg(r.impressions),
      date: typeof r.date === "string" ? r.date : undefined,
      priorCtr: optRate(r.priorCtr),
      ltvPerConversion: optRate(r.ltvPerConversion),
    });
  });
  return rows;
}