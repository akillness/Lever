/**
 * Resolve the canonical site origin for absolute OG / Twitter / canonical /
 * sitemap / robots URLs. On Vercel this is derived from system env vars, so
 * production and preview deployments always emit correct absolute URLs
 * without hardcoding a domain:
 *  - NEXT_PUBLIC_SITE_URL           explicit override (custom domain / self-host)
 *  - VERCEL_PROJECT_PRODUCTION_URL  stable production domain, present on every
 *                                   deployment (custom domain or <project>.vercel.app)
 *  - VERCEL_URL                     unique per-deployment URL (preview deploys)
 * Falls back to localhost for `next dev` / `next start` outside Vercel.
 *
 * Single source of truth shared by layout.tsx (metadataBase, JSON-LD),
 * sitemap.ts, and robots.ts — previously duplicated only in layout.tsx.
 */
export function resolveSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return new URL(`https://${production}`);
  const deployment = process.env.VERCEL_URL;
  if (deployment) return new URL(`https://${deployment}`);
  return new URL("http://localhost:3000");
}
