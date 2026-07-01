import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "./route";
import { resetVaultCache } from "@/lib/secrets";

const savedSecret = process.env.LEVER_SECRET_KEY;
const savedAdmin = process.env.LEVER_ADMIN_TOKEN;

beforeEach(() => {
  // In-memory vault (writable) for the route under test.
  delete process.env.LEVER_SECRET_KEY;
  delete process.env.LEVER_ADMIN_TOKEN;
  resetVaultCache();
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.LEVER_SECRET_KEY;
  else process.env.LEVER_SECRET_KEY = savedSecret;
  if (savedAdmin === undefined) delete process.env.LEVER_ADMIN_TOKEN;
  else process.env.LEVER_ADMIN_TOKEN = savedAdmin;
  resetVaultCache();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const get = (query = "") => GET(new Request(`http://localhost/api/credentials${query}`));


describe("GET /api/credentials", () => {
  it("returns the onboarding catalog with no channel configured initially", async () => {
    const res = await (await get()).json();
    expect(res.channels).toHaveLength(4);
    expect(res.channels.every((c: { configured: boolean }) => c.configured === false)).toBe(true);
    const google = res.channels.find((c: { channel: string }) => c.channel === "google");
    expect(google.requiredCredentials).toContain("developerToken");
    expect(google.freeTier.docsUrl).toMatch(/^https:\/\//);
  });

  it("never returns secret values, only configured flags", async () => {
    await post({ channel: "meta", credentials: { accountId: "act_1", accessToken: "SECRET" } });
    const text = JSON.stringify(await (await get()).json());
    expect(text).not.toContain("SECRET");
  });
});

describe("POST /api/credentials", () => {
  it("stores credentials and reports configured per the connector", async () => {
    const res = await (
      await post({ channel: "google", credentials: { customerId: "1", developerToken: "d", accessToken: "a" } })
    ).json();
    expect(res).toMatchObject({ ok: true, channel: "google", configured: true });
    const got = await (await get()).json();
    expect(got.channels.find((c: { channel: string }) => c.channel === "google").configured).toBe(true);
  });

  it("marks configured=false when required fields are missing", async () => {
    const res = await (
      await post({ channel: "tiktok", credentials: { advertiserId: "1" } })
    ).json();
    expect(res.configured).toBe(false);
  });

  it("rejects an unknown channel or non-object credentials", async () => {
    expect((await post({ channel: "bogus", credentials: {} })).status).toBe(400);
    expect((await post({ channel: "meta", credentials: "nope" })).status).toBe(400);
  });

  it("enforces LEVER_ADMIN_TOKEN when set", async () => {
    process.env.LEVER_ADMIN_TOKEN = "s3cret";
    resetVaultCache();
    const denied = await post({ channel: "meta", credentials: { accountId: "a", accessToken: "b" } });
    expect(denied.status).toBe(401);
    const ok = await post(
      { channel: "meta", credentials: { accountId: "a", accessToken: "b" } },
      { "x-lever-admin": "s3cret" },
    );
    expect(ok.status).toBe(200);
  });

  it("fails closed in production when no admin token is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LEVER_ADMIN_TOKEN;
    resetVaultCache();
    try {
      const denied = await post({ channel: "meta", credentials: { accountId: "a", accessToken: "b" } });
      expect(denied.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("multi-tenant accountId", () => {
  it("keeps two accounts' credentials for the same channel independent", async () => {
    await post({
      channel: "meta",
      accountId: "tenant-a",
      credentials: { accountId: "act_1", accessToken: "tok-a" },
    });
    const tenantA = await (await get("?accountId=tenant-a")).json();
    const tenantB = await (await get("?accountId=tenant-b")).json();
    const defaultAcct = await (await get()).json();
    expect(tenantA.channels.find((c: { channel: string }) => c.channel === "meta").configured).toBe(true);
    expect(tenantB.channels.find((c: { channel: string }) => c.channel === "meta").configured).toBe(false);
    expect(defaultAcct.channels.find((c: { channel: string }) => c.channel === "meta").configured).toBe(false);
  });

  it("DELETE only removes the named account's credentials, not another tenant's", async () => {
    await post({
      channel: "meta",
      accountId: "tenant-a",
      credentials: { accountId: "act_1", accessToken: "tok-a" },
    });
    await post({
      channel: "meta",
      accountId: "tenant-b",
      credentials: { accountId: "act_2", accessToken: "tok-b" },
    });
    await DELETE(
      new Request("http://localhost/api/credentials?channel=meta&accountId=tenant-a", {
        method: "DELETE",
      }),
    );
    const tenantA = await (await get("?accountId=tenant-a")).json();
    const tenantB = await (await get("?accountId=tenant-b")).json();
    expect(tenantA.channels.find((c: { channel: string }) => c.channel === "meta").configured).toBe(false);
    expect(tenantB.channels.find((c: { channel: string }) => c.channel === "meta").configured).toBe(true);
  });

  it("rejects an invalid accountId on GET, POST, and DELETE", async () => {
    expect((await get("?accountId=has:colon")).status).toBe(400);
    expect(
      (await post({ channel: "meta", accountId: "has:colon", credentials: { a: 1 } })).status,
    ).toBe(400);
    expect(
      (
        await DELETE(
          new Request("http://localhost/api/credentials?channel=meta&accountId=has:colon", {
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(400);
  });
});


describe("DELETE /api/credentials", () => {
  it("removes stored credentials for a channel", async () => {
    await post({ channel: "meta", credentials: { accountId: "a", accessToken: "b" } });
    const res = await (
      await DELETE(new Request("http://localhost/api/credentials?channel=meta", { method: "DELETE" }))
    ).json();
    expect(res).toMatchObject({ ok: true, channel: "meta", removed: true });
    const got = await (await get()).json();
    expect(got.channels.find((c: { channel: string }) => c.channel === "meta").configured).toBe(false);
  });
});
