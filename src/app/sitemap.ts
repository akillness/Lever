import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

/**
 * The entire product is a single-page app (`/`) — no separate marketing or
 * docs routes are served from this Next app. One accurate entry beats a
 * fabricated multi-page sitemap; add rows here if/when more routes ship.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = resolveSiteUrl();
  return [
    {
      url: base.toString(),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
