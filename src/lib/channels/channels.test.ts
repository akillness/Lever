import { describe, expect, it } from "vitest";
import {
  FETCH_TIMEOUT_MS,
  MAX_FETCH_PAGES,
  MAX_FETCH_RETRIES,
  RETRYABLE_STATUS,
  type Fetcher,
  fetchWithRetry,
  fetchWithTimeout,
} from "./types";
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

  it("follows nextPageToken across multiple pages, capped by MAX_FETCH_PAGES", async () => {
    const page1 = {
      results: [{ campaign: { id: 1, name: "P1" }, metrics: { costMicros: "1000000" } }],
      nextPageToken: "tok-2",
    };
    const page2 = {
      results: [{ campaign: { id: 2, name: "P2" }, metrics: { costMicros: "2000000" } }],
    };
    const bodies = [page1, page2];
    let i = 0;
    const calls: RequestInit[] = [];
    const fetcher: Fetcher = async (_url, init) => {
      calls.push(init as RequestInit);
      const body = bodies[Math.min(i, bodies.length - 1)];
      i += 1;
      return { ok: true, status: 200, json: async () => body };
    };
    const rows = await googleConnector.fetchRows(
      { customerId: "1", developerToken: "d", accessToken: "a" },
      RANGE,
      fetcher,
    );
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(calls).toHaveLength(2);
    expect(String(calls[0].body)).not.toContain("pageToken");
    expect(String(calls[1].body)).toContain("tok-2");
  });
  it("never exceeds MAX_FETCH_PAGES even when nextPageToken never stops", async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ campaign: { id: calls, name: `P${calls}` } }],
          nextPageToken: "always-more",
        }),
      };
    };
    const rows = await googleConnector.fetchRows(
      { customerId: "1", developerToken: "d", accessToken: "a" },
      RANGE,
      fetcher,
    );
    expect(calls).toBe(MAX_FETCH_PAGES);
    expect(rows).toHaveLength(MAX_FETCH_PAGES);
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
  it("follows paging.next cursor across pages, capped by MAX_FETCH_PAGES", async () => {
    const page1 = {
      data: [{ campaign_id: "c1", spend: "10", clicks: "1", impressions: "1" }],
      paging: { next: "https://graph.facebook.com/v21.0/act_999/insights?after=cursor2" },
    };
    const page2 = {
      data: [{ campaign_id: "c2", spend: "20", clicks: "2", impressions: "2" }],
    };
    const urls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      urls.push(url);
      const body = urls.length === 1 ? page1 : page2;
      return { ok: true, status: 200, json: async () => body };
    };
    const rows = await metaConnector.fetchRows(
      { accountId: "act_999", accessToken: "fbtok" },
      RANGE,
      fetcher,
    );
    expect(rows.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe("https://graph.facebook.com/v21.0/act_999/insights?after=cursor2");
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

  it("walks page_info.total_page across multiple pages", async () => {
    const page1 = {
      data: {
        list: [{ dimensions: { campaign_id: "tt1" }, metrics: { spend: "1" } }],
        page_info: { page: 1, total_page: 2 },
      },
    };
    const page2 = {
      data: {
        list: [{ dimensions: { campaign_id: "tt2" }, metrics: { spend: "2" } }],
        page_info: { page: 2, total_page: 2 },
      },
    };
    const urls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      urls.push(url);
      const body = urls.length === 1 ? page1 : page2;
      return { ok: true, status: 200, json: async () => body };
    };
    const rows = await tiktokConnector.fetchRows(
      { advertiserId: "adv-7", accessToken: "tttok" },
      RANGE,
      fetcher,
    );
    expect(rows.map((r) => r.id)).toEqual(["tt1", "tt2"]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("page=1");
    expect(urls[1]).toContain("page=2");
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

/** A fetcher that walks a script of steps (status / thrown error) and records calls. */
function sequenceFetcher(
  steps: Array<{ status?: number; throwErr?: string; body?: unknown }>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step.throwErr) throw new Error(step.throwErr);
    const status = step.status ?? 200;
    return { ok: status < 400, status, json: async () => step.body ?? {} };
  };
  return { fetcher, calls };
}

describe("fetchWithRetry", () => {
  const recordSleep = () => {
    const delays: number[] = [];
    return { delays, sleep: async (ms: number) => void delays.push(ms) };
  };

  it("retries a 429, then returns the first success", async () => {
    const { fetcher, calls } = sequenceFetcher([
      { status: 429 },
      { status: 200, body: { ok: 1 } },
    ]);
    const { delays, sleep } = recordSleep();
    const res = await fetchWithRetry(fetcher, "https://x.test", {}, {
      baseDelayMs: 10,
      sleep,
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([10]); // one backoff before the retry
  });

  it("retries on transient 5xx with exponential backoff, then gives up returning the last response", async () => {
    const { fetcher, calls } = sequenceFetcher([{ status: 503 }]);
    const { delays, sleep } = recordSleep();
    const res = await fetchWithRetry(fetcher, "https://x.test", {}, {
      retries: 2,
      baseDelayMs: 10,
      sleep,
    });
    expect(res.status).toBe(503); // exhausted: last attempt's response stands
    expect(calls).toHaveLength(3); // 1 + 2 retries
    expect(delays).toEqual([10, 20]); // 10*2^0, 10*2^1
  });

  it("does NOT retry a non-retryable 4xx (auth) error", async () => {
    const { fetcher, calls } = sequenceFetcher([
      { status: 401 },
      { status: 200 },
    ]);
    const { delays, sleep } = recordSleep();
    const res = await fetchWithRetry(fetcher, "https://x.test", {}, { sleep });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("retries a thrown network error, then succeeds", async () => {
    const { fetcher, calls } = sequenceFetcher([
      { throwErr: "ECONNRESET" },
      { status: 200, body: { ok: 1 } },
    ]);
    const { delays, sleep } = recordSleep();
    const res = await fetchWithRetry(fetcher, "https://x.test", {}, {
      baseDelayMs: 5,
      sleep,
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([5]);
  });

  it("rethrows after exhausting retries on a persistent thrown error", async () => {
    const { fetcher, calls } = sequenceFetcher([{ throwErr: "DNS failure" }]);
    const { sleep } = recordSleep();
    await expect(
      fetchWithRetry(fetcher, "https://x.test", {}, {
        retries: 1,
        baseDelayMs: 1,
        sleep,
      }),
    ).rejects.toThrow(/DNS failure/);
    expect(calls).toHaveLength(2); // 1 + 1 retry
  });

  it("exposes a sane retry budget and retryable status set", () => {
    expect(MAX_FETCH_RETRIES).toBeGreaterThanOrEqual(1);
    expect(RETRYABLE_STATUS.has(429)).toBe(true);
    expect(RETRYABLE_STATUS.has(503)).toBe(true);
    expect(RETRYABLE_STATUS.has(400)).toBe(false);
  });
});