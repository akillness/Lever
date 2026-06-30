import { describe, expect, it } from "vitest";
import { FETCH_TIMEOUT_MS, type Fetcher, fetchWithTimeout } from "./types";
import { googleConnector } from "./google";
import { metaConnector } from "./meta";
import { taboolaConnector } from "./taboola";
import { tiktokConnector } from "./tiktok";
import { allConnectors, freeTierCatalog, getConnector } from "./index";

const RANGE = { start: "2026-06-01", end: "2026-06-30" };

/** Build a Fetcher stub that returns a fixed JSON body and records the call. */
function stubFetcher(body: unknown, ok = true, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => body };
  };
  return { fetcher, calls };
}

describe("google connector", () => {
  const raw = {
    results: [
      {
        campaign: { id: 111, name: "Search Brand" },
        metrics: {
          costMicros: "120000000",
          conversions: "30",
          conversionsValue: "900",
          clicks: "400",
          impressions: "12000",
        },
      },
    ],
  };

  it("normalizes costMicros to dollars and maps metrics", () => {
    const [row] = googleConnector.normalize(raw);
    expect(row).toMatchObject({
      id: "111",
      name: "Search Brand",
      channel: "google",
      spend: 120,
      revenue: 900,
      conversions: 30,
      clicks: 400,
      impressions: 12000,
    });
  });

  it("handles the searchStream array-of-batches shape", () => {
    expect(googleConnector.normalize([raw, raw])).toHaveLength(2);
  });

  it("isConfigured requires all three fields", () => {
    expect(googleConnector.isConfigured({ customerId: "1" })).toBe(false);
    expect(
      googleConnector.isConfigured({
        customerId: "1",
        developerToken: "d",
        accessToken: "a",
      }),
    ).toBe(true);
  });

  it("fetchRows posts a GAQL query with auth headers", async () => {
    const { fetcher, calls } = stubFetcher(raw);
    const rows = await googleConnector.fetchRows(
      { customerId: "123-456-7890", developerToken: "dev", accessToken: "tok" },
      RANGE,
      fetcher,
    );
    expect(rows).toHaveLength(1);
    expect(calls[0].url).toContain("customers/1234567890/googleAds:search");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["developer-token"]).toBe("dev");
    expect(String(calls[0].init?.body)).toContain("segments.date BETWEEN '2026-06-01'");
  });

  it("fetchRows throws when unconfigured or API errors", async () => {
    await expect(googleConnector.fetchRows({}, RANGE)).rejects.toThrow(/not configured/);
    const { fetcher } = stubFetcher({}, false, 403);
    await expect(
      googleConnector.fetchRows(
        { customerId: "1", developerToken: "d", accessToken: "a" },
        RANGE,
        fetcher,
      ),
    ).rejects.toThrow(/403/);
  });
});

describe("meta connector", () => {
  const raw = {
    data: [
      {
        campaign_id: "c1",
        campaign_name: "Prospecting",
        spend: "200.50",
        clicks: "300",
        impressions: "8000",
        actions: [
          { action_type: "purchase", value: "12" },
          { action_type: "link_click", value: "300" },
        ],
        action_values: [{ action_type: "purchase", value: "640" }],
      },
    ],
  };

  it("extracts purchase conversions and revenue, ignoring other actions", () => {
    const [row] = metaConnector.normalize(raw);
    expect(row).toMatchObject({
      id: "c1",
      channel: "meta",
      spend: 200.5,
      revenue: 640,
      conversions: 12,
      clicks: 300,
      impressions: 8000,
    });
  });

  it("fetchRows targets the act_ insights endpoint with the access token", async () => {
    const { fetcher, calls } = stubFetcher(raw);
    await metaConnector.fetchRows(
      { accountId: "act_999", accessToken: "fbtok" },
      RANGE,
      fetcher,
    );
    expect(calls[0].url).toContain("act_999/insights");
    expect(calls[0].url).toContain("access_token=fbtok");
    expect(calls[0].url).toContain("level=campaign");
  });
});

