import { timingSafeEqual } from "node:crypto";

/**
 * Auth gate for the scheduled ingest endpoint (`/api/cron/ingest`). Vercel
 * Cron Jobs authenticate scheduled invocations by sending
 * `Authorization: Bearer <CRON_SECRET>` when a secret is configured — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * The bearer token is compared against `LEVER_CRON_SECRET` in constant time.
 *
 * With no secret configured, the endpoint is open in dev (so `curl` during
 * local development just works) but FAILS CLOSED in production, so a
 * forgotten secret never leaves a schedulable, unauthenticated data-pull
 * endpoint reachable by anyone who finds the URL.
 */
export function isCronAuthorized(request: Request): boolean {
  const expected = process.env.LEVER_CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
