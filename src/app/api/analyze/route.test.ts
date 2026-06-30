import { describe, expect, it } from "vitest";
import { POST, GET } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const subTargetRow = {
  id: "x",
  name: "SubTarget",
  channel: "google",
  spend: 1000,
  revenue: 1200,
  conversions: 40,
  clicks: 2000,
  impressions: 40000,
};

describe("POST /api/analyze", () => {
  it("honors a config override so REVIEW is reachable server-side / by an agent", async () => {
    const def = await (await post({ rows: [subTargetRow] })).json();
    expect(def.recommendations[0].action).toBe("KEEP"); // default target 1.0

    const tuned = await (
      await post({ rows: [subTargetRow], config: { targetRoas: 1.5 } })
    ).json();
    expect(tuned.recommendations[0].action).toBe("REVIEW");
    expect(tuned.recommendations[0].rationale).toMatch(/below target/i);
  });

  it("ignores non-numeric / negative config knobs (falls back to defaults)", async () => {
    const res = await (
      await post({
        rows: [subTargetRow],
        config: { targetRoas: "huge", scaleStep: -1 },
      })
    ).json();
    // bad overrides dropped → default target 1.0 → KEEP, not a crash
    expect(res.recommendations[0].action).toBe("KEEP");
    expect(res.totals.spend).toBe(1000);
  });

  it("falls back to the seeded dataset on an empty/malformed body", async () => {
    const res = await (await post({})).json();
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.totals.spend).toBeGreaterThan(0);
  });

  it("surfaces a 502 (never a false success) when persistence is asked for but fails", async () => {
    // Force the Firestore adapter with bogus creds so saveDataset rejects.
    const env = process.env;
    process.env = {
      ...env,
      FIREBASE_PROJECT_ID: "bogus",
      FIREBASE_CLIENT_EMAIL: "bogus@example.com",
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nbad\\n-----END PRIVATE KEY-----\\n",
    };
    const { resetStorageCache } = await import("@/lib/storage");
    resetStorageCache();
    try {
      const res = await post({ rows: [subTargetRow], persist: true });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.persisted).toBe(false);
      expect(body.error).toBeTruthy();
    } finally {
      process.env = env;
      resetStorageCache();
    }
  });
});

describe("GET /api/analyze", () => {
  it("returns an analysis of the seeded dataset", async () => {
    const res = await (await GET()).json();
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.accountHealth).toBeGreaterThanOrEqual(0);
    expect(res.accountHealth).toBeLessThanOrEqual(100);
  });
});
