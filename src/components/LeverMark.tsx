/**
 * Lever logomark — a short arm pressed down lifts a long arm up over a fulcrum
 * (small force → outsized result, plus an upward profit lift). The pivot sits at
 * ~1/3 of the bar so the arms are visibly unequal — leverage, not a balanced
 * seesaw. Two-tone, driven by brand tokens (--brand-ink / --brand-profit), so
 * the mark restyles with the identity. Decorative: an adjacent "Lever" wordmark
 * (or page heading) is the accessible name, so the SVG is aria-hidden. Crisp at
 * any DPI, no network. Mirrors the registered app icon / favicon.
 *
 * Shared by the header (page.tsx), the branded 404 (not-found.tsx), and the
 * branded error boundary (error.tsx) — one definition, not three copies of the
 * same path data, so the mark can never drift between the pages a real
 * production visitor actually lands on.
 */
export function LeverMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
    >
      {/* fulcrum — apex sits a hair below the bar so the pivot reads crisp */}
      <path d="M12.6 21 L17.4 28.5 L7.8 28.5 Z" fill="var(--brand-ink)" />
      {/* lever bar: short left arm (5→12.6) down, long right arm (12.6→28) up */}
      <path
        d="M5 24 L28 9.8"
        stroke="var(--brand-ink)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* lifted weight — the profit point on the long arm */}
      <circle cx="28" cy="9.8" r="2.8" fill="var(--brand-profit)" />
    </svg>
  );
}
