<div align="center">

# ⚡ Lever

### The media buyer's profit copilot

**Turn four fragmented ad dashboards into one ranked "do this next" list — every move shown with the math and a projected dollar impact.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#-verify-it-yourself)
[![Tests](https://img.shields.io/badge/tests-89%20passing-brightgreen)](src/lib/engine.test.ts)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://lever-sepia.vercel.app)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Engine](https://img.shields.io/badge/engine-deterministic%20%C2%B7%20explainable-8957e5)](src/lib/engine.ts)
[![Objective](https://img.shields.io/badge/objective-profit%20vs%20target-f5b301)](#why-it-wins)
[![Live](https://img.shields.io/badge/▶_live_demo-lever--sepia.vercel.app-success?logo=vercel&logoColor=white)](https://lever-sepia.vercel.app)

<br/>

### 🌐 Live: **[lever-sepia.vercel.app](https://lever-sepia.vercel.app)**

<br/>

<img src="docs/lever-flow.svg" alt="Lever pipeline — four ad channels are normalized into metrics, scored by a deterministic profit engine, and emitted as dollar-ranked actions" width="900"/>

</div>

---

## The problem worth solving

A media buyer at an affiliate company runs spend across **Google, Meta, Taboola, and TikTok**.
The data lives in four dashboards with four schemas. The real job — *what do I do with the next
dollar?* — is done by hand, every morning, under pressure. That single decision is the
highest-leverage point in the entire ROI loop, and it's the one thing creative generators,
ad-upload workflows, and landing-page builders **don't** touch.

## What Lever does

Lever is the **decision brain** that sits on top of your spend:

- 📥 **Ingests** normalized performance from every channel (CSV upload or a seeded demo).
- 🧮 **Computes** what actually matters to a list-builder: **CPA, EPC, ROAS, profit** — not vanity metrics.
- 🎯 **Recommends** the highest-leverage moves — **Pause · Scale · Refresh creative · Review · Reallocate** —
  each ranked by **projected dollar impact**, a **confidence** score, and a transparent formula.
- 🎯 **Target-aware** — raise your ROAS goal above breakeven and profitable-but-under-target entities are flagged **Review** instead of being called "healthy".
- 🩸 **Catches budget leaks** — spend burning with zero conversions is flagged as the *most urgent* move.
- 📉 **Detects creative fatigue three ways** — CTR below the channel median, a sharp single-period drop, *and* a sustained multi-period decline versus the creative's recent peak.
- 💎 **Values first-party LTV** — feed a known lifetime value per conversion (per entity *or* a per-channel default) and the engine optimizes on *true downstream value*, not just immediately-attributed revenue.
- 🚦 **Spots budget-capped winners** — a strong performer pinned near its spend cap is throttled demand, so the Scale call flags the cap to raise and carries higher confidence.
- 🧭 **Scores the account** with a single 0–100 **health** number and a **per-channel breakdown** for the exec view.
- 🎛️ **What-if simulator** — tune the engine's thresholds live and watch the action feed re-rank.
- 📤 **Exports** the ranked actions to CSV for ad-ops, and **persists** datasets (in-memory → Firestore).
- 🤝 **Argues for itself**: every recommendation shows the math, so a buyer can act on it *and defend it*.

> It doesn't optimize vanity ROAS. It optimizes **profit against target** — the affiliate north-star.

## Why it wins

| Most tools | Lever |
|---|---|
| Make more creative / upload ads / build pages | Tells you **what to change and why** |
| Vanity ROAS dashboards | **Profit-objective**, dollar-ranked actions |
| Black-box "AI suggestions" | **Deterministic + explainable** — every move shows its formula |

The core is an **explainable, profit-objective recommendation engine**: pure, deterministic,
89 unit tests, with a clean seam to attach an LLM for richer natural-language rationales.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000  — boots on a seeded 4-channel dataset
```

Drop in any ad-platform CSV (schema-tolerant — it understands `cost`/`spend`,
`conversion_value`/`revenue`, `platform`/`channel`, …) and the action feed re-ranks instantly.

Drive the engine programmatically (or from an agent/MCP client):

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"csv":"campaign,platform,cost,conversion_value,leads,clicks,impressions\nSolar,Google,1000,2500,40,500,12000"}'
```

## 🔬 Verify it yourself

```bash
npm test             # 89 passing — engine rules, metrics, confidence, storage, CSV, export, API route
npm run build        # production build + full TypeScript check
```

On the seeded dataset the engine flags **$8,269 of recommended impact** across the portfolio —
catching a budget leak (spend with zero conversions), pausing money-losers, scaling winners,
and refreshing fatigued creative — plus a **separate ~$1,008 budget-reallocation** opportunity
(capped at what the winner can absorb at quoted efficiency; never double-counted into the
headline) and an overall **account health of 80/100**.

## Architecture

```
src/lib/engine.ts       ← the core: profit-objective recommendation engine + account health (deterministic)
src/lib/metrics.ts      ← pure metric derivations (CPA, EPC, ROAS, …) + confidence + channel rollup
src/lib/csv.ts          ← schema-tolerant CSV → canonical rows + untrusted-payload sanitizer
src/lib/export.ts       ← ranked recommendations → escaped CSV
src/lib/storage.ts      ← StorageAdapter seam (in-memory ↔ Firestore, env-selected, memoized)
src/app/page.tsx        ← dashboard: KPIs, health, channel breakdown, what-if sliders, action feed
src/app/api/analyze     ← analyze + optional persist (agent/MCP entry point)
src/app/api/datasets    ← list persisted datasets
```

## Going to production

- **Deployed**: live on Vercel at **[lever-sepia.vercel.app](https://lever-sepia.vercel.app)** —
  a stock Next.js app, zero config. Reproduce with `vercel --prod`.
- **Persistence**: `FirestoreStorage` is already implemented against the `StorageAdapter`
  interface in `src/lib/storage.ts`; the engine and UI need **zero changes**. Set
  `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` as Vercel
  environment variables and `createStorage()` switches from in-memory to Firestore automatically.
- **Live data**: swap the CSV/seed ingest for OAuth pulls from each ad platform behind the same
  `AdRow[]` contract.

## Project docs

- [`docs/target-intel-itstoday.md`](docs/target-intel-itstoday.md) — the brief this was built for
- [`docs/01-brainstorm-decision.md`](docs/01-brainstorm-decision.md) — idea & brand decision
- [`docs/02-spec.md`](docs/02-spec.md) — product spec

---

<div align="center">
<sub>Built for It's Today Media's media-buying team — deterministic, explainable, profit-first.</sub>
</div>
