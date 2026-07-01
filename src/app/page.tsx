"use client";

import Image from "next/image";
import { LeverMark } from "@/components/LeverMark";

import { useMemo, useState } from "react";

import { analyze, DEFAULT_CONFIG } from "@/lib/engine";
import { parseCsv } from "@/lib/csv";
import { recommendationsToCsv } from "@/lib/export";
import { SAMPLE_DATA } from "@/lib/sampleData";
import type { AdRow, EngineConfig, Recommendation, RecommendationAction } from "@/lib/types";

/** Reject pathological uploads before they block the main thread during a live demo. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const ACTION_STYLES: Record<RecommendationAction, string> = {
  PAUSE: "bg-red-50 text-red-700 ring-red-600/20",
  SCALE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  REFRESH_CREATIVE: "bg-amber-50 text-amber-700 ring-amber-600/20",
  REVIEW: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  KEEP: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const ACTION_LABEL: Record<RecommendationAction, string> = {
  PAUSE: "Pause",
  SCALE: "Scale",
  REFRESH_CREATIVE: "Refresh creative",
  REVIEW: "Review",
  KEEP: "Keep",
};
/**
 * A tiny per-action glyph so the action badges carry a symbol, not just a
 * color + word — a second, always-visible identity cue for colorblind users
 * and for the "scan the list fast" workflow a media buyer actually uses.
 * `currentColor` strokes/fills so each icon inherits its badge's text tone
 * (see ACTION_STYLES); purely decorative, so it's aria-hidden — the adjacent
 * ACTION_LABEL text is the accessible name.
 */
function ActionIcon({
  action,
  className,
}: {
  action: RecommendationAction;
  className?: string;
}) {
  const shared = {
    viewBox: "0 0 16 16",
    className,
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (action) {
    case "PAUSE":
      return (
        <svg {...shared} fill="currentColor">
          <rect x="4" y="3" width="2.6" height="10" rx="0.6" />
          <rect x="9.4" y="3" width="2.6" height="10" rx="0.6" />
        </svg>
      );
    case "SCALE":
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12 L8 6.5 L11 9 L13.5 4" />
          <path d="M10.2 4 L13.5 4 L13.5 7.3" />
        </svg>
      );
    case "REFRESH_CREATIVE":
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.2 8 A4.8 4.8 0 0 1 12.6 5.6" />
          <path d="M12.8 3 L12.8 6 L9.8 6" />
          <path d="M12.8 8 A4.8 4.8 0 0 1 3.4 10.4" />
          <path d="M3.2 13 L3.2 10 L6.2 10" />
        </svg>
      );
    case "REVIEW":
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6.8" cy="6.8" r="4" />
          <path d="M9.8 9.8 L13.2 13.2" />
        </svg>
      );
    case "KEEP":
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">

          <path d="M3.2 8.4 L6.4 11.6 L12.8 4.4" />
        </svg>
      );
  }
}


