import { describe, expect, it } from "vitest";
import { ingestFromConnectors, runPipeline } from "./pipeline";
import { InMemoryCredentialVault } from "./secrets";
import { InMemoryStorage } from "./storage";
import type { ChannelConnector, Fetcher } from "./channels/types";
import type { AdRow } from "./types";

const KEY = "pipeline-master-key";
const RANGE = { start: "2026-06-01", end: "2026-06-30" };

/** A fake connector whose fetchRows returns canned rows (and records calls). */
function fakeConnector(
  channel: ChannelConnector["channel"],
  rows: AdRow[],
  opts: { throws?: boolean } = {},
): ChannelConnector {
  return {
    channel,
    freeTier: { api: "x", docsUrl: "https://x", authType: "api-key", notes: "" },
    requiredCredentials: ["token"],
    isConfigured: (c) => Boolean(c && typeof c.token === "string"),
    normalize: () => rows,
    fetchRows: async () => {
      if (opts.throws) throw new Error(`${channel} boom`);
      return rows;
    },
  };
}

const gRows: AdRow[] = [
  { id: "g1", name: "G1", channel: "google", spend: 300, revenue: 900, conversions: 30, clicks: 100, impressions: 5000 },
];
const mRows: AdRow[] = [
  { id: "m1", name: "M1", channel: "meta", spend: 400, revenue: 200, conversions: 0, clicks: 50, impressions: 8000 },
];

describe("ingestFromConnectors", () => {
  it("fetches only from connectors with credentials and reports per-channel status", async () => {
    const vault = new InMemoryCredentialVault(KEY);
    await vault.set("google", { token: "g" });
    // meta intentionally left unconfigured
    const connectors = [
      fakeConnector("google", gRows),
      fakeConnector("meta", mRows),
    ];
    const out = await ingestFromConnectors(RANGE, { vault, connectors });
    expect(out.rows).toEqual(gRows);
    expect(out.sources).toEqual([
      { channel: "google", configured: true, fetched: 1 },
      { channel: "meta", configured: false, fetched: 0 },
    ]);
  });

  it("captures a connector error without aborting the others", async () => {
    const vault = new InMemoryCredentialVault(KEY);
    await vault.set("google", { token: "g" });
    await vault.set("meta", { token: "m" });
    const connectors = [
      fakeConnector("google", gRows, { throws: true }),
      fakeConnector("meta", mRows),
    ];
    const out = await ingestFromConnectors(RANGE, { vault, connectors });
    expect(out.rows).toEqual(mRows);
    expect(out.sources[0]).toEqual({
      channel: "google",
      configured: true,
      fetched: 0,
      error: "google boom",
    });
  });

  it("scopes vault reads to accountId — the default account never sees a tenant's creds", async () => {
    const vault = new InMemoryCredentialVault(KEY);
    await vault.set("acct-x::google", { token: "g" }); // tenant-scoped
    const connectors = [fakeConnector("google", gRows)];
    const asDefault = await ingestFromConnectors(RANGE, { vault, connectors });
    expect(asDefault.rows).toEqual([]);
    expect(asDefault.sources).toEqual([{ channel: "google", configured: false, fetched: 0 }]);
    const asTenant = await ingestFromConnectors(RANGE, { vault, connectors, accountId: "acct-x" });
    expect(asTenant.rows).toEqual(gRows);
    expect(asTenant.sources).toEqual([{ channel: "google", configured: true, fetched: 1 }]);
  });

});

