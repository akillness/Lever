# Lever — Product Spec ($spec-stack)

## 1. One-liner
**Lever** turns fragmented cross-platform ad performance into one ranked "do this next" list —
each move shown with the math and a projected dollar impact.

## 2. Problem
A media buyer at an affiliate company runs spend across Google, Meta, Taboola, and TikTok.
The performance data lives in four dashboards with different schemas. Deciding *what to do with
the next dollar* — pause a loser, scale a winner, refresh a fatigued creative, reallocate budget —
is manual, slow, and inconsistent. That decision is the highest-leverage point in the ROI loop,
and it's exactly the part no creative-gen / ad-upload / landing-page tool addresses.

## 3. Users & jobs
- **Media buyer (primary)**: "Every morning, tell me the top 5 highest-$-impact actions, with proof."
- **Marketing lead**: "Show me where budget is leaking and where to push."

## 4. Core value & the one key technology
An **explainable, profit-objective recommendation engine** over *normalized* cross-platform metrics.
It optimizes **profit vs. target**, not vanity ROAS. Deterministic and unit-tested; every output
carries a transparent formula and a projected $ delta, so it argues for itself.

## 5. Scope (Cycle 1 MVP)
- Ingest ad rows by **CSV upload** or **seeded demo dataset** (Google/Meta/Taboola/TikTok).
- Normalize to a canonical row; compute **spend, revenue, conversions, clicks, impressions →
  CPA, EPC, ROAS, CVR, CTR, CPC, profit**.
- Recommendation engine emits ranked actions: **PAUSE / SCALE / REFRESH_CREATIVE / KEEP**, plus a
  **portfolio reallocation** summary.
- Dashboard: KPI header, per-channel rollup, and a **prioritized action feed** with rationale + $ impact.

### Out of scope (documented, not built in Cycle 1)
- Live OAuth pulls from ad platforms (would need their accounts; demo uses CSV/seed).
- LLM-written rationales (engine exposes a seam; deterministic strings ship now).
- Write-back/auto-apply of changes to ad platforms.

## 6. Architecture

src/lib/types.ts      canonical domain types
src/lib/metrics.ts    pure metric derivations (no side effects)
src/lib/engine.ts     profit-objective recommendation engine (the core tech)
src/lib/csv.ts        CSV → canonical rows (schema-tolerant)
src/lib/sampleData.ts seeded realistic 4-channel dataset
src/lib/storage.ts    StorageAdapter interface + InMemory impl (Firestore impl documented)
src/app/page.tsx      dashboard (client) — seed/upload → engine → action feed
src/app/api/analyze   server route running the engine


## 7. Recommendation rules (transparent formulas)
- **PAUSE**: `profit < 0` and `spend ≥ minSpend` and `conversions ≥ minConversions`.
  `projectedImpactUsd = |profit|` (the bleed you stop this period).
- **SCALE**: `roas ≥ targetRoas × scaleTrigger` and enough signal.
  `incSpend = spend × scaleStep`; `incRevenue = incSpend × roas × marginalEfficiency`;
  `projectedImpactUsd = incRevenue − incSpend` (only if > 0).
- **REFRESH_CREATIVE**: `ctr < channelMedianCtr × fatigueRatio` and `spend ≥ minSpend` and `profit > 0`.
  `projectedImpactUsd = profit × (channelMedianCtr / ctr − 1)`, capped at `refreshCap × profit`.
- **KEEP**: default when no rule fires or signal is insufficient.
- **Portfolio reallocation**: sum of budget freed by PAUSE → directed to the top SCALE candidate;
  reports the from/to and net projected $ impact.
- Ranking: by `projectedImpactUsd` desc, tie-break by rule severity.

## 8. Data model (canonical row)
`{ id, name, channel, spend, revenue, conversions, clicks, impressions, date? }`
Derived metrics are computed, never stored, to keep the source of truth minimal.

## 9. Persistence / SaaS (considered)
- **Now**: `StorageAdapter` with `InMemoryStorage` — zero-config demo, fully runnable.
- **Production**: `FirestoreStorage` (Firebase) implementing the same interface — collections
  `datasets/{id}/rows`, `runs/{id}` for saved analyses; or Supabase Postgres equivalent.
  Swappable without touching the engine. Documented in README "Going to production".

## 10. Deploy
Next.js → **Vercel** native. `NEXT_PUBLIC_*` for client flags; Firebase/Supabase creds via Vercel
env vars when the production adapter is enabled.

## 11. Acceptance criteria (Cycle 1)
- `npm run build` passes (production build).
- `npx vitest run` passes engine + metrics + csv tests (≥ 12 assertions across rules).
- App boots, seeded dataset renders KPIs and a ranked action feed with non-trivial recommendations.
- README presents brand, badges, value, and a "going to production" path.
