import type { AdRow, Channel } from "../types";

/** Inclusive reporting window in YYYY-MM-DD. */
export interface DateRange {
  start: string;
  end: string;
}

/** Injectable fetch so connectors are unit-testable offline. Matches global fetch. */
export type Fetcher = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Free developer-API path for a channel — documented so onboarding is concrete. */
export interface FreeTierInfo {
  /** Human label, e.g. "Google Ads API (Basic Access)". */
  api: string;
  /** Where to request the free credentials. */
  docsUrl: string;
  /** Auth mechanism the connector expects. */
  authType: "oauth2-bearer" | "access-token" | "api-key";
  /** Plain-language notes about the free tier / quotas. */
  notes: string;
}

/**
 * A channel connector turns a platform's native reporting response into
 * canonical {@link AdRow}s. `normalize` is pure (offline-testable); `fetchRows`
 * builds the request and delegates the network call to an injectable fetcher.
 */
export interface ChannelConnector {
  channel: Channel;
  freeTier: FreeTierInfo;
  /** Credential field names this connector needs to operate. */
  requiredCredentials: string[];
  /** True when the supplied credential object has every required field. */
  isConfigured(creds: Record<string, unknown> | null | undefined): boolean;
  /** Pure transform: platform report JSON → canonical rows. Never throws on shape gaps. */
  normalize(raw: unknown): AdRow[];
  /** Fetch + normalize a reporting window. Throws if not configured or the API errors. */
  fetchRows(
    creds: Record<string, unknown>,
    range: DateRange,
    fetcher?: Fetcher,
  ): Promise<AdRow[]>;
}

/** Keep only non-null object elements of an array (untrusted report rows). */
export function objectRows<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter((r) => r != null && typeof r === "object") as T[])
    : [];
}

/** Coerce any value to a finite, non-negative number (report cells are untrusted). */
export function num(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,%\s]/g, ""))
        : NaN;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Verify every required field is present and non-empty on a credential object. */
export function hasFields(
  creds: Record<string, unknown> | null | undefined,
  fields: string[],
): boolean {
  if (!creds || typeof creds !== "object") return false;
  return fields.every((f) => {
    const v = (creds as Record<string, unknown>)[f];
    return typeof v === "string" ? v.length > 0 : v != null;
  });
}

/** Default per-request timeout (ms) for connector network calls. */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Run an injectable fetcher with an abort-based timeout so a hung platform API
 * cannot stall the whole ingest run. Threads an AbortSignal into the request and
 * converts an abort into a clear, channel-agnostic timeout error.
 */
export async function fetchWithTimeout(
  fetcher: Fetcher,
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
/** HTTP statuses worth retrying: rate limits (429) and transient 5xx. */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
/** Default retry budget (in addition to the first attempt). */
export const MAX_FETCH_RETRIES = 2;
/**
 * Safety cap on paginated fetch loops. Large accounts can return many pages;
 * this bounds worst-case request volume per ingest so a runaway cursor (or a
 * malformed/never-ending `next` link) cannot loop forever or hammer a
 * free-tier quota into exhaustion.
 */
export const MAX_FETCH_PAGES = 20;


export interface RetryOptions {
  /** Per-attempt timeout passed through to {@link fetchWithTimeout}. */
  timeoutMs?: number;
  /** Extra attempts after the first (total attempts = retries + 1). */
  retries?: number;
  /** Base backoff delay; attempt n waits baseDelayMs * 2**n. */
  baseDelayMs?: number;
  /** Injectable sleep so tests run without real timers. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Timeout-bounded fetch with bounded exponential-backoff retries. Free-tier ad
 * APIs rate-limit aggressively (429) and have transient 5xx blips; this retries
 * those — and thrown network/timeout errors — a few times before giving up, so a
 * single hiccup doesn't fail a whole ingest run. A non-retryable status (e.g. 4xx
 * auth errors) is returned immediately; the final attempt's result/error stands.
 */
export async function fetchWithRetry(
  fetcher: Fetcher,
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const retries = opts.retries ?? MAX_FETCH_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchWithTimeout(fetcher, url, init, opts.timeoutMs);
      if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}