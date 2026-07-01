import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { parseCsv, sanitizeAdRows } from "@/lib/csv";
import { parseRange, sanitizeConfig } from "@/lib/configInput";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { isValidAccountId } from "@/lib/secrets";
import type { AdRow } from "@/lib/types";
import type { DateRange } from "@/lib/channels/types";

const MAX_ROWS = 5000;

/** Default to a trailing 30-day window when the caller omits a range. */
function defaultRange(): DateRange {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/**
 * POST /api/ingest — run the real-data pipeline for a reporting window:
 * pull from every configured channel connector (or analyze caller-supplied
 * rows/csv), persist the dataset, and push results to the Google Sheet.
 *
 * Body: { range?: {start,end}, rows?: AdRow[], csv?: string, name?: string,
 *         config?: Partial<EngineConfig>, accountId?: string, persist?: boolean,
 *         sync?: boolean }. `accountId` selects which tenant's vault-scoped
 *         channel credentials to ingest with (default: the single-tenant
 *         unnamespaced account — see `DEFAULT_ACCOUNT_ID`).
 *
 * The response carries the AnalysisResult, per-channel ingest status, the saved
 * dataset id, and the sync outcome — but never any credential values.
 */
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    range?: unknown;
    rows?: AdRow[];
    csv?: string;
    name?: string;
    config?: unknown;
    accountId?: unknown;
    persist?: boolean;
    sync?: boolean;
  };

  if (
    body.accountId != null &&
    (typeof body.accountId !== "string" || !isValidAccountId(body.accountId))
  ) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }

  const range = parseRange(body.range) ?? defaultRange();
  const config = sanitizeConfig(body.config);

  let rows: AdRow[] | undefined;
  if (Array.isArray(body.rows) && body.rows.length > 0) {
    rows = sanitizeAdRows(body.rows.slice(0, MAX_ROWS));
  } else if (typeof body.csv === "string" && body.csv.trim().length > 0) {
    rows = parseCsv(body.csv).slice(0, MAX_ROWS);
  }

  try {
    const out = await runPipeline({
      range,
      rows,
      name: body.name?.trim() || undefined,
      config,
      accountId: body.accountId as string | undefined,
      persist: body.persist !== false,
      sync: body.sync,
    });
    return NextResponse.json({
      range,
      result: out.result,
      ingest: { sources: out.ingest.sources, rows: out.ingest.rows.length },
      datasetId: out.dataset?.id ?? null,
      sync: out.sync,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 502 },
    );
  }
}
