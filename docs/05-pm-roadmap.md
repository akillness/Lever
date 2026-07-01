# Lever — Product roadmap & real-data spec stack

_Owner: PM · Status: real-data integration milestone shipped (cycles 30–50)_

## 1. Product thesis

A solo/lean media buyer spends across Google, Meta, Taboola, and TikTok and
reconciles four dashboards by hand. Lever collapses that into **one dollar-ranked
"do this next" list** with the math shown. The differentiator is an explainable,
deterministic profit engine — not a black-box "AI optimizer."

Until now the engine ran on uploads and a seeded demo. This milestone makes it
run on **live platform data**, stored safely, and **synced to a shared Google
Sheet** the whole team already lives in.

## 2. Personas & jobs-to-be-done

| Persona | JTBD | Lever surface |
|---|---|---|
| Solo performance marketer | "Tell me the single highest-$ move across all my channels right now." | Dashboard + `/api/ingest` |
| Agency buyer (5–20 accounts) | "Pull every account nightly without me logging into 4 UIs." | Connectors + Apps Script schedule |
| Founder / finance | "Show me account health and where money leaks, in a sheet I can pivot." | Sheets sync (newest-first) |
| Data/ops engineer | "Keep API keys encrypted, not pasted in a Slack." | Encrypted vault + admin-gated API |

## 3. Real-data architecture (spec stack)

```
 Channel APIs (free tier)        Encrypted vault            Engine            Sinks
 ────────────────────────        ───────────────            ──────            ─────
 Google Ads  ─┐                  LEVER_SECRET_KEY                            ┌─ LocalFileStorage / Firestore
 Meta        ─┤  connectors ──▶  AES-256-GCM (scrypt) ──▶  ingest ──▶ analyze ┤
 Taboola     ─┤  normalize       FileCredentialVault       pipeline   (ranked) └─ Google Sheet (Apps Script,
 TikTok      ─┘  → AdRow[]       (ciphertext at rest)                            newest-first upsert)
```

| Layer | Module | Contract |
|---|---|---|
| Secrets | `src/lib/secrets.ts` | `encryptSecret/decryptSecret` (AES-256-GCM, per-record salt+IV, GCM tag); `FileCredentialVault` writes only ciphertext; `InMemoryCredentialVault` for zero-config. |
| Connectors | `src/lib/channels/*` | One `ChannelConnector` per platform: pure `normalize(raw)→AdRow[]` + injectable-fetch `fetchRows`. Free-tier endpoints documented in `freeTier`. |
| Persistence | `src/lib/storage.ts` | `StorageAdapter`; selection priority Firebase → `LocalFileStorage` (`LEVER_DB_PATH`) → in-memory. |
| Sheets | `src/lib/sheets.ts` + `apps-script/Code.gs` | newest-first, de-duplicated payload; Apps Script upserts by `date|channel|entityId`, sorts, trims, runs a daily trigger. |
| Pipeline | `src/lib/pipeline.ts` | `ingestFromConnectors` (per-channel status, error-isolated) + `runPipeline` (ingest→analyze→persist→sync). |
| API | `/api/credentials`, `/api/ingest` | Admin-gated credential writes (never readable back); ingest validates the reporting window and degrades gracefully. |

## 4. Free-tier credential onboarding

Credentials are **never** committed or placed in `.env`; they are sealed into the
vault at runtime via `POST /api/credentials`.

| Channel | Free API | What to get | Vault fields |
|---|---|---|---|
| Google | Google Ads API (Basic Access) | developer token + OAuth2 access token | `customerId`, `developerToken`, `accessToken` (`loginCustomerId` optional) |
| Meta | Marketing API (Insights) | app + `ads_read` access token | `accountId`, `accessToken` |
| Taboola | Backstage API | client-credentials → bearer token | `accountId`, `accessToken` |
| TikTok | Marketing API | developer app → access token | `advertiserId`, `accessToken` |

`GET /api/credentials` returns this catalog plus a per-channel `configured` flag —
**without** echoing any secret value.

## 5. Success metrics

- **Activation:** % of accounts with ≥1 connector configured and a successful ingest.
- **Time-to-first-insight:** signup → first ranked action (target < 10 min).
- **Coverage:** channels ingested per account (target ≥ 2 to beat single-platform tools).
- **Trust:** sync success rate to Sheets (target ≥ 99%); zero plaintext secrets at rest (invariant).
- **Impact:** headline projected-$ acted on per week.

## 6. Prioritization (next)

| Item | Impact | Effort | Notes |
|---|---|---|---|
| OAuth refresh-token flow (auto-mint access tokens) | High | M | Connectors accept a token today; add refresh to remove manual rotation. |
| Per-account multi-tenant vault namespacing | High | M | Today one vault per deployment; namespace by account id. |
| Scheduled server-side ingest (cron) | Med | S | Pair with Apps Script trigger for a fully hands-off loop. |
| ~~Connector pagination + rate-limit backoff~~ | Med | M | **Shipped (cycle 66):** google/meta/tiktok walk every page (`MAX_FETCH_PAGES`-capped); backoff shipped cycles 58–61. |
| Sheet → engine config write-back | Low | S | Let buyers tune thresholds from the sheet. |


## 7. Guardrails (non-negotiable)

1. No credential is ever written to disk in plaintext or returned over HTTP.
2. The zero-config demo must keep working with no env set.
3. Every new module ships with unit tests; the existing suite stays green.
4. Connector failures are isolated and reported, never silently dropped.

## 8. Production resilience (shipped — cycles 58–61)

Real free-tier ad APIs and the Apps Script web app fail in transient,
hostile-to-naive-clients ways (429 rate limits, 5xx blips, hung sockets). This
iteration hardened the network seams so a single hiccup never fails or stalls a
whole ingest run, and closed a timing-side-channel on the public Sheets endpoint:

- **Bounded retry with backoff.** `fetchWithRetry` wraps the existing
  abort-timeout fetch and retries 429/500/502/503/504 + thrown network/timeout
  errors with exponential backoff (injectable sleep → offline-testable). Non-
  retryable 4xx (e.g. auth) return immediately. All four connectors and the
  Sheets push now route through it; `PipelineOptions.sheetsRetry` tunes the budget.
- **Constant-time web-app token.** The Apps Script `doPost` token check uses a
  length-folded constant-time compare (`safeEqual_`) so the shared secret's
  length/prefix can't leak through response timing.
- **Live-verified.** Admin-gated `POST /api/ingest` ranks real-shaped rows end to
  end; production fails closed (401) without `LEVER_ADMIN_TOKEN`; the credential
  catalog serves all four channels' free-tier onboarding.
The prioritization item "Connector pagination + rate-limit backoff" is now
**fully shipped** (cycle 66) — rate-limit backoff (cycles 58–61) plus
multi-page pagination for google/meta/tiktok, capped by `MAX_FETCH_PAGES` so
a runaway cursor can't loop forever.

accounts remains the next connector task.