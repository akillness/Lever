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
| Google | Google Ads API (Basic Access) | developer token + OAuth2 access token, or a refresh token (auto-minted, no rotation) | `customerId`, `developerToken`, + either `accessToken` **or** `refreshToken`+`clientId`+`clientSecret` (`loginCustomerId` optional) |
| Meta | Marketing API (Insights) | app + `ads_read` access token | `accountId`, `accessToken` |
| Taboola | Backstage API | client-credentials → bearer token | `accountId`, `accessToken` |
| TikTok | Marketing API | developer app → access token | `advertiserId`, `accessToken` |

`GET /api/credentials` returns this catalog plus a per-channel `configured` flag —
**without** echoing any secret value.

**Multi-tenant (cycle 68):** every credential write, read, and delete accepts
an optional `accountId` (1–64 `[A-Za-z0-9_-]` chars). Two accounts' credentials
for the same channel are stored under independent, non-colliding vault keys
(`vaultKey(channel, accountId)` → `${accountId}::${channel}`) and a GET scoped
to one `accountId` never reveals whether another tenant is configured. Omit it
and every route falls back to the original unnamespaced single-tenant account
— existing zero-config deployments, stored vault files, and integrations are
unaffected. `/api/ingest` and `/api/cron/ingest` accept the same `accountId` to
select which tenant's connectors to pull.

## 5. Success metrics

- **Activation:** % of accounts with ≥1 connector configured and a successful ingest.
- **Time-to-first-insight:** signup → first ranked action (target < 10 min).
- **Coverage:** channels ingested per account (target ≥ 2 to beat single-platform tools).
- **Trust:** sync success rate to Sheets (target ≥ 99%); zero plaintext secrets at rest (invariant).
- **Impact:** headline projected-$ acted on per week.

## 6. Prioritization (next)

| Item | Impact | Effort | Notes |
|---|---|---|---|
| ~~OAuth refresh-token flow (auto-mint access tokens)~~ | High | M | **Shipped (cycle 71, Google Ads):** supply `refreshToken`+`clientId`+`clientSecret` instead of a static `accessToken`; `fetchRows` mints a fresh token from Google's OAuth2 endpoint every call. Meta/Taboola/TikTok free-tier tokens are long-lived by design and still use a static `accessToken`. |
| ~~Per-account multi-tenant vault namespacing~~ | High | M | **Shipped (cycle 68):** `vaultKey(channel, accountId)` namespaces credentials (`${accountId}::${channel}`); `/api/credentials`, `/api/ingest`, `/api/cron/ingest` all accept `accountId` (default: unnamespaced single-tenant account — zero-config demo unaffected). |
| ~~Scheduled server-side ingest (cron)~~ | Med | S | **Shipped (cycle 67):** `GET /api/cron/ingest` + `vercel.json` cron (daily, 2-day trailing window), `LEVER_CRON_SECRET` bearer-token gated. |
| ~~Connector pagination + rate-limit backoff~~ | Med | M | **Shipped (cycle 66):** google/meta/tiktok walk every page (`MAX_FETCH_PAGES`-capped); backoff shipped cycles 58–61. |
| ~~Sheet → engine config write-back~~ | Low | S | **Shipped (cycle 73):** an Apps Script `Config` tab (`key`\|`value` rows) a PM edits by hand, read back via `GET ?action=config` before every analyze run (`fetchSheetConfig` → `sanitizeConfig`); `PipelineOptions.sheetsConfig` toggles it (default: on when a webhook URL is set), and a caller-supplied `config` field still wins per-key over the sheet. |

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

The prioritization items "Connector pagination + rate-limit backoff" and
"Scheduled server-side ingest (cron)" are now **fully shipped** (cycles
66–67): rate-limit backoff (cycles 58–61) plus multi-page pagination for
google/meta/tiktok capped by `MAX_FETCH_PAGES`, and a Vercel Cron-triggered
`GET /api/cron/ingest` (bearer-token gated via `LEVER_CRON_SECRET`) that runs
the same `runPipeline` orchestration on a daily 2-day trailing window.

## 9. Config write-back (shipped — cycle 73)

Every item in the §6 prioritization table above is now shipped. The last one,
Sheet → engine config write-back, closes the loop the other direction: instead
of Lever only ever *pushing* results to the sheet, a PM can now edit engine
thresholds (`targetRoas`, `minSpend`, `scaleStep`, ...) directly in a `Config`
tab and have the next ingest run pick them up automatically — no redeploy, no
API call, no engineer in the loop.

- `apps-script/Code.gs`: `GET ?action=config&token=...` reads the `Config`
  tab's `key`\|`value` rows into a plain object; same `SHEET_TOKEN` gate as
  the POST sync endpoint.
- `src/lib/sheets.ts`: `fetchSheetConfig()` is best-effort — a missing tab, a
  network blip, a bad token, or a garbage value all resolve to `{}` rather
  than throwing, so a sheet outage or a PM typo never blocks an ingest run.
  `sanitizeConfig()` (already used for the `/api/analyze` and `/api/ingest`
  request bodies) does double duty validating the sheet's response.
- `src/lib/pipeline.ts`: `runPipeline` fetches the sheet config before
  `analyze()` and merges it under any caller-supplied `config` — the sheet
  fills in what the caller didn't explicitly set, never overrides it. Both
  `/api/ingest` (on-demand, human-driven) and `GET /api/cron/ingest`
  (unattended, scheduled) go through the same merge, so the cron job — which
  has no caller to pass a `config` body — is the primary beneficiary.

### Real remaining open items (not yet started)

- **Real end-to-end live verification** against actual free-tier API accounts
  (Google Ads / Meta / Taboola / TikTok) — all testing to date is at the
  unit/mocked-fetcher level, never a live network call to the real platforms.
- **Live persistence on Vercel:** `InMemoryStorage` is per-lambda; wire
  `FIREBASE_PROJECT_ID`/`CLIENT_EMAIL`/`PRIVATE_KEY` for the `FirestoreStorage`
  adapter to activate (zero code change) before demoing cross-request reload.
- **UI persistence:** "Save snapshot" + "Saved datasets" reload buttons in the
  product UI, so the persist/reload story is visible end-to-end (do this only
  after Firestore is wired, else it 404s across lambdas).
- LTV-weighted UI input; surface the engine's formulas in tooltips.