export default function Home() {
  const [rows, setRows] = useState<AdRow[]>(SAMPLE_DATA);
  const [source, setSource] = useState("Sample dataset");
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);

  const result = useMemo(() => analyze(rows, config), [rows, config]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That file is ${(file.size / 1_048_576).toFixed(1)} MB — please upload an export under 5 MB.`,
      );
      return;
    }
    setIsParsing(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setError("No rows parsed — check that the CSV has a header and data.");
        return;
      }
      setRows(parsed);
      setSource(`${file.name} · ${parsed.length} rows`);
      setError(null);
    } catch {
      setError("Could not read that file.");
    } finally {
      setIsParsing(false);
    }
  }

  function reset() {
    setRows(SAMPLE_DATA);
    setSource("Sample dataset");
    setError(null);
  }

  function exportCsv() {
    const blob = new Blob([recommendationsToCsv(recommendations)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lever-recommendations.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const { totals, recommendations, reallocation, byChannel } = result;
  const actionable = recommendations.filter((r) => r.action !== "KEEP");
  const held = recommendations.filter((r) => r.action === "KEEP");

  return (
    <>
    <div className="brand-accent-bar w-full" />
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2.5">
          <LeverMark className="h-7 w-7" />
          <span
            className="text-2xl font-black tracking-tight"
            style={{ color: "var(--brand-ink)" }}
          >
            Lever
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: "var(--brand-ink)" }}
          >
            profit copilot
          </span>
        </div>
        <p className="mt-1 text-slate-600">
          The highest-leverage move for every dollar of ad spend — ranked, with the math.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Spend" value={usd(totals.spend)} />
        <Kpi label="Revenue" value={usd(totals.revenue)} />
        <Kpi
          label="Profit"
          value={usd(totals.profit)}
          tone={totals.profit >= 0 ? "good" : "bad"}
        />
        <Kpi label="Blended ROAS" value={`${totals.roas.toFixed(2)}×`} />
        <Kpi
          label="Account health"
          value={`${result.accountHealth}/100`}
          tone={
            result.accountHealth >= 70
              ? "good"
              : result.accountHealth < 40
                ? "bad"
                : undefined
          }
        />
      </section>

      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Projected profit lift
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black tabular-nums text-emerald-700">
              {usd(totals.projectedImpactUsd)}
            </span>
            <span className="text-sm tabular-nums text-slate-500">
              across {actionable.length} {actionable.length === 1 ? "action" : "actions"}
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label
            className={`rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 focus-within:ring-2 focus-within:ring-slate-900 focus-within:ring-offset-2 ${isParsing ? "cursor-progress opacity-70" : "cursor-pointer"}`}
          >
            {isParsing ? "Parsing…" : "Upload CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Upload ad-platform CSV export (max 5 MB)"
              disabled={isParsing}
              className="sr-only"
              onChange={onUpload}
            />
          </label>
          <button
            onClick={reset}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset sample
          </button>
          <button
            onClick={exportCsv}
            disabled={recommendations.length === 0}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
        <p className="w-full text-xs text-slate-500">Source: {source}</p>
        {error && (
          <p className="w-full text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            What-if · tune the engine
          </h2>
          <button
            onClick={() => setConfig(DEFAULT_CONFIG)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            Reset
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Slider
            label="Target ROAS"
            value={config.targetRoas}
            min={0.5}
            max={3}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(targetRoas) => setConfig((c) => ({ ...c, targetRoas }))}
          />
          <Slider
            label="Scale trigger"
            value={config.scaleTrigger}
            min={1}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(scaleTrigger) => setConfig((c) => ({ ...c, scaleTrigger }))}
          />
          <Slider
            label="Scale step"
            value={config.scaleStep}
            min={0.1}
            max={0.6}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(scaleStep) => setConfig((c) => ({ ...c, scaleStep }))}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Raise Target ROAS above 1.0 to flag profitable-but-under-goal entities for{" "}
          <span className="font-semibold text-indigo-600">Review</span>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Channel breakdown
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {byChannel.map((c) => (
            <div
              key={c.channel}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold uppercase text-slate-700">
                  {c.channel}
                </span>
                <span
                  className={`text-xs font-bold tabular-nums ${c.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}
                >
                  {c.roas.toFixed(2)}×
                </span>
              </div>
              <div className="mt-1 text-xs tabular-nums text-slate-500">
                {usd(c.spend)} spend · {usd(c.profit)} profit
              </div>
              <div className="text-xs tabular-nums text-slate-500">{c.entities} entities</div>
            </div>
          ))}
        </div>
      </section>

      {reallocation && (
        <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="text-sm font-semibold tabular-nums text-indigo-900">
            Portfolio reallocation · {usd(reallocation.projectedImpactUsd)} projected
          </div>
          <p className="mt-1 text-sm text-indigo-800">{reallocation.rationale}</p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Prioritized actions
        </h2>
        {recommendations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Image
              src="/empty-state.png"
              alt=""
              width={96}
              height={96}
              className="mx-auto mb-3 opacity-90"
            />

            <p className="text-sm font-semibold text-slate-700">No data yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Upload a CSV export from any ad platform, or reset to the sample dataset.
            </p>
          </div>

        ) : actionable.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="text-sm font-semibold text-emerald-800">
              All clear — no high-leverage moves right now.
            </p>
            <p className="mt-1 text-sm text-emerald-700">
              Every entity is healthy or below the action threshold. Hold and monitor.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {actionable.map((r, i) => (
              <RecommendationCard key={r.entityId} r={r} rank={i + 1} />
            ))}
          </ol>
        )}
        {held.length > 0 && (
          <details className="group mt-3 rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-600 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2">
              <span
                className="text-slate-400 transition-transform group-open:rotate-90"
                aria-hidden
              >
                ▸
              </span>
              Held — no action
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-500/20">
                {held.length}
              </span>
            </summary>
            <ul className="space-y-3 px-4 pb-4">
              {held.map((r) => (
                <RecommendationCard key={r.entityId} r={r} />
              ))}
            </ul>
          </details>
        )}
      </section>

      <footer className="mt-10 text-center text-xs text-slate-500">
        Lever · deterministic, explainable, profit-objective. Built for It&apos;s Today Media&apos;s
        media-buying team.
      </footer>
    </main>
    </>
  );
}

/**
 * One recommendation row — shared by the ranked actionable feed and the
 * collapsed "Held" group so both render identically. Pass `rank` to show the
 * 1-based position badge (the actionable feed is a semantic <ol>, so the badge
 * is aria-hidden to avoid double-announcing list position).
 */
function RecommendationCard({ r, rank }: { r: Recommendation; rank?: number }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {rank !== undefined && (
          <span className="text-xs font-bold tabular-nums text-slate-400" aria-hidden>
            #{rank}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold uppercase ring-1 ring-inset ${ACTION_STYLES[r.action]}`}
        >
          <ActionIcon action={r.action} className="h-3 w-3" />
          {ACTION_LABEL[r.action]}
        </span>

        <span className="font-semibold text-slate-900">{r.entityName}</span>
        <span className="text-xs uppercase text-slate-500">{r.channel}</span>
        <span
          className="text-xs font-medium tabular-nums text-slate-500"
          title="Confidence from spend depth & conversion volume"
        >
          {Math.round(r.confidence * 100)}% conf
        </span>
        {r.projectedImpactUsd > 0 && (
          <span className="ml-auto text-sm font-bold tabular-nums text-emerald-700">
            +{usd(r.projectedImpactUsd)}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">{r.rationale}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-slate-500">
        <span>ROAS {r.metrics.roas}×</span>
        <span>CPA {usd(r.metrics.cpa)}</span>
        <span>EPC {usd(r.metrics.epc)}</span>
        <span>CTR {(r.metrics.ctr * 100).toFixed(2)}%</span>
        <span>Profit {usd(r.metrics.profit)}</span>
      </div>
    </li>
  );
}
function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-bold tabular-nums text-slate-900">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={format(value)}
        className="mt-1 w-full accent-slate-900"
      />
    </label>
  );
}

