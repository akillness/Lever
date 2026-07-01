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
 * TikTok connector — Marketing API integrated report. A TikTok for Business
 * developer app grants free API access; the access token reads your own
 * advertiser's campaign report.
 */
const REQUIRED = ["advertiserId", "accessToken"];

const REVENUE_KEYS = [
  "total_complete_payment_amount",
  "total_purchase_value",
  "total_onsite_shopping_value",
  "complete_payment_value",
];
const CONVERSION_KEYS = ["conversion", "complete_payment", "total_complete_payment"];

interface TikTokRow {
  dimensions?: { campaign_id?: string | number; campaign_name?: string };
  metrics?: Record<string, string | number>;
}

/** First present, finite value among candidate metric keys. */
function firstNum(metrics: Record<string, string | number>, keys: string[]): number {
  for (const k of keys) {
    if (metrics[k] != null && metrics[k] !== "") return num(metrics[k]);
  }
  return 0;
}

export const tiktokConnector: ChannelConnector = {
  channel: "tiktok",
  freeTier: {
    api: "TikTok Marketing API (integrated report)",
    docsUrl: "https://business-api.tiktok.com/portal/docs",
    authType: "access-token",
    notes:
      "Free with a TikTok for Business developer app. OAuth grants a long-lived access token; reads your advertiser's AUCTION campaign report.",
  },
  requiredCredentials: REQUIRED,
  isConfigured: (creds) => hasFields(creds, REQUIRED),

  normalize(raw: unknown): AdRow[] {
    // Accepts a single page ({data:{list:[...]}}) or an accumulated array of
    // pages from pagination — mirrors the google/meta multi-page shape.
    const pages = Array.isArray(raw) ? raw : [raw];
    const rows: TikTokRow[] = [];
    for (const p of pages) {
      const list = (p as { data?: { list?: unknown } })?.data?.list;
      rows.push(...objectRows<TikTokRow>(list));
    }
    return rows.map((row, i) => {
      const m = row.metrics ?? {};
      const d = row.dimensions ?? {};
      return {
        id: String(d.campaign_id ?? `tiktok-${i + 1}`),
        name: m.campaign_name
          ? String(m.campaign_name)
          : d.campaign_name ?? `TikTok campaign ${i + 1}`,
        channel: "tiktok",
        spend: num(m.spend),
        revenue: firstNum(m, REVENUE_KEYS),
        conversions: firstNum(m, CONVERSION_KEYS),
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
      throw new Error("tiktok connector is not configured");
    }
    const pageSize = 1000;
    const pages: unknown[] = [];
    for (let page = 1; page <= MAX_FETCH_PAGES; page++) {
      const params = new URLSearchParams({
        advertiser_id: String(creds.advertiserId),
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: JSON.stringify(["campaign_id"]),
        metrics: JSON.stringify([
          "campaign_name",
          "spend",
          "clicks",
          "impressions",
          "conversion",
          ...REVENUE_KEYS,
        ]),
        start_date: range.start,
        end_date: range.end,
        page: String(page),
        page_size: String(pageSize),
      });
      const res = await fetchWithRetry(
        fetcher,
        `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params}`,
        { headers: { "Access-Token": String(creds.accessToken) } },
      );
      if (!res.ok) throw new Error(`tiktok marketing API error ${res.status}`);
      const body = (await res.json()) as {
        data?: { page_info?: { page?: number; total_page?: number } };
      };
      pages.push(body);
      const info = body.data?.page_info;
      if (!info || !info.total_page || (info.page ?? page) >= info.total_page) break;
    }
    return this.normalize(pages);
  },
};
