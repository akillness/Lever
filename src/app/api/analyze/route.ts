import { NextResponse } from "next/server";
import { analyze } from "@/lib/engine";
import { parseCsv, sanitizeAdRows } from "@/lib/csv";
import { SAMPLE_DATA } from "@/lib/sampleData";
import { createStorage } from "@/lib/storage";
import type { AdRow } from "@/lib/types";

/**
 * POST /api/analyze
 * Body: { rows: AdRow[] } | { csv: string } | {} (falls back to the seeded dataset).
 * Returns the full AnalysisResult so the engine can also be driven server-side
 * or by an external agent/MCP client.
 */
export async function POST(request: Request) {
  let rows: AdRow[] = SAMPLE_DATA;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      rows?: AdRow[];
      csv?: string;
      persist?: boolean;
      name?: string;
    };
    if (Array.isArray(body.rows) && body.rows.length > 0) {
      const clean = sanitizeAdRows(body.rows);
      if (clean.length > 0) rows = clean;
    } else if (typeof body.csv === "string" && body.csv.trim().length > 0) {
      const parsed = parseCsv(body.csv);
      if (parsed.length > 0) rows = parsed;
    }
    const result = analyze(rows);
    if (body.persist) {
      const saved = await createStorage().saveDataset(
        body.name?.trim() || `dataset-${new Date().toISOString()}`,
        rows,
      );
      return NextResponse.json({ ...result, datasetId: saved.id });
    }
    return NextResponse.json(result);
  } catch {
    // fall back to the seeded dataset
  }
  return NextResponse.json(analyze(rows));
}

/** GET returns an analysis of the seeded dataset — handy for a quick health check. */
export async function GET() {
  return NextResponse.json(analyze(SAMPLE_DATA));
}