describe("runPipeline", () => {
  it("analyzes provided rows, persists, and skips sync when no webhook", async () => {
    const storage = new InMemoryStorage();
    const out = await runPipeline({
      range: RANGE,
      rows: [...gRows, ...mRows],
      name: "Test run",
      storage,
      sheetsWebhookUrl: undefined,
    });
    expect(out.result.recommendations.length).toBe(2);
    expect(out.dataset?.name).toBe("Test run");
    expect((await storage.listDatasets())[0].id).toBe(out.dataset?.id);
    expect(out.sync).toEqual({ attempted: false, ok: false });
  });

  it("folds a non-default accountId into the auto-generated dataset name", async () => {
    const storage = new InMemoryStorage();
    const out = await runPipeline({
      range: RANGE,
      rows: gRows,
      accountId: "acct-x",
      storage,
    });
    expect(out.dataset?.name).toBe(`ingest acct-x ${RANGE.start}..${RANGE.end}`);
  });


  it("ingests from connectors then pushes to the sheet webhook", async () => {
    const vault = new InMemoryCredentialVault(KEY);
    await vault.set("google", { token: "g" });
    const connectors = [fakeConnector("google", gRows)];
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      if (url.includes("action=config")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, config: {} }) };
      }
      return { ok: true, status: 200, json: async () => ({ appended: 1, updated: 0 }) };
    };
    const out = await runPipeline({
      range: RANGE,
      vault,
      connectors,
      storage: new InMemoryStorage(),
      fetcher,
      sheetsWebhookUrl: "https://script.example/exec",
      sheetsToken: "tok",
    });
    expect(out.ingest.rows).toEqual(gRows);
    expect(out.sync).toEqual({ attempted: true, ok: true, appended: 1, updated: 0 });
    // config write-back is read before the sync push: one GET, then one POST.
    expect(calls).toEqual([
      "https://script.example/exec?action=config&token=tok",
      "https://script.example/exec",
    ]);
  });

  it("reports a sync failure without throwing", async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const out = await runPipeline({
      range: RANGE,
      rows: gRows,
      storage: new InMemoryStorage(),
      fetcher,
      sheetsWebhookUrl: "https://script.example/exec",
      sheetsRetry: { retries: 0 },
    });
    expect(out.sync.attempted).toBe(true);
    expect(out.sync.ok).toBe(false);
    expect(out.sync.error).toMatch(/503/);
  });

  it("does not persist when there are no rows", async () => {
    const storage = new InMemoryStorage();
    const out = await runPipeline({ range: RANGE, rows: [], storage });
    expect(out.dataset).toBeNull();
    expect(await storage.listDatasets()).toEqual([]);
  });
});

describe("runPipeline — Sheet config write-back", () => {
  const leakRow: AdRow = {
    id: "a",
    name: "A",
    channel: "google",
    spend: 800,
    revenue: 0,
    conversions: 0,
    clicks: 10,
    impressions: 500,
  };

  function configFetcher(config: Record<string, unknown>): Fetcher {
    return async (url) => {
      if (url.includes("action=config")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, config }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
  }

  it("applies the sheet's config when the caller doesn't override that key", async () => {
    const out = await runPipeline({
      range: RANGE,
      rows: [leakRow],
      storage: new InMemoryStorage(),
      fetcher: configFetcher({ minSpend: 1000 }),
      sheetsWebhookUrl: "https://script.example/exec",
      sync: false,
    });
    expect(out.sheetConfig).toEqual({ minSpend: 1000 });
    // $800 spend is now below the sheet-raised $1000 threshold, so the row
    // reads as insufficient signal (KEEP) instead of the default-config
    // budget-leak PAUSE — proof the fetched config actually reached analyze().
    expect(out.result.recommendations[0].action).toBe("KEEP");
    expect(out.result.recommendations[0].rationale).toMatch(/\$1000 threshold/);
  });

  it("lets an explicit caller config win over the sheet on a per-key basis", async () => {
    const out = await runPipeline({
      range: RANGE,
      rows: [leakRow],
      storage: new InMemoryStorage(),
      fetcher: configFetcher({ minSpend: 1000 }),
      sheetsWebhookUrl: "https://script.example/exec",
      sync: false,
      config: { minSpend: 100 },
    });
    // sheetConfig still reports what the sheet held...
    expect(out.sheetConfig).toEqual({ minSpend: 1000 });
    // ...but the caller's explicit override is what analyze() actually used.
    expect(out.result.recommendations[0].action).toBe("PAUSE");
  });

  it("never fetches sheet config when sheetsConfig:false, even with a webhook configured", async () => {
    let configCalls = 0;
    const fetcher: Fetcher = async (url) => {
      if (url.includes("action=config")) configCalls += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const out = await runPipeline({
      range: RANGE,
      rows: [leakRow],
      storage: new InMemoryStorage(),
      fetcher,
      sheetsWebhookUrl: "https://script.example/exec",
      sheetsConfig: false,
      sync: false,
    });
    expect(configCalls).toBe(0);
    expect(out.sheetConfig).toEqual({});
    expect(out.result.recommendations[0].action).toBe("PAUSE"); // untouched default minSpend
  });

  it("degrades to {} (default engine config) when the sheet config fetch fails", async () => {
    const fetcher: Fetcher = async () => {
      throw new Error("network down");
    };
    const out = await runPipeline({
      range: RANGE,
      rows: [leakRow],
      storage: new InMemoryStorage(),
      fetcher,
      sheetsWebhookUrl: "https://script.example/exec",
      sheetsRetry: { retries: 0 },
      sync: false,
    });
    expect(out.sheetConfig).toEqual({});
    expect(out.result.recommendations[0].action).toBe("PAUSE");
  });
});

