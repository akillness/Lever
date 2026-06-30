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

  it("ingests from connectors then pushes to the sheet webhook", async () => {
    const vault = new InMemoryCredentialVault(KEY);
    await vault.set("google", { token: "g" });
    const connectors = [fakeConnector("google", gRows)];
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
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
    expect(calls).toEqual(["https://script.example/exec"]);
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
