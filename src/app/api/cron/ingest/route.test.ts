import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resetVaultCache } from "@/lib/secrets";
import { resetStorageCache } from "@/lib/storage";

const saved = {
  LEVER_SECRET_KEY: process.env.LEVER_SECRET_KEY,
  LEVER_DB_PATH: process.env.LEVER_DB_PATH,
  LEVER_SHEETS_WEBHOOK_URL: process.env.LEVER_SHEETS_WEBHOOK_URL,
  LEVER_CRON_SECRET: process.env.LEVER_CRON_SECRET,
};

beforeEach(() => {
  for (const k of Object.keys(saved)) delete process.env[k];
  resetVaultCache();
  resetStorageCache();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetVaultCache();
  resetStorageCache();
});

const get = (path = "/api/cron/ingest", headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost${path}`, { headers }));

describe("GET /api/cron/ingest", () => {
  it("runs the pipeline over a default 2-day trailing window when unconfigured", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.round(
      (Date.parse(body.range.end) - Date.parse(body.range.start)) / oneDayMs,
    );
    expect(spanDays).toBe(2);
    expect(body.ingest.rows).toBe(0);
    expect(body.datasetId).toBeNull();
  });

  it("clamps an oversized ?days= override to the max window", async () => {
    const res = await get("/api/cron/ingest?days=99999");
    const body = await res.json();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.round(
      (Date.parse(body.range.end) - Date.parse(body.range.start)) / oneDayMs,
    );
    expect(spanDays).toBe(90);
  });

  it("ignores a non-numeric ?days= override and falls back to the default", async () => {
    const res = await get("/api/cron/ingest?days=not-a-number");
    const body = await res.json();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.round(
      (Date.parse(body.range.end) - Date.parse(body.range.start)) / oneDayMs,
    );
    expect(spanDays).toBe(2);
  });

  it("enforces LEVER_CRON_SECRET as a Bearer token when set", async () => {
    process.env.LEVER_CRON_SECRET = "cron-s3cret";
    const denied = await get();
    expect(denied.status).toBe(401);
    const ok = await get("/api/cron/ingest", { authorization: "Bearer cron-s3cret" });
    expect(ok.status).toBe(200);
    const wrong = await get("/api/cron/ingest", { authorization: "Bearer nope" });
    expect(wrong.status).toBe(401);
  });

  it("fails closed in production when no cron secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LEVER_CRON_SECRET;
    try {
      const denied = await get();
      expect(denied.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
