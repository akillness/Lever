import { NextResponse } from "next/server";
import { analyze } from "@/lib/engine";
import { parseCsv, sanitizeAdRows } from "@/lib/csv";
import { SAMPLE_DATA } from "@/lib/sampleData";
import { createStorage } from "@/lib/storage";
import type { AdRow, Channel, EngineConfig } from "@/lib/types";
import { CHANNELS } from "@/lib/types";

/** Cap the request body so an oversized payload cannot exhaust the lambda. */
const MAX_ROWS = 5000;

/** The tunable numeric knobs an external caller may override (all of EngineConfig). */
const CONFIG_KEYS: (keyof EngineConfig)[] = [
  "targetRoas",
  "scaleTrigger",
  "scaleStep",
  "marginalEfficiency",
  "fatigueRatio",
  "fatigueDeclineRatio",
  "refreshCap",
  "minSpend",
  "minConversions",
  "pacingThreshold",
];

/** Accept only finite, non-negative numeric overrides; ignore everything else. */
function sanitizeConfig(input: unknown): Partial<EngineConfig> {
  if (input == null || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const cfg: Partial<EngineConfig> = {};
  for (const key of CONFIG_KEYS) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) cfg[key] = v;
  }
  // channelLtv is a nested map: keep only known channels with finite, non-negative rates.
  const ltv = raw.channelLtv;
  if (ltv != null && typeof ltv === "object") {
    const rawLtv = ltv as Record<string, unknown>;
    const clean: Partial<Record<Channel, number>> = {};
    for (const ch of CHANNELS) {
      const v = rawLtv[ch];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[ch] = v;
    }
    if (Object.keys(clean).length > 0) cfg.channelLtv = clean;
  }
  return cfg;
}

/**
 * POST /api/analyze
 * Body: { rows?: AdRow[], csv?: string, config?: Partial<EngineConfig>,
 *         persist?: boolean, name?: string }. With no rows/csv it falls back to the
 * seeded dataset. Returns the full AnalysisResult so the engine can also be driven
 * server-side or by an external agent/MCP client (config included).
 */
export async function POST(request: Request) {
  let rows: AdRow[] = SAMPLE_DATA;
  let persist = false;
  let name = "";
  let config: Partial<EngineConfig> = {};
  try {
    const body = (await request.json().catch(() => ({}))) as {
      rows?: AdRow[];
      csv?: string;
      config?: Partial<EngineConfig>;
      persist?: boolean;
      name?: string;
    };
    if (Array.isArray(body.rows) && body.rows.length > 0) {
      const clean = sanitizeAdRows(body.rows.slice(0, MAX_ROWS));
      if (clean.length > 0) rows = clean;
    } else if (typeof body.csv === "string" && body.csv.trim().length > 0) {
      const parsed = parseCsv(body.csv).slice(0, MAX_ROWS);
      if (parsed.length > 0) rows = parsed;
    }
    config = sanitizeConfig(body.config);
    persist = body.persist === true;
    name = body.name?.trim() || `dataset-${new Date().toISOString()}`;
  } catch {
    // Malformed body — analyze the seeded dataset instead.
  }

  const result = analyze(rows, config);
  if (!persist) return NextResponse.json(result);

  // Persist in its own boundary: a storage failure must NOT masquerade as success.
  try {
    const saved = await createStorage().saveDataset(name, rows);
    return NextResponse.json({ ...result, persisted: true, datasetId: saved.id });
  } catch (err) {
    return NextResponse.json(
      {
        ...result,
        persisted: false,
        error: err instanceof Error ? err.message : "Failed to persist dataset.",
      },
      { status: 502 },
    );
  }
}

/** GET returns an analysis of the seeded dataset — handy for a quick health check. */
export async function GET() {
  return NextResponse.json(analyze(SAMPLE_DATA));
}
