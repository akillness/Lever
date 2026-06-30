# Feature survey & differentiation — Lever

A survey of what Lever actually implements today, mapped against the media-buyer
job-to-be-done and against the tools It's Today Media already builds.

## Implemented feature inventory (verified in code + tests)

| Capability | Module | Tests |
|------------|--------|-------|
| Cross-platform metric normalization (CPA/EPC/ROAS/CVR/CTR/CPC/profit) | `metrics.ts` | ✓ |
| Schema-tolerant CSV ingest (aliases, currency strip, negative clamp) | `csv.ts` | ✓ |
| Untrusted-payload sanitization for the API | `csv.ts:sanitizeAdRows` | ✓ |
| Budget-leak detection (high spend / 0 conversions) — most urgent | `engine.ts` | ✓ |
| PAUSE / SCALE / REFRESH_CREATIVE / KEEP rules, formula-backed | `engine.ts` | ✓ |
| Period-over-period creative-fatigue (CTR drop vs entity's own prior period) | `engine.ts` | ✓ |
| LTV-weighted revenue (first-party value per conversion) | `metrics.ts:effectiveRevenue` | ✓ |
| Per-recommendation confidence (signal strength) | `metrics.ts:signalConfidence` | ✓ |
| Portfolio reallocation (free budget → best winner) | `engine.ts:buildReallocation` | ✓ |
| Per-channel breakdown | `metrics.ts:summarizeByChannel` | ✓ |
| Account health score (0–100) | `engine.ts:accountHealth` | ✓ |
| What-if simulator (live engine-config sliders) | `page.tsx` | (UI) |
| CSV export of recommendations | `export.ts` | ✓ |
| Persistence seam: in-memory + Firestore, env-selected | `storage.ts` | ✓ |
| Dataset save/list API | `api/analyze`, `api/datasets` | (live-verified) |

## Differentiation vs. the field

| Dimension | Typical creative/ops tools (incl. ITM's own) | Lever |
|-----------|----------------------------------------------|-------|
| Job | *Make* creative / *ship* ads / *build* pages | **Decide** where the next dollar goes |
| Objective | Vanity ROAS / volume | **Profit vs. target** (survives signal loss) |
| Output | Dashboards or generated assets | **Ranked $-backed actions** with the formula |
| Trust model | Black-box "AI suggests" | **Deterministic + explainable** (defensible) |
| Most-urgent catch | — | **Budget-leak** (burning spend, 0 conversions) |
| Exec view | Charts | **Single account-health score** |
| Integration | Standalone | **`/api/analyze`** drives downstream agents/MCP |

## The one-sentence wedge

It's Today Media already builds the *make* and *ship* layers; Lever is the
**explainable judgment layer that decides and ranks the money moves** — the part
that a senior buyer does by hand every morning and the part that survives 2026's
signal-loss and explainability pressures.

## Honest gaps (next cycles)

- Time-series creative-fatigue: period-over-period now shipped (`priorCtr` trend signal); multi-period (3+) CTR-decline modeling still pending.
- LTV-weighted revenue: shipped (`ltvPerConversion` → `effectiveRevenue` flows through metrics/totals/health); channel-level LTV curves still pending.
- Live OAuth pulls from each ad platform (CSV/seed today).
- LLM-authored natural-language rationales over the deterministic core.
