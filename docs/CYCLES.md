# Build cycle log — Lever

Each entry = one full jeo cycle (change → build → test → real-operation verify → commit).

| # | Cycle | Key change | Verification |
|---|-------|-----------|--------------|
| 1 | MVP | engine + metrics + CSV + dashboard + `/api/analyze` + 14 tests + docs | build ✓ · 14 tests ✓ · server 200 · API $6,567 impact |
| 2 | Deep research | `docs/03-deep-research-2026.md` — 2026 trends vs. differentiation | build ✓ |
| 3 | Confidence | per-rec `confidence` (spend+conversion signal) in engine/UI + 4 tests | build ✓ · 18 tests ✓ |
| 4 | Firestore adapter | real `FirestoreStorage` (firebase-admin, lazy import, env-gated) | build ✓ |
| 5 | Storage hardening | deterministic tie-break in `InMemoryStorage.listDatasets` (bug found by test) | 24 tests ✓ |
| 6 | Persist API | `POST /api/analyze {persist,name}` → `createStorage().saveDataset` returns `datasetId` | server: `datasetId=ds-1` |
| 7 | Channel breakdown | `summarizeByChannel` (engine `byChannel`) + UI breakdown cards + 2 tests | build ✓ · 26 tests ✓ |
| 8 | What-if simulator | live EngineConfig sliders (targetRoas/scaleTrigger/scaleStep) re-run analyze in UI | build ✓ · 26 tests ✓ |
| 9 | Export | `recommendationsToCsv` (escaped) + UI "Export CSV" download + 3 tests | build ✓ · 29 tests ✓ |
| 10 | Budget-leak rule | new most-urgent PAUSE for high-spend/zero-conversion waste (closed a "hold a burning campaign" gap) + 2 tests | build ✓ · 31 tests ✓ |
| 11 | Input hardening | clamp negatives in CSV + `sanitizeAdRows` untrusted-payload guard in API + 4 tests | build ✓ · 34 tests ✓ |
| 12 | SEO/marketing meta | OpenGraph + Twitter card + keywords + metadataBase in layout | build ✓ |
| 13 | Empty/clear states + a11y | "no data" + "all clear" panels, aria-label on upload, disabled export when empty | build ✓ |
| 14 | Deploy readiness | `.env.example` (Firebase trio), `.nvmrc`, `engines.node>=20` | build ✓ |
| 15 | Datasets API + store singleton | `GET /api/datasets` list; memoized `createStorage` (fixed per-request reset bug) + test | build ✓ · 35 tests ✓ · live list count=2 |
| 16 | Account health score | exec-level 0..100 portfolio health (ROAS vs target + budget discipline) in engine + KPI + 3 tests | build ✓ · 38 tests ✓ |
| 17 | Demo realism | added a budget-leak entity to seed data; top action now PAUSE $2,400, impact $9,567, health 76 | build ✓ · 38 tests ✓ · live verified |
| 18 | Survey + lint gate | `docs/04-survey-differentiation.md` feature inventory + competitive table; eslint clean | lint ✓ (0 errors) |
| 19 | README marketing | refreshed badges (38 tests), feature bullets (leak/health/what-if/export/persist), architecture + impact ($9,567) | docs |
| 20 | jeo team validation + fixes | architect/critic review caught: (1) high-spend money-loser with 1–4 conv falling into KEEP "healthy" → PAUSE dead-zone fix + regression test; (2) silent persist-failure masking → HTTP 502 `{persisted:false,error}`; (3) reallocation dollars double-counted into headline → `buildReallocation` uses freed spend, headline excludes it (seed $9,567→$7,647 + separate $1,920); (4) unknown platform misattributed to "google" → `"other"` tag. README/badges corrected to 41 tests & honest impact | build ✓ · 41 tests ✓ · live: headline $7,647 / realloc $1,920 / health 76 · persist-fail → 502 |
| 21 | RFC-4180 CSV parser | replaced line-split parser with a full tokenizer (`parseRecords`) that respects quoted fields with embedded commas **and newlines** + `""` escapes; added regression test | build ✓ · 42 tests ✓ · live: POST /api/analyze parses + ranks || 22 | Dataset read API | `GET /api/datasets/:id` returns a saved snapshot's rows + a fresh analysis (404 unknown, 502 store error) — completes the persist→reload loop | build ✓ · 42 tests ✓ · live: ds-1 fetch 9 rows/9 recs · 404 ok |
| 23 | Ponytail-ultra cleanup | removed duplicated doc-comment lines flagged in review (`types.ts` rationale, `storage.ts` InMemory) ; scanned all `src/**` for dup comments (clean) | build ✓ · 42 tests ✓ |
| 24 | Period-over-period creative fatigue | new trend signal: optional `AdRow.priorCtr` + `fatigueDeclineRatio` (0.25) — REFRESH_CREATIVE now also fires when CTR drops ≥25% vs the creative's own prior period (caught *even above channel median*); engine takes the larger of the cross-sectional/trend recovery estimates (capped); CSV `prior_ctr` alias ingest + `sanitizeAdRows`; seeded a TikTok trend-decay entity; backward compatible when `priorCtr` absent. README→47 tests/$7,797/health 77 | build ✓ · 47 tests ✓ · lint 0 · live: tt-3 REFRESH $150 "CTR fell 0.024→0.015 (−37.5%)", headline $7,797.2 / health 77 |
| 25 | LTV-weighted revenue | optional `AdRow.ltvPerConversion` (first-party value); new `effectiveRevenue` helper feeds `computeMetrics`, portfolio totals, channel rollup, and account health — so profit decisions reflect true downstream value, not just immediately-attributed revenue. CSV `ltv_per_conversion` alias ingest + `sanitizeAdRows`; seeded a "looks like a loser, wins on LTV" entity; backward compatible when absent. README→52 tests/$8,109/health 80 | build ✓ · 52 tests ✓ · lint 0 · live: g-3 PAUSE→SCALE $312 (ROAS 1.9), headline $8,109.2 / revenue $35,280 / health 80 |
