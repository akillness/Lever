/**
 * Real-data pipeline: pull from configured channel connectors → normalize to
 * canonical rows → run the engine → persist the dataset → push results to the
 * Google Sheet. Every stage is optional and degrades gracefully: with nothing
 * configured the pipeline still analyzes any caller-supplied rows.
 *
 * Server-only (reads the vault + storage). Network and storage seams are
 * injectable so the whole flow is unit-testable offline.
 */
import { analyze } from "./engine";
import { allConnectors } from "./channels";
import type { ChannelConnector, DateRange, Fetcher, RetryOptions } from "./channels/types";
import { DEFAULT_ACCOUNT_ID, getVault, vaultKey, type CredentialVault } from "./secrets";
import { createStorage, type StorageAdapter, type StoredDataset } from "./storage";
import { buildSyncPayload, fetchSheetConfig, pushToSheet } from "./sheets";

import type { AdRow, AnalysisResult, Channel, EngineConfig } from "./types";

/** Per-channel ingest outcome, surfaced to the caller for observability. */
export interface ChannelIngestStatus {
  channel: Channel;
  configured: boolean;
  fetched: number;
  error?: string;
}

export interface IngestResult {
  rows: AdRow[];
  sources: ChannelIngestStatus[];
}

export interface IngestOptions {
  vault?: CredentialVault;
  fetcher?: Fetcher;
  connectors?: ChannelConnector[];
  /** Which tenant's credentials to read (see {@link DEFAULT_ACCOUNT_ID}). */
  accountId?: string;
}

/**
 * Pull rows from every connector that has credentials in the vault. Connectors
 * without credentials are reported as `configured: false` and skipped; a fetch
 * error on one channel never aborts the others.
 */
export async function ingestFromConnectors(
  range: DateRange,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const vault = options.vault ?? getVault();
  const connectors = options.connectors ?? allConnectors();
  const accountId = options.accountId ?? DEFAULT_ACCOUNT_ID;
  const rows: AdRow[] = [];
  const sources: ChannelIngestStatus[] = [];

  for (const connector of connectors) {
    const creds = await vault.get(vaultKey(connector.channel, accountId));
    if (!connector.isConfigured(creds)) {
      sources.push({ channel: connector.channel, configured: false, fetched: 0 });
      continue;
    }
    try {
      const fetched = await connector.fetchRows(creds!, range, options.fetcher);
      rows.push(...fetched);
      sources.push({
        channel: connector.channel,
        configured: true,
        fetched: fetched.length,
      });
    } catch (err) {
      sources.push({
        channel: connector.channel,
        configured: true,
        fetched: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { rows, sources };
}

export interface SyncStatus {
  attempted: boolean;
  ok: boolean;
  appended?: number;
  updated?: number;
  error?: string;
}

export interface PipelineOptions {
  range: DateRange;
  /** Pre-supplied rows; when given, connector ingest is skipped. */
  rows?: AdRow[];
  name?: string;
  config?: Partial<EngineConfig>;
  vault?: CredentialVault;
  storage?: StorageAdapter;
  fetcher?: Fetcher;
  connectors?: ChannelConnector[];
  /** Which tenant's vault-scoped credentials to ingest with (see {@link DEFAULT_ACCOUNT_ID}). */
  accountId?: string;
  /** Defaults to LEVER_SHEETS_WEBHOOK_URL. */
  sheetsWebhookUrl?: string;
  /** Defaults to LEVER_SHEETS_TOKEN. */
  sheetsToken?: string;
  /** Tune the Sheets push retry budget (timeout/retries/backoff). */
  sheetsRetry?: RetryOptions;
  /**
   * Tune the sheet-config-read retry budget, decoupled from `sheetsRetry`
   * (the push, where losing data matters, keeps its own wider retry budget).
   * Default: {@link CONFIG_FETCH_DEFAULTS} in sheets.ts — a single ~5s
   * attempt — so a slow/hanging Config-tab read never adds tens of seconds
   * to every ingest run.
   */
  sheetsConfigRetry?: RetryOptions;

  /**
   * Read the engine config back from the Sheet's Config tab before analyzing
   * (the write-back half of the Sheets integration — a PM tunes thresholds in
   * the sheet instead of an API call). Default: true when a webhook URL is
   * available. A caller-supplied `config` field still wins over the sheet on
   * a per-key basis; the sheet only fills in what the caller didn't set.
   */
  sheetsConfig?: boolean;
  /** Persist the ingested dataset. Default true (skipped when there are no rows). */
  persist?: boolean;
  /** Push to Sheets. Default: true when a webhook URL is available. */
  sync?: boolean;
}

export interface PipelineResult {
  result: AnalysisResult;
  dataset: StoredDataset | null;
  ingest: IngestResult;
  sync: SyncStatus;
  /** The config read back from the Sheet's Config tab, if any (empty when not fetched/set). */
  sheetConfig: Partial<EngineConfig>;
}

/** Orchestrate ingest → analyze → persist → sync for one reporting window. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    range,
    rows: provided,
    name,
    config,
    vault,
    storage,
    fetcher,
    connectors,
    accountId = DEFAULT_ACCOUNT_ID,
    persist = true,
  } = options;

  const webhookUrl =
    options.sheetsWebhookUrl ?? process.env.LEVER_SHEETS_WEBHOOK_URL;
  const token = options.sheetsToken ?? process.env.LEVER_SHEETS_TOKEN;
  const shouldSync = options.sync ?? Boolean(webhookUrl);
  const shouldFetchConfig = options.sheetsConfig ?? Boolean(webhookUrl);

  const sheetConfig =
    shouldFetchConfig && webhookUrl
      ? await fetchSheetConfig(webhookUrl, token, fetcher, options.sheetsConfigRetry)
      : {};

  const ingest: IngestResult = provided
    ? { rows: provided, sources: [] }
    : await ingestFromConnectors(range, { vault, fetcher, connectors, accountId });

  const result = analyze(ingest.rows, { ...sheetConfig, ...config });

  const store = storage ?? createStorage();
  const datasetName =
    name ||
    (accountId === DEFAULT_ACCOUNT_ID
      ? `ingest ${range.start}..${range.end}`
      : `ingest ${accountId} ${range.start}..${range.end}`);
  const dataset =
    persist && ingest.rows.length > 0
      ? await store.saveDataset(datasetName, ingest.rows)
      : null;

  let sync: SyncStatus = { attempted: false, ok: false };
  if (shouldSync && webhookUrl && ingest.rows.length > 0) {
    const payload = buildSyncPayload(ingest.rows, result, range.end, token);
    try {
      const res = await pushToSheet(webhookUrl, payload, fetcher, options.sheetsRetry);
      sync = {
        attempted: true,
        ok: true,
        appended: typeof res.appended === "number" ? res.appended : undefined,
        updated: typeof res.updated === "number" ? res.updated : undefined,
      };
    } catch (err) {
      sync = {
        attempted: true,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { result, dataset, ingest, sync, sheetConfig };
}
