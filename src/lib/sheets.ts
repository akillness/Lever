/**
 * Google Sheets sync — shapes an analysis run into flat, newest-first rows and
 * pushes them to an Apps Script web app, which appends/upserts them into a
 * sheet and runs scheduled management automation (see apps-script/Code.gs).
 *
 * The transform functions are pure (offline-testable); the network push takes
 * an injectable fetcher.
 */
import type { AdRow, AnalysisResult, Channel, EngineConfig, RecommendationAction } from "./types";
import { fetchWithRetry, type Fetcher, type RetryOptions } from "./channels/types";
import { sanitizeConfig } from "./configInput";


/** One spreadsheet row: a campaign's metrics + the engine's verdict. */
export interface SheetRow {
  date: string;
  channel: Channel;
  entityId: string;
  entityName: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
  cpa: number;
  profit: number;
  action: RecommendationAction;
  projectedImpactUsd: number;
  rationale: string;
}

/** Column order written to the sheet header. Keep in sync with {@link SheetRow}. */
export const SHEET_HEADER: (keyof SheetRow)[] = [
  "date",
  "channel",
  "entityId",
  "entityName",
  "spend",
  "revenue",
  "conversions",
  "clicks",
  "impressions",
  "roas",
  "cpa",
  "profit",
  "action",
  "projectedImpactUsd",
  "rationale",
];

/** Stable per-row identity for cross-run upserts: one row per entity per date. */
export function dedupeKey(row: Pick<SheetRow, "date" | "channel" | "entityId">): string {
  return `${row.date}|${row.channel}|${row.entityId}`;
}

/** Sort newest-first: by date desc, then by projected $ impact desc. */
export function sortNewestFirst(rows: SheetRow[]): SheetRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      b.projectedImpactUsd - a.projectedImpactUsd,
  );
}

/** Drop duplicate keys, keeping the first occurrence (call after sorting). */
export function dedupe(rows: SheetRow[]): SheetRow[] {
  const seen = new Set<string>();
  const out: SheetRow[] = [];
  for (const row of rows) {
    const k = dedupeKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Join the ranked recommendations (action, metrics, $ impact) back to their
 * source ad rows (raw spend/revenue/etc.) into flat sheet rows, newest-first
 * and de-duplicated. `runDate` stamps rows that carry no per-row date.
 */
export function buildSheetRows(
  rows: AdRow[],
  result: AnalysisResult,
  runDate: string,
): SheetRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sheetRows = result.recommendations.map((rec): SheetRow => {
    const src = byId.get(rec.entityId);
    return {
      date: src?.date || runDate,
      channel: rec.channel,
      entityId: rec.entityId,
      entityName: rec.entityName,
      spend: src?.spend ?? 0,
      revenue: src?.revenue ?? 0,
      conversions: src?.conversions ?? 0,
      clicks: src?.clicks ?? 0,
      impressions: src?.impressions ?? 0,
      roas: rec.metrics.roas,
      cpa: rec.metrics.cpa,
      profit: rec.metrics.profit,
      action: rec.action,
      projectedImpactUsd: rec.projectedImpactUsd,
      rationale: rec.rationale,
    };
  });
  return dedupe(sortNewestFirst(sheetRows));
}

/** Payload posted to the Apps Script web app. */
export interface SheetSyncPayload {
  header: (keyof SheetRow)[];
  rows: SheetRow[];
  /** Shared secret matching the Apps Script SHEET_TOKEN, to gate the web app. */
  token?: string;
}

/** Assemble a ready-to-post payload for an analysis run. */
export function buildSyncPayload(
  rows: AdRow[],
  result: AnalysisResult,
  runDate: string,
  token?: string,
): SheetSyncPayload {
  return { header: SHEET_HEADER, rows: buildSheetRows(rows, result, runDate), token };
}

/**
 * POST the payload to the Apps Script web app URL. Returns the parsed response.
 * The call is timeout-bounded and retries transient failures (429/5xx, network
 * blips) with backoff so a momentary Apps Script hiccup doesn't drop a sync;
 * throws on a non-2xx that survives the retries so callers surface real failures
 * rather than silently losing data. `opts` tunes the retry budget (tests inject
 * a fake sleep to stay fast).
 */
export async function pushToSheet(
  webhookUrl: string,
  payload: SheetSyncPayload,
  fetcher: Fetcher = fetch,
  opts: RetryOptions = {},
): Promise<{ appended?: number; updated?: number } & Record<string, unknown>> {
  if (!webhookUrl) throw new Error("sheets webhook URL is required");
  const res = await fetchWithRetry(
    fetcher,
    webhookUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    opts,
  );
  if (!res.ok) throw new Error(`sheets sync failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** True when a Sheets web app URL is configured. */
export function hasSheetsConfig(): boolean {
  return Boolean(process.env.LEVER_SHEETS_WEBHOOK_URL);
}

/**
 * Build the Apps Script GET URL that reads back the Config tab. Uses the URL
 * API so the query string is appended before any fragment (`#...`) rather
 * than inside it — a naive string-concat would silently drop `action`/`token`
 * from the request if a webhook URL ever carried a fragment. Falls back to a
 * simple concat for a relative/malformed URL that `URL` can't parse (Apps
 * Script deployment URLs are always absolute in practice, so this path is
 * defensive, not expected to trigger).
 */
export function buildConfigUrl(webhookUrl: string, token?: string): string {
  try {
    const u = new URL(webhookUrl);
    u.searchParams.set("action", "config");
    if (token) u.searchParams.set("token", token);
    return u.toString();
  } catch {
    const params = new URLSearchParams({ action: "config" });
    if (token) params.set("token", token);
    const sep = webhookUrl.includes("?") ? "&" : "?";
    return `${webhookUrl}${sep}${params.toString()}`;
  }
}

/**
 * A config read is best-effort and non-critical (unlike the sync push, which
 * really shouldn't lose data) — default to a single short-timeout attempt
 * rather than {@link fetchWithRetry}'s normal 3-attempt/15s-per-attempt
 * budget, so a slow or hanging Apps Script response can't add tens of
 * seconds of latency to every ingest run. Callers that want more resilience
 * here can still pass a wider `opts`.
 */
const CONFIG_FETCH_DEFAULTS: RetryOptions = { retries: 0, timeoutMs: 5000 };

/**
 * Read the engine config the PM edits directly in the Sheet's Config tab
 * back into Lever — the write-back half of the Sheets integration (the push
 * side is {@link pushToSheet}). Best-effort and never throws: any failure
 * (no URL configured, network error, non-2xx, `{ok:false}`, or a response
 * that isn't valid config) resolves to `{}` so a Sheet outage or a PM typo
 * never blocks or corrupts an ingest run — {@link sanitizeConfig} also drops
 * any non-numeric/out-of-range field individually rather than rejecting the
 * whole response. Timeout-bounded via {@link fetchWithRetry}, defaulting to
 * a single 5s attempt (see {@link CONFIG_FETCH_DEFAULTS}).
 */
export async function fetchSheetConfig(
  webhookUrl: string,
  token?: string,
  fetcher: Fetcher = fetch,
  opts: RetryOptions = {},
): Promise<Partial<EngineConfig>> {
  if (!webhookUrl) return {};
  try {
    const res = await fetchWithRetry(fetcher, buildConfigUrl(webhookUrl, token), {}, {
      ...CONFIG_FETCH_DEFAULTS,
      ...opts,
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { ok?: boolean; config?: unknown };
    if (!body || body.ok === false) return {};
    return sanitizeConfig(body.config);
  } catch {
    return {};
  }
}
