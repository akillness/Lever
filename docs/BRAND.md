# Lever — Brand & Product Identity Seed

> Frozen spec (ooo seed) for Cycle 30. Implementation must satisfy this contract.

## Character
Lever is a **deterministic, explainable profit copilot** for cross-platform media
buyers. Its personality is **precise, trustworthy, and quietly confident** — a
financial instrument, not a hype tool. Every pixel should read "the math is
already done; here is the one move that matters."

## Name meaning
A **lever** delivers mechanical advantage: small, well-placed force → outsized
result. The product finds the highest-**leverage** dollar move. The mark is a
**bar balanced on a fulcrum**, the short arm lifting the long arm — leverage made
literal, and a subtle upward profit lift.

## Voice
- Declarative, numeric, no fluff. "Pause leaks, scale winners — each move shown with the math."
- Confidence without hype. Show the dollars, show the reasoning.

## Color tokens
| Token | Hex | Role |
| --- | --- | --- |
| `--brand-ink` | `#0f172a` | Primary brand / text (slate-900) |
| `--brand-surface` | `#ffffff` | Cards / canvas |
| `--brand-line` | `#e2e8f0` | Hairline borders (slate-200) |
| `--brand-profit` | `#047857` | Positive / scale / profit (emerald-700) |
| `--brand-leak` | `#b91c1c` | Pause / loss (red-700) |
| `--brand-fatigue` | `#b45309` | Refresh creative (amber-700) |
| `--brand-review` | `#4338ca` | Review / reallocation (indigo-700) |

## Type
- UI: Geist Sans. Numerals/metrics: Geist Mono. Headings tight tracking, black weight for wordmark.

## Asset inventory (registered)
- `src/app/icon.png` (512²) + `src/app/favicon.ico` (16/32/48) — app icon / favicon: the Cycle-63 god-tibo-imagen lever-on-fulcrum mark, ink on white (raw + normalized sources in `brand-raw/`).
- `src/app/apple-icon.png` (180²) — touch icon.
- `public/icon-192.png` / `public/icon-maskable.png` — PWA home-screen icon (`any`) and a safe-zone-padded `maskable` variant, wired into `manifest.ts`.
- `public/safari-pinned-tab.svg` (Cycle 69) — hand-authored monochrome vector twin of the same lever-on-fulcrum geometry, registered as `icons.other` (`rel="mask-icon"`, `color: #0f172a`) in `layout.tsx` so Safari's pinned-tab silhouette still reads as the mark.
- `src/app/opengraph-image.png` / `src/app/twitter-image.png` — 1200×630 social card (`brand-raw/build-og.sh` composites the mark with hand-set vector typography).
- `public/empty-state.png` (Cycle 69, 480²) — a fresh `god-tibo-imagen` generation (lever-on-fulcrum line art + an empty dashed data axis, "waiting for data") trimmed/centered/flattened on white (raw + normalized sources in `brand-raw/cy69/`); registered in the "No data yet" empty state via `next/image` so a branded moment replaces a plain text placeholder.
- Per-action symbol glyphs (Cycle 69) — `ActionIcon` in `page.tsx`: five small hand-authored `currentColor` SVGs (pause bars / scale arrow / refresh arrows / review magnifier / keep check) rendered inside every recommendation's action badge, so the identity carries a *symbol system*, not just color-coded text — also a second always-visible cue for colorblind readers.
- `src/app/manifest.ts` → `/manifest.webmanifest` — installable web app manifest (name/short_name, `theme_color` ink, `background_color` white, icon refs); `viewport.themeColor` in `layout.tsx` tints mobile browser chrome ink.
- Inline header logomark — hand-authored SVG (vector, theme-aware, no network) in `page.tsx`, the precise twin of the registered raster mark.
- JSON-LD `SoftwareApplication` structured data + `robots.ts` + `sitemap.ts` (Cycle 69) — production SEO hygiene so the identity resolves correctly to search engines and AI crawlers, not just to human visitors.

## Design-system rule: raster vs. vector
`god-tibo-imagen` generations are reserved for **static, marketing-facing raster
art** — the favicon/app-icon family, the OG/social card, and one-off branded
illustrations like the empty state. Every **functional, in-app** identity
element (header logomark, per-action symbols, the Safari pinned-tab silhouette)
is hand-authored inline/vector SVG so it stays crisp at any DPI, restyles via
`currentColor`/brand tokens, and never ships extra image weight for a 12–28px
glyph. Don't blur this line even when asked to "generate" everything — it's
the reason the mark is legible from a favicon down to a 12px action badge.

## Acceptance criteria
1. A distinct, on-brand lever symbol replaces the default Next.js favicon.
2. The header carries an inline vector logomark (crisp at any DPI, currentColor-themeable).
3. Social/OG + apple-touch metadata resolve to real brand images.
4. Brand color tokens are defined once in `globals.css` and the UI references the identity consistently.
5. Every recommendation action badge carries both a color and a distinct symbol (colorblind-safe, not color-only).
6. Empty/zero-data states use a branded illustration, not a bare text placeholder.
7. `robots.txt` / `sitemap.xml` / JSON-LD resolve for production crawlers.
8. Build ✓ · all tests ✓ · lint 0 · live render verified.

