import { NextResponse } from "next/server";
import { analyze } from "@/lib/engine";
import { createStorage } from "@/lib/storage";

/**
 * GET /api/datasets/:id
 * Fetches one persisted dataset by id and returns its rows plus a fresh
 * analysis, so the UI (or an agent) can reload and re-rank a saved snapshot.
 * 404 when the id is unknown; 502 if the store itself fails.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const dataset = await createStorage().getDataset(id);
    if (!dataset) {
      return NextResponse.json({ error: `Dataset '${id}' not found.` }, { status: 404 });
    }
    return NextResponse.json({
      id: dataset.id,
      name: dataset.name,
      createdAt: dataset.createdAt,
      rows: dataset.rows,
      analysis: analyze(dataset.rows),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load dataset." },
      { status: 502 },
    );
  }
}
