import type { MetadataRoute } from "next";

/**
 * Web app manifest — makes Lever installable and gives mobile browser chrome a
 * brand identity. Colors come straight from the brand tokens in globals.css /
 * docs/BRAND.md: ink (#0f172a) for the theme, white (#ffffff) for the canvas.
 * The icon points at the registered god-tibo-imagen lever symbol (src/app/icon.png).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lever — the media buyer's profit copilot",
    short_name: "Lever",
    description:
      "Pause leaks, scale winners, refresh fatigued creative — each move ranked, dollar-backed, and shown with the math.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
