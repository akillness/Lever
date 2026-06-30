# Cycle 1 — Idea & Brand Decision

> Derived directly from `docs/target-intel-itstoday.md`. This freezes the seed the rest of
> the cycle builds on.

## The business truth we're optimizing for

It's Today Media is an **affiliate marketing** company. They **buy media at scale**
(Google, Meta, Taboola, TikTok) to **build email/SMS lists**, then monetize those lists.
**ROI is everything.** The job is judged on whether your build **moves the ROI needle for a
media buyer** and runs live.

## Idea-space scan (and why we reject the obvious)

They ALREADY build three things — so cloning any is weak positioning:
- ❌ Video creative generator (they build it)
- ❌ Ad upload workflow via MCP (they build it)
- ❌ Landing-page generator / CMS (they build it)

The gap none of those fill is the **decision layer**: a media buyer stares at fragmented
performance across 4 platforms and has to decide *what to do next with the next dollar*.
That judgment is manual, slow, and the single highest-leverage point in the ROI loop.

## Chosen idea (frozen)

**Lever — the media buyer's profit copilot.**

Ingest normalized cross-platform ad performance (Google / Meta / Taboola / TikTok) via CSV
upload or a seeded demo dataset → compute the metrics that actually matter for an affiliate
list-builder (**spend, revenue, CPA, EPC, ROAS, profit**) → an **explainable, profit-objective
recommendation engine** ranks the **highest-leverage actions** (pause, scale, reallocate,
refresh creative) — each with a plain-English rationale and a **projected $ impact** — into a
prioritized action feed. The buyer acts on the top of the list every morning.

### The one core technology (what the contest asks you to nail)

An **explainable, profit-objective recommendation/rules engine** over normalized cross-platform
metrics. Not vanity ROAS — it optimizes toward **profit vs. payout target**, the affiliate
north-star. Pure, deterministic, unit-testable core, with a clean seam to attach an LLM for
richer natural-language rationales later.

### Why this wins the contest's stated criteria

1. **Solves a real problem**: turns 4 fragmented dashboards into one ranked "do this next" list.
2. **Convincing**: every recommendation shows the math and a projected $ delta — it argues for itself.
3. **It actually works**: deterministic engine + live deploy + seeded demo means it's demonstrable
   without needing their private ad accounts (which we can't and shouldn't access).
4. **Differentiated**: it's the decision brain that sits *above* the three tools they already build.

## Brand

**Lever** — "Find the highest-leverage move for every dollar of ad spend."
Crisp, ownable, marketing-friendly, and it literally names the value: leverage on spend.

## Constraints honored

- Stack free → **Next.js + TypeScript** (on-pattern with their internal Next.js), Vercel-native deploy.
- SaaS DB considered → storage behind an adapter interface; in-memory now, **Firestore/Supabase**
  documented as the production impl (see spec).
- Demo bar → must run live with a seeded dataset; no screenshots-only.