describe("taboola connector", () => {
  const raw = {
    results: [
      {
        campaign: 5001,
        campaign_name: "Native Discovery",
        spent: "80",
        conversions_value: "300",
        cpa_actions_num: "9",
        clicks: "210",
        impressions: "40000",
      },
    ],
  };

  it("maps spent/conversions_value/cpa_actions_num", () => {
    const [row] = taboolaConnector.normalize(raw);
    expect(row).toMatchObject({
      id: "5001",
      channel: "taboola",
      spend: 80,
      revenue: 300,
      conversions: 9,
      clicks: 210,
      impressions: 40000,
    });
  });

  it("fetchRows hits backstage campaign-summary with bearer auth", async () => {
    const { fetcher, calls } = stubFetcher(raw);
    await taboolaConnector.fetchRows(
      { accountId: "acct-1", accessToken: "tbtok" },
      RANGE,
      fetcher,
    );
    expect(calls[0].url).toContain("backstage/api/1.0/acct-1/reports/campaign-summary");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tbtok");
  });
});

describe("tiktok connector", () => {
  const raw = {
    data: {
      list: [
        {
          dimensions: { campaign_id: "tt1" },
          metrics: {
            campaign_name: "Spark Ads",
            spend: "150",
            clicks: "500",
            impressions: "60000",
            conversion: "20",
            total_complete_payment_amount: "720",
          },
        },
      ],
    },
  };

  it("reads campaign_name from metrics and revenue via candidate keys", () => {
    const [row] = tiktokConnector.normalize(raw);
    expect(row).toMatchObject({
      id: "tt1",
      name: "Spark Ads",
      channel: "tiktok",
      spend: 150,
      revenue: 720,
      conversions: 20,
      clicks: 500,
      impressions: 60000,
    });
  });

  it("fetchRows sends the Access-Token header and advertiser_id", async () => {
    const { fetcher, calls } = stubFetcher(raw);
    await tiktokConnector.fetchRows(
      { advertiserId: "adv-7", accessToken: "tttok" },
      RANGE,
      fetcher,
    );
    expect(calls[0].url).toContain("report/integrated/get");
    expect(calls[0].url).toContain("advertiser_id=adv-7");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Access-Token"]).toBe("tttok");
  });
});

describe("connector registry", () => {
  it("exposes all four channels and resolves by name", () => {
    expect(allConnectors().map((c) => c.channel)).toEqual([
      "google",
      "meta",
      "taboola",
      "tiktok",
    ]);
    expect(getConnector("meta")).toBe(metaConnector);
    expect(getConnector("other")).toBeUndefined();
  });

  it("free-tier catalog lists required credentials per channel", () => {
    const cat = freeTierCatalog();
    const google = cat.find((c) => c.channel === "google");
    expect(google?.requiredCredentials).toContain("developerToken");
    expect(google?.docsUrl).toMatch(/^https:\/\//);
    expect(cat).toHaveLength(4);
  });

  it("every connector returns [] for junk input rather than throwing", () => {
    for (const c of allConnectors()) {
      expect(c.normalize(null)).toEqual([]);
      expect(c.normalize({ unexpected: true })).toEqual([]);
    }
  });

  it("skips null / non-object rows inside an otherwise-shaped response", () => {
    // Mirrors a real API returning a sparse/garbage element in the results array.
    const junkRows = { results: [null, 7, "x"], data: { list: [null, 7, "x"] } };
    for (const c of allConnectors()) {
      expect(() => c.normalize(junkRows)).not.toThrow();
      expect(c.normalize(junkRows)).toEqual([]);
    }
  });

  it("normalizes the valid rows even when null rows are interleaved", () => {
    const meta = metaConnector.normalize({
      data: [null, { campaign_id: "c9", spend: "10", clicks: "1", impressions: "2" }],
    });
    expect(meta).toHaveLength(1);
    expect(meta[0].id).toBe("c9");
  });
});


describe("fetchWithTimeout", () => {
  it("returns the response and threads an AbortSignal into the request", async () => {
    let seenSignal: AbortSignal | undefined;
    const fetcher: Fetcher = async (_url, init) => {
      seenSignal = init?.signal ?? undefined;
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    const res = await fetchWithTimeout(fetcher, "https://x.test", {}, 50);
    expect(res.ok).toBe(true);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it("aborts and throws a timeout error when the fetcher hangs", async () => {
    const hangingFetcher: Fetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted by signal")),
        );
      });
    await expect(
      fetchWithTimeout(hangingFetcher, "https://slow.test", {}, 10),
    ).rejects.toThrow(/timed out after 10ms: https:\/\/slow\.test/);
  });

  it("propagates a non-abort fetcher error unchanged", async () => {
    const failing: Fetcher = async () => {
      throw new Error("DNS failure");
    };
    await expect(
      fetchWithTimeout(failing, "https://x.test", {}, 50),
    ).rejects.toThrow(/DNS failure/);
  });

  it("defaults to a positive timeout budget", () => {
    expect(FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
