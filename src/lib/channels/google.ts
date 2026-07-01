import type { AdRow } from "../types";
import {
  type ChannelConnector,
  type DateRange,
  type Fetcher,
  MAX_FETCH_PAGES,
  fetchWithRetry,
  hasFields,
  num,
  objectRows,
} from "./types";

/**
 * Google Ads connector — Google Ads API (Basic Access is free; you only need a
 * developer token + an OAuth2 access token). Queries campaign-level metrics via
 * GAQL `search`. costMicros is dollars × 1e6.
 *
 * OAuth refresh (auto-mint): a Google access token expires in ~1 hour, so
 * pasting one manually needs re-rotation every ingest run or two. Supply a
 * long-lived `refreshToken` + `clientId` + `clientSecret` instead of
 * `accessToken` and {@link fetchRows} mints a fresh access token from Google's
 * OAuth2 token endpoint on every call — no manual rotation required. A static
 * `accessToken` still works and is used as-is when present (no network call).
 */
const BASE_REQUIRED = ["customerId", "developerToken"];
const REQUIRED = [...BASE_REQUIRED, "accessToken"];
const REFRESH_FIELDS = ["refreshToken", "clientId", "clientSecret"];

interface GoogleResult {
  campaign?: { id?: string | number; name?: string };
  metrics?: {
    costMicros?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
    clicks?: string | number;
    impressions?: string | number;
  };
}

/** True when creds have enough to authenticate: a static token OR refresh-token trio. */
function isConfigured(creds: Record<string, unknown> | null | undefined): boolean {
  if (!hasFields(creds, BASE_REQUIRED)) return false;
  return hasFields(creds, ["accessToken"]) || hasFields(creds, REFRESH_FIELDS);
}

/**
 * Exchange a long-lived refresh token for a fresh access token via Google's
 * standard OAuth2 token endpoint. Pure network call — injectable fetcher, no
 * side effects on the credential object.
 */
export async function mintGoogleAccessToken(
  creds: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const res = await fetchWithRetry(fetcher, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: String(creds.clientId),
      client_secret: String(creds.clientSecret),
      refresh_token: String(creds.refreshToken),
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`google oauth2 token refresh error ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("google oauth2 token refresh returned no access_token");
  }
  return body.access_token;
}

export const googleConnector: ChannelConnector = {
  channel: "google",
  freeTier: {
    api: "Google Ads API (Basic Access)",
    docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
    authType: "oauth2-bearer",
    notes:
      "Basic Access is free; request a developer token in your MCC. Either paste a short-lived accessToken, or supply refreshToken+clientId+clientSecret and Lever mints a fresh access token automatically on every ingest (no manual rotation). Default quota is ample for one buyer's accounts.",
  },
  requiredCredentials: REQUIRED,
  isConfigured,

  normalize(raw: unknown): AdRow[] {
    // search → { results: [...] }; searchStream/paginated → [{ results: [...] }, ...].
    const batches = Array.isArray(raw) ? raw : [raw];
    const results: GoogleResult[] = [];
    for (const b of batches) {
      const r = (b as { results?: unknown })?.results;
      results.push(...objectRows<GoogleResult>(r));
    }
    return results.map((row, i) => {
      const m = row.metrics ?? {};
      return {
        id: String(row.campaign?.id ?? `google-${i + 1}`),
        name: row.campaign?.name ?? `Google campaign ${i + 1}`,
        channel: "google",
        spend: num(m.costMicros) / 1_000_000,
        revenue: num(m.conversionsValue),
        conversions: num(m.conversions),
        clicks: num(m.clicks),
        impressions: num(m.impressions),
      };
    });
  },

  async fetchRows(
    creds: Record<string, unknown>,
    range: DateRange,
    fetcher: Fetcher = fetch,
  ): Promise<AdRow[]> {
    if (!this.isConfigured(creds)) {
      throw new Error("google connector is not configured");
    }
    const accessToken = creds.accessToken
      ? String(creds.accessToken)
      : await mintGoogleAccessToken(creds, fetcher);
    const customerId = String(creds.customerId).replace(/-/g, "");
    const query = `SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": String(creds.developerToken),
      "Content-Type": "application/json",
    };
    if (creds.loginCustomerId) {
      headers["login-customer-id"] = String(creds.loginCustomerId).replace(/-/g, "");
    }
    // Google Ads search paginates via a `pageToken` echoed back as
    // `nextPageToken`; walk every page (capped) so large accounts aren't
    // silently truncated to page one.
    const batches: unknown[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_FETCH_PAGES; page++) {
      const res = await fetchWithRetry(
        fetcher,
        `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
        },
      );
      if (!res.ok) throw new Error(`google ads API error ${res.status}`);
      const body = (await res.json()) as { nextPageToken?: string };
      batches.push(body);
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return this.normalize(batches);
  },
};
