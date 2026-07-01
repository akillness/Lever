import Link from "next/link";

import { LeverMark } from "@/components/LeverMark";

/**
 * Branded 404 — the default Next.js not-found page is unstyled and anonymous;
 * a real service's users land here from stale links and typos, not just dev
 * mistakes, so it carries the same mark, ink, and voice as the rest of the
 * product instead of breaking the identity at the first wrong turn.
 */
export default function NotFound() {
  return (
    <>
      <div className="brand-accent-bar w-full" />
      <main className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col items-center justify-center px-6 py-10 text-center">
        <LeverMark className="h-10 w-10" />
        <h1
          className="mt-4 text-2xl font-black tracking-tight"
          style={{ color: "var(--brand-ink)" }}
        >
          404 — no such route
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          Lever only shows moves it can back with the math. This page doesn&apos;t exist —
          the link may be stale, or the URL was mistyped.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Back to the dashboard
        </Link>
      </main>
    </>
  );
}
