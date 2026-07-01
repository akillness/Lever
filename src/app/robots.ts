import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

/**
 * Machine-readable crawl policy — a real-service SEO basic that was missing.
 * `/api/*` is disallowed wholesale: every route under it is a JSON endpoint
 * (analyze/datasets/credentials/ingest/cron), never indexable page content,
 * regardless of which individual routes happen to be auth-gated today. (Auth
 * itself is enforced server-side per route — see `isAdminAuthorized` in
 * src/lib/adminAuth.ts — robots.txt is crawl etiquette, not a security
 * boundary, so it deliberately doesn't try to enumerate which routes are
 * "sensitive".) `sitemap` points crawlers at sitemap.ts for URL discovery,
 * resolved to an absolute URL the same way OG/canonical URLs are.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: new URL("/sitemap.xml", resolveSiteUrl()).toString(),
  };
}
