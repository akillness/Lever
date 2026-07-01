import { NextResponse } from "next/server";
import { allConnectors, freeTierCatalog, getConnector } from "@/lib/channels";
import { DEFAULT_ACCOUNT_ID, getVault, isValidAccountId, vaultKey } from "@/lib/secrets";
import { isAdminAuthorized } from "@/lib/adminAuth";
import type { Channel } from "@/lib/types";

/**
 * Channel credential administration. Secrets are written into the encrypted
 * vault and NEVER read back over HTTP — GET reports only which channels are
 * configured plus the free-tier onboarding catalog.
 *
 * Multi-tenant: an optional `accountId` (query param on GET/DELETE, body
 * field on POST) scopes credentials to one ad account per {@link vaultKey}.
 * Omitted, it defaults to {@link DEFAULT_ACCOUNT_ID} — the original
 * single-tenant, unprefixed behavior is unchanged.
 *
 * Writes (POST/DELETE) are gated by LEVER_ADMIN_TOKEN via isAdminAuthorized:
 * callers must send a matching `x-lever-admin` header (compared in constant
 * time). With no token set, writes are open in dev but FAIL CLOSED in
 * production, so a forgotten token never silently exposes credential writes.
 */

function isChannel(value: unknown): value is Exclude<Channel, "other"> {
  return (
    value === "google" ||
    value === "meta" ||
    value === "taboola" ||
    value === "tiktok"
  );
}

/** Extract + validate `accountId` from a query string; null on an invalid value. */
function accountIdFromParams(params: URLSearchParams): string | null {
  const raw = params.get("accountId");
  if (raw == null) return DEFAULT_ACCOUNT_ID;
  return isValidAccountId(raw) ? raw : null;
}

/** GET ?accountId=... → onboarding catalog + per-channel configured flag (no secret values). */
export async function GET(request: Request) {
  const accountId = accountIdFromParams(new URL(request.url).searchParams);
  if (accountId === null) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }
  const vault = getVault();
  let stored: string[] = [];
  try {
    stored = await vault.list();
  } catch {
    stored = [];
  }
  // Scope the raw stored-key listing to this account only (never leak other
  // tenants' presence), stripping the namespace prefix for readability.
  const prefix = accountId === DEFAULT_ACCOUNT_ID ? "" : `${accountId}::`;
  stored =
    accountId === DEFAULT_ACCOUNT_ID
      ? stored.filter((k) => !k.includes("::"))
      : stored.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));

  const channels = await Promise.all(
    allConnectors().map(async (c) => {
      let configured = false;
      try {
        configured = c.isConfigured(await vault.get(vaultKey(c.channel, accountId)));
      } catch {
        configured = false;
      }
      return {
        channel: c.channel,
        configured,
        requiredCredentials: c.requiredCredentials,
        freeTier: c.freeTier,
      };
    }),
  );
  return NextResponse.json({ accountId, channels, catalog: freeTierCatalog(), stored });
}

/** POST { channel, credentials, accountId? } → seal credentials into the vault. */
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    channel?: unknown;
    credentials?: unknown;
    accountId?: unknown;
  } | null;
  if (!body || !isChannel(body.channel)) {
    return NextResponse.json({ error: "unknown channel" }, { status: 400 });
  }
  const accountId = body.accountId == null ? DEFAULT_ACCOUNT_ID : body.accountId;
  if (typeof accountId !== "string" || !isValidAccountId(accountId)) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }
  const creds = body.credentials;
  if (!creds || typeof creds !== "object" || Array.isArray(creds)) {
    return NextResponse.json({ error: "credentials object required" }, { status: 400 });
  }
  const connector = getConnector(body.channel);
  const value = creds as Record<string, unknown>;
  try {
    await getVault().set(vaultKey(body.channel, accountId), value);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to store credentials" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    channel: body.channel,
    accountId,
    configured: connector ? connector.isConfigured(value) : false,
  });
}

/** DELETE ?channel=...&accountId=... → remove stored credentials for a channel. */
export async function DELETE(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const channel = params.get("channel");
  if (!isChannel(channel)) {
    return NextResponse.json({ error: "unknown channel" }, { status: 400 });
  }
  const accountId = accountIdFromParams(params);
  if (accountId === null) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }
  const removed = await getVault().remove(vaultKey(channel, accountId));
  return NextResponse.json({ ok: true, channel, accountId, removed });
}
