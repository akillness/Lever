"use client";

import { useEffect } from "react";

import { LeverMark } from "@/components/LeverMark";

/**
 * Branded error boundary — Next.js requires this to be a client component and
 * to accept `{ error, reset }`. A production render crash still needs to look
 * like *this* product, not a stack trace: the message is deliberately generic
 * (never echoes `error.message` to the visitor — it may carry upload contents,
 * connector responses, or other data we don't control) while `reset()` gives a
 * real recovery path instead of forcing a full reload. The underlying error is
 * still logged to the console for whoever's debugging the deploy.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Lever render error:", error);
  }, [error]);

  return (
    <>
      <div className="brand-accent-bar w-full" />
      <main className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col items-center justify-center px-6 py-10 text-center">
        <LeverMark className="h-10 w-10" />
        <h1
          className="mt-4 text-2xl font-black tracking-tight"
          style={{ color: "var(--brand-ink)" }}
        >
          Something didn&apos;t compute
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          Lever hit an unexpected error rendering this page. Nothing was sent or saved
          — retry, or reload if it keeps happening.
          {error.digest && (
            <>
              {" "}
              <span className="text-slate-400">(ref {error.digest})</span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Try again
        </button>
      </main>
    </>
  );
}
