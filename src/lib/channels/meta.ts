import type { AdRow } from "../types";
import {
  type ChannelConnector,
  type DateRange,
  type Fetcher,
  fetchWithTimeout,
  hasFields,
  num,
  objectRows,
} from "./types";

/**
 * Meta (Facebook/Instagram) connector — Marketing API Insights. A standard
 * access token from a registered app reads your own ad account for free.
 * Conversions/revenue are extracted from the purchase-type `actions` /
 * `action_values` arrays.
 */
const REQUIRED = ["accountId", "accessToken"];

const PURCHASE_TYPES = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
]);

interface MetaAction {
  action_type?: string;
  value?: string | number;
}
interface MetaRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string | number;
  clicks?: string | number;
  impressions?: string | number;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

/** Sum the values of purchase-type entries in an actions/action_values array. */
function sumPurchases(actions: MetaAction[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce(
    (acc, a) => (PURCHASE_TYPES.has(a.action_type ?? "") ? acc + num(a.value) : acc),
    0,
  );
}

export const metaConnector: ChannelConnector = {
  channel: "meta",
  freeTier: {
    api: "Meta Marketing API (Insights)",
    docsUrl: "https://developers.facebook.com/docs/marketing-api/insights",
    authType: "access-token",
    notes:
      "Free with a Meta developer app in Standard Access. Generate a user/system access token with ads_read; reads your own ad account insights.",
  },
  requiredCredentials: REQUIRED,
  isConfigured: (creds) => hasFields(creds, REQUIRED),

  normalize(raw: unknown): AdRow[] {
    const data = (raw as { data?: unknown })?.data;
    const rows: MetaRow[] = objectRows<MetaRow>(data);
    return rows.map((row, i) => ({
      id: String(row.campaign_id ?? `meta-${i + 1}`),
      name: row.campaign_name ?? `Meta campaign ${i + 1}`,
      channel: "meta",
      spend: num(row.spend),
      revenue: sumPurchases(row.action_values),
      conversions: sumPurchases(row.actions),
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
      throw new Error("meta connector is not configured");
    }
    const acct = String(creds.accountId).replace(/^act_/, "");
    const params = new URLSearchParams({
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,actions,action_values,clicks,impressions",
      time_range: JSON.stringify({ since: range.start, until: range.end }),
      access_token: String(creds.accessToken),
    });
    const res = await fetchWithTimeout(
      fetcher,
      `https://graph.facebook.com/v21.0/act_${acct}/insights?${params}`,
    );
    if (!res.ok) throw new Error(`meta marketing API error ${res.status}`);
    return this.normalize(await res.json());
  },
};
