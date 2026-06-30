# Target Intelligence — It's Today Media "Build Challenge"

> Source of truth captured via Scrapling (lightest mode: plain HTTP + `Selector` parse,
> no browser needed — pages are server-rendered). Retrieved from
> https://www.itstoday.media/ , /role , /faq , /register.
> Drift check: home page byte-identical to first capture (no change). Re-verify dates before relying.
> Captured: this is a moving target — re-fetch before relying on dates.

## Scrapling intake packet (Step 1)

| Field | Value |
|---|---|
| **Target class** | Normal server-rendered marketing site (3 pages). Static HTML; no JS render or stealth required. |
| **Mode chosen** | `curl` (HTTP 200, ~54 KB) → `scrapling.parser.Selector`. No `DynamicFetcher`/`StealthyFetcher` needed. |
| **Desired output** | Structured contest brief + requirements to seed product ideation. |
| **Operational need** | One-time recon; cache locally; no crawl/spider justified (3 known URLs). |
| **Constraint** | Respect robots/ToS; this is a public hiring page, read-only fetch only. |

## What this actually is

A **hiring build contest** ("Build Challenge: Marketing Development Engineer") run by
**It's Today Media**, an **affiliate marketing company** that buys media at scale to build
email/SMS lists. Prize: **$5,000 cash + full-time job offer**.

- **Goal of the entrant**: Build a *real, working* AI-powered tool that delivers value to
  their **media buying team**.
- **They advertise across**: Google, Meta, Taboola, TikTok. They report on data to optimize,
  and build landing pages to generate/collect leads.
- **ROI is everything**; staying on the cutting edge of marketing execution is the business.

## Judging criteria (verbatim intent)

1. You believe it solves a real problem for their business.
2. You can convince them it solves a real problem.
3. It actually works — or is built to the highest functionality reasonably achievable.
4. "Build something. The bigger the better. Flex your muscles."

## What they're already building (idea adjacency — differentiate, don't clone)

- End-to-end **video creative generator**.
- Automated **ad creation + upload workflow via MCP server**.
- **Landing page generator + CMS**.

Suggested-but-open idea space: creative generation tools, MCP connectors to ad platforms,
automation workflows, **performance dashboards**, landing page builders, "or something else."

## Hard constraints & rules (from FAQ)

- **Tech stack: your choice.** They use Next.js, Python, AI frameworks internally, but judge
  the outcome, not the stack. → Next.js + Python + a SaaS DB (Firebase/Supabase) + Vercel deploy is on-pattern.
- **"Working demo"**: must be *demonstrable*. **Live URL ideal**; a Loom of it running locally
  is acceptable. **Screenshots/mockups are NOT accepted.** → must really run + deploy.
- **Individual submissions only** (no teams).
- **Built/substantially modified for this contest** — not an off-the-shelf prior project.
- You keep full IP on non-winning submissions.

## Timeline (verify before relying — site says 2026)

- Submissions open: now.
- Submissions close: **July 4, 2026, 11:59 PM ET**.
- Finalists notified: by **July 10, 2026**.
- Interviews + winner after that.
- Role requirements: full-time 40+ h/wk, East Coast hours overlap, US-based strongly preferred.

## Strategic read for product direction

The winning move is a tool that visibly **moves the ROI needle for a media buyer**, runs live,
and is explained in business terms. The three things they already build are creative-gen,
ad-upload-via-MCP, and LP/CMS — so the cleanest differentiation lanes are:
**(a) the optimization/reporting + decision layer** that sits *across* Google/Meta/Taboola/TikTok,
**(b) an agentic "media buyer copilot"** that turns performance data into recommended actions,
or **(c) the lead-quality / list-building feedback loop** (since the business monetizes email/SMS lists).

→ Downstream ($brainstorm-ideas-new, $deep-research, $spec-stack) should branch from these lanes.

## Links

- Home: https://www.itstoday.media/
- Role: https://www.itstoday.media/role
- FAQ: https://www.itstoday.media/faq
- Register: https://www.itstoday.media/register
- Company LinkedIn: https://www.linkedin.com/company/its-today-media/

## Registration page intel (/register) — what they actually ask & the real prize mechanics

The register form is short, but two fields define how the product must be positioned:

- **The pitch field**: "*What AI marketing problem would you tackle, and why?*" — **50–250 words**.
  This is the single most important positioning artifact; the product narrative must compress to this.
- Required: full name, email, **GitHub/portfolio/past-project URL** (ship-proof), US-resident yes/no.
- Acknowledgments you must accept (these correct earlier assumptions):
  - **Prize mechanics**: winning earns a **guaranteed finalist interview, NOT a guaranteed job offer**.
    The **$5,000 is paid only when you accept a full-time offer**. If no offer is extended, it
    **converts to a $250 finalist honorarium**. → the real prize is the *job*, not the cash.
  - Full-time availability (40+ h/wk, East Coast overlap) is an explicit checkbox.
  - You retain IP unless you accept the role and sign a standard employment IP assignment.
  - Non-US applicants must claim "uniquely qualified" to be considered.

**Implication for our build**: the deliverable is judged as *evidence you should be hired*, not as a
standalone SaaS. It must (1) run live, (2) obviously move ROI for a media buyer, and (3) be explainable
in a 50–250 word problem/why statement. Build for *demonstrated business judgment*, not feature count.
