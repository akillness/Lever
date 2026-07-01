import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { isCronAuthorized } from "@/lib/cronAuth";
import { isValidAccountId } from "@/lib/secrets";
import type { DateRange } from "@/lib/channels/types";

const DEFAULT_WINDOW_DAYS = 2;
const MAX_WINDOW_DAYS = 90;

/** Trailing `days`-day window ending today, in YYYY-MM-DD. */
function windowRange(days: number): DateRange {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/** Clamp an untrusted `?days=` query param to a sane, positive window. */
function parseDays(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
}

/**
 * GET /api/cron/ingest — scheduled entry point wired to Vercel Cron (see
 * `vercel.json`). Pulls every configured channel connector for a short
 * trailing window (default 2 days, so a daily run overlaps and never misses a
 * late-settling conversion), reads back any engine-config override a PM left
 * in the Sheet's Config tab (write-back — this unattended route has no
 * caller to pass a `config` body, so the sheet is the only way to tune
 * thresholds between deploys), persists the dataset, and syncs to the Google
 * Sheet — the same `runPipeline` orchestration the on-demand `/api/ingest`
 * route drives. Auth: `LEVER_CRON_SECRET` compared against the
 * `Authorization: Bearer` header Vercel Cron sends; see {@link isCronAuthorized}.
 *
 * `?days=N` overrides the window (capped) for a manual backfill trigger.
 * `?accountId=...` selects a tenant's vault-scoped credentials (default: the
 * single-tenant unnamespaced account); register one Vercel Cron entry per
 * `path` query string to schedule several tenants independently.
 */

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const range = windowRange(parseDays(url.searchParams.get("days")));
  const accountIdParam = url.searchParams.get("accountId");
  if (accountIdParam != null && !isValidAccountId(accountIdParam)) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }

  try {
    const out = await runPipeline({
      range,
      accountId: accountIdParam ?? undefined,
      persist: true,
    });
    return NextResponse.json({
      range,
      accountId: accountIdParam ?? undefined,
      ingest: { sources: out.ingest.sources, rows: out.ingest.rows.length },
      datasetId: out.dataset?.id ?? null,
      sheetConfig: out.sheetConfig,
      sync: out.sync,
    });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "cron ingest failed" },
      { status: 502 },
    );
  }
}
