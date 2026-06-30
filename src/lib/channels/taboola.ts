import type { AdRow } from "../types";
import {
  type ChannelConnector,
  type DateRange,
  type Fetcher,
  fetchWithRetry,
  hasFields,
  num,
  objectRows,
} from "./types";

/**
 * Taboola connector — Backstage API campaign-summary report. A Backstage
 * account grants free API access (client-credentials → bearer token). Reads the
 * campaign_breakdown dimension.
 */
const REQUIRED = ["accountId", "accessToken"];

interface TaboolaRow {
  campaign?: string | number;
  campaign_name?: string;
  spent?: string | number;
  conversions_value?: string | number;
  cpa_actions_num?: string | number;
  actions?: string | number;
  clicks?: string | number;
  impressions?: string | number;
}

export const taboolaConnector: ChannelConnector = {
  channel: "taboola",
  freeTier: {
    api: "Taboola Backstage API (campaign-summary)",
    docsUrl: "https://developers.taboola.com/backstage-api/reference",
    authType: "oauth2-bearer",
    notes:
      "Free with a Taboola advertiser account. Use client_id/client_secret to mint a bearer token, then read campaign-summary reports.",
  },
  requiredCredentials: REQUIRED,
  isConfigured: (creds) => hasFields(creds, REQUIRED),

  normalize(raw: unknown): AdRow[] {
    const rows = objectRows<TaboolaRow>(
      (raw as { results?: unknown })?.results,
    );
    return rows.map((row, i) => ({
      id: String(row.campaign ?? `taboola-${i + 1}`),
      name: row.campaign_name ?? `Taboola campaign ${i + 1}`,
      channel: "taboola",
      spend: num(row.spent),
      revenue: num(row.conversions_value),
      // Backstage names the conversion count cpa_actions_num (fallback: actions).
      conversions: num(row.cpa_actions_num ?? row.actions),
      clicks: num(row.clicks),
      impressions: num(row.impressions),
    }));
  },

  async fetchRows(
    creds: Record<string, unknown>,
    range: DateRange,
    fetcher: Fetcher = fetch,
  ): Promise<AdRow[]> {
    if (!this.isConfigured(creds)) {
      throw new Error("taboola connector is not configured");
    }
    const acct = String(creds.accountId);
    const params = new URLSearchParams({
      start_date: range.start,
      end_date: range.end,
    });
    const res = await fetchWithRetry(
      fetcher,
      `https://backstage.taboola.com/backstage/api/1.0/${acct}/reports/campaign-summary/dimensions/campaign_breakdown?${params}`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } },
    );
    if (!res.ok) throw new Error(`taboola backstage API error ${res.status}`);
    return this.normalize(await res.json());
  },
};
