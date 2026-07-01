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
 */
const REQUIRED = ["customerId", "developerToken", "accessToken"];

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

export const googleConnector: ChannelConnector = {
  channel: "google",
  freeTier: {
    api: "Google Ads API (Basic Access)",
    docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
    authType: "oauth2-bearer",
    notes:
      "Basic Access is free; request a developer token in your MCC, then mint an OAuth2 access token. Default quota is ample for one buyer's accounts.",
  },
  requiredCredentials: REQUIRED,
  isConfigured: (creds) => hasFields(creds, REQUIRED),

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
    const customerId = String(creds.customerId).replace(/-/g, "");
    const query = `SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.accessToken}`,
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
