# Brand asset provenance

Source-of-truth artifacts for Lever's identity (Cycle 56).

- `icon-raw.png` / `og-raw.png` — raw `god-tibo-imagen` (gti) generations from the
  prompts recorded in `../BRAND.md`.
- `icon-512.png`, `apple-icon-180.png` — the gti symbol trimmed/centered; copied to
  `src/app/icon.png`, `src/app/apple-icon.png`, and rasterized into `favicon.ico`.
- `build-og.sh` — regenerates `og-card.png` (the 1200×630 social card): hand-set
  vector typography composited over the gti symbol via `rsvg-convert`. Copied to
  `src/app/opengraph-image.png` and `src/app/twitter-image.png`.
- `og.svg` — the SVG emitted by `build-og.sh` (kept for inspection).

Reproduce the social card:  `bash build-og.sh`

## Cycle 63 refresh
`cy63/icon-raw.png` is a fresh `god-tibo-imagen` generation of the lever-on-fulcrum
mark (slate-ink bar + fulcrum, single emerald dot at the lifted right tip, pure-white
ground). It was trimmed, centered with generous padding, and flattened on white into
`icon-512.png` / `apple-icon-180.png` / `favicon.ico`, then re-composited into the OG
card via `build-og.sh`. Those normalized files (in this dir) are the canonical source
copied into `src/app/{icon,apple-icon,opengraph-image,twitter-image}.png` + `favicon.ico`.
The inline header `LeverMark` SVG in `page.tsx` is the precise vector twin (same
geometry/tokens) and remains the accessible, theme-aware header logomark.
## Cycle 69 — empty-state illustration
`cy69/empty-state-raw.png` is a new `god-tibo-imagen` generation: the same
slate-ink (#0f172a) lever-on-fulcrum line art with a single emerald (#047857)
dot at the lifted tip, plus a light-gray dashed horizontal line beneath it
standing in for an empty data axis — "waiting for data," not just a blank
mark. Trimmed, padded to a square, flattened on white, and downsized to
`empty-state-480.png`, which is copied to `public/empty-state.png` and
rendered via `next/image` in the "No data yet" empty state (`page.tsx`),
replacing what was a plain text-only placeholder. A pixel sample confirmed
ink, emerald, and gray pixel clusters are all present against the white
ground before normalization.

Reproduce the normalization:
```bash
cd cy69
magick empty-state-raw.png -trim +repage -bordercolor white -border 60 \
  -gravity center -background white \
  -extent "$(magick empty-state-raw.png -trim +repage -format '%[fx:max(w,h)+120]x%[fx:max(w,h)+120]' info:)" \
  empty-state-trimmed.png
magick empty-state-trimmed.png -background white -alpha remove -alpha off \
  -resize 480x480 empty-state-480.png
```
