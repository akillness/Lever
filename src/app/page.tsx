"use client";

import { useMemo, useState } from "react";
import { analyze, DEFAULT_CONFIG } from "@/lib/engine";
import { parseCsv } from "@/lib/csv";
import { recommendationsToCsv } from "@/lib/export";
import { SAMPLE_DATA } from "@/lib/sampleData";
import type { AdRow, EngineConfig, RecommendationAction } from "@/lib/types";

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
  KEEP: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const ACTION_LABEL: Record<RecommendationAction, string> = {
  PAUSE: "Pause",
  SCALE: "Scale",
  REFRESH_CREATIVE: "Refresh creative",
  KEEP: "Keep",
};

export default function Home() {
  const [rows, setRows] = useState<AdRow[]>(SAMPLE_DATA);
  const [source, setSource] = useState("Seeded demo dataset");
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);

  const result = useMemo(() => analyze(rows, config), [rows, config]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    }
  }

  function reset() {
    setRows(SAMPLE_DATA);
    setSource("Seeded demo dataset");
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

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black tracking-tight">Lever</span>
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
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
        <Kpi label="Blended ROAS" value={`${totals.roas.toFixed(2)}x`} />
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
        <div className="text-sm">
          <span className="font-semibold text-slate-900">Projected impact: </span>
          <span className="font-bold text-emerald-700">
            {usd(totals.projectedImpactUsd)}
          </span>
          <span className="text-slate-500"> across {actionable.length} actions</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Upload ad-platform CSV export"
              className="hidden"
              onChange={onUpload}
            />
          </label>
          <button
            onClick={reset}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset demo
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
        {error && <p className="w-full text-xs text-red-600">{error}</p>}
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
            format={(v) => `${v.toFixed(2)}x`}
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
                  className={`text-xs font-bold ${c.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}
                >
                  {c.roas.toFixed(2)}x
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {usd(c.spend)} spend · {usd(c.profit)} profit
              </div>
              <div className="text-xs text-slate-400">{c.entities} entities</div>
            </div>
          ))}
        </div>
      </section>

      {reallocation && (
        <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="text-sm font-semibold text-indigo-900">
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
            <p className="text-sm font-semibold text-slate-700">No data yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Upload a CSV export from any ad platform, or reset to the seeded demo.
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
        ) : null}
        <ul className="space-y-3">
          {recommendations.map((r) => (
            <li
              key={r.entityId}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase ring-1 ring-inset ${ACTION_STYLES[r.action]}`}
                >
                  {ACTION_LABEL[r.action]}
                </span>
                <span className="font-semibold text-slate-900">{r.entityName}</span>
                <span className="text-xs uppercase text-slate-400">{r.channel}</span>
                <span
                  className="text-xs font-medium text-slate-400"
                  title="Confidence from spend depth & conversion volume"
                >
                  {Math.round(r.confidence * 100)}% conf
                </span>
                {r.projectedImpactUsd > 0 && (
                  <span className="ml-auto text-sm font-bold text-emerald-700">
                    +{usd(r.projectedImpactUsd)}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">{r.rationale}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>ROAS {r.metrics.roas}x</span>
                <span>CPA {usd(r.metrics.cpa)}</span>
                <span>EPC {usd(r.metrics.epc)}</span>
                <span>CTR {(r.metrics.ctr * 100).toFixed(2)}%</span>
                <span>Profit {usd(r.metrics.profit)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-10 text-center text-xs text-slate-400">
        Lever · deterministic, explainable, profit-objective. Built for It&apos;s Today Media&apos;s
        media-buying team.
      </footer>
    </main>
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
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
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
        <span className="font-bold text-slate-900">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-slate-900"
      />
    </label>
  );
}
