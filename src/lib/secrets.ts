/**
 * Encrypted credential vault for Lever.
 *
 * Ad-platform API credentials are secrets. They are NEVER written to disk in
 * plaintext: every value is sealed with AES-256-GCM under a key derived from
 * `LEVER_SECRET_KEY` via scrypt, with a random per-record salt + IV and a GCM
 * auth tag so any tampering or wrong key is detected at decrypt time. The
 * plaintext exists only transiently in memory while a request uses it.
 *
 * Envelope layout (base64): salt(16) | iv(12) | tag(16) | ciphertext.
 *
 * Server-only: imports node:crypto / node:fs. Never import from client code.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ALGO = "aes-256-gcm";
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

/** Resolve the master secret, failing loudly rather than encrypting with "". */
function requireSecret(secret?: string): string {
  const s = secret ?? process.env.LEVER_SECRET_KEY;
  if (!s || s.length < 8) {
    throw new Error(
      "LEVER_SECRET_KEY must be set (>= 8 chars) to encrypt/decrypt credentials",
    );
  }
  return s;
}

/** A random per-process key so the in-memory demo vault works with zero config. */
function ephemeralSecret(): string {
  return randomBytes(24).toString("hex");
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  // scrypt is intentionally slow → resists brute-forcing the master secret.
  return scryptSync(secret, salt, KEY_LEN);
}

/** Seal a UTF-8 string into a self-describing base64 envelope. */
export function encryptSecret(plaintext: string, secret?: string): string {
  const key0 = requireSecret(secret);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(key0, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString("base64");
}

/** Open a base64 envelope; throws on wrong key, truncation, or tampering. */
export function decryptSecret(envelope: string, secret?: string): string {
  const key0 = requireSecret(secret);
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error("ciphertext is truncated or corrupt");
  }
  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ct = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = deriveKey(key0, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error("decryption failed: wrong key or tampered ciphertext");
  }
}

/** A named secret store. Values are arbitrary JSON-serializable objects. */
export interface CredentialVault {
  set(name: string, value: Record<string, unknown>): Promise<void>;
  get(name: string): Promise<Record<string, unknown> | null>;
  list(): Promise<string[]>;
  remove(name: string): Promise<boolean>;
}

/** On-disk map of name → encrypted envelope. The keys are not secret; values are. */
type EnvelopeMap = Record<string, string>;

/**
 * File-backed vault. The JSON file holds only ciphertext envelopes, so it is
 * safe at rest without the master secret. Reads/writes are whole-file (the
 * credential set is tiny), keeping the format trivially inspectable.
 */
export class FileCredentialVault implements CredentialVault {
  constructor(
    private readonly path: string,
    private readonly secret?: string,
  ) {}

  private async load(): Promise<EnvelopeMap> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as EnvelopeMap) : {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private async save(map: EnvelopeMap): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(map, null, 2), { mode: 0o600 });
  }

  async set(name: string, value: Record<string, unknown>): Promise<void> {
    const map = await this.load();
    map[name] = encryptSecret(JSON.stringify(value), this.secret);
    await this.save(map);
  }

  async get(name: string): Promise<Record<string, unknown> | null> {
    const map = await this.load();
    const env = map[name];
    if (!env) return null;
    return JSON.parse(decryptSecret(env, this.secret)) as Record<string, unknown>;
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.load()).sort();
  }

  async remove(name: string): Promise<boolean> {
    const map = await this.load();
    if (!(name in map)) return false;
    delete map[name];
    await this.save(map);
    return true;
  }
}

/**
 * In-memory vault for tests and the zero-config demo. Values are still sealed
 * (under a random per-process key when none is supplied), so the same
 * encrypt/decrypt path and tamper detection are exercised.
 */
export class InMemoryCredentialVault implements CredentialVault {
  private map: EnvelopeMap = {};
  private readonly secret: string;
  constructor(secret?: string) {
    this.secret = secret ?? ephemeralSecret();
  }

  async set(name: string, value: Record<string, unknown>): Promise<void> {
    this.map[name] = encryptSecret(JSON.stringify(value), this.secret);
  }
  async get(name: string): Promise<Record<string, unknown> | null> {
    const env = this.map[name];
    return env
      ? (JSON.parse(decryptSecret(env, this.secret)) as Record<string, unknown>)
      : null;
  }
  async list(): Promise<string[]> {
    return Object.keys(this.map).sort();
  }
  async remove(name: string): Promise<boolean> {
    if (!(name in this.map)) return false;
    delete this.map[name];
    return true;
  }
}

/** True when a master secret is available to operate a real (file) vault. */
export function hasVaultSecret(): boolean {
  const s = process.env.LEVER_SECRET_KEY;
  return Boolean(s && s.length >= 8);
}

/**
 * Multi-tenant support: one Lever deployment (one vault) can hold credentials
 * for several ad accounts. `DEFAULT_ACCOUNT_ID` is the implicit, unprefixed
 * account so the zero-config single-tenant path (existing deployments,
 * stored vault files, and tests) is completely unaffected — only a caller
 * that explicitly passes a different `accountId` gets namespaced.
 */
export const DEFAULT_ACCOUNT_ID = "default";

/** 1-64 chars of letters/digits/`-`/`_` — no `:` so it can't collide with the namespace separator. */
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** True when a caller-supplied account id is safe to use as a vault-key namespace. */
export function isValidAccountId(id: string): boolean {
  return id === DEFAULT_ACCOUNT_ID || ACCOUNT_ID_RE.test(id);
}

/**
 * Vault key for a channel's credentials, namespaced by account. The default
 * account uses the bare channel name (unprefixed); any other account id is
 * namespaced as `${accountId}::${channel}` so two tenants' credentials for
 * the same channel never collide in the same vault/file.
 */
export function vaultKey(channel: string, accountId: string = DEFAULT_ACCOUNT_ID): string {
  return accountId === DEFAULT_ACCOUNT_ID ? channel : `${accountId}::${channel}`;
}

/**
 * Default vault path. Lives under `.lever/` (git-ignored) next to the project
 * unless `LEVER_VAULT_PATH` overrides it.
 */
export function vaultPath(): string {
  return process.env.LEVER_VAULT_PATH || ".lever/credentials.enc.json";
}

let cached: CredentialVault | null = null;

/**
 * Select the vault: file-backed when a master secret is configured, in-memory
 * otherwise. Memoized per process.
 *
 * In production without `LEVER_SECRET_KEY` we fall back to the in-memory vault
 * but emit a loud warning: its key is per-process, so stored credentials neither
 * persist across restarts nor across serverless instances. Set the secret to
 * operate the durable file vault.
 */
export function getVault(): CredentialVault {
  if (!cached) {
    if (hasVaultSecret()) {
      cached = new FileCredentialVault(vaultPath());
    } else {
      if (process.env.NODE_ENV === "production") {
        console.warn(
          "[lever] LEVER_SECRET_KEY is not set in production: using an ephemeral " +
            "in-memory credential vault. Stored credentials will NOT persist across " +
            "restarts or serverless instances. Set LEVER_SECRET_KEY for durable storage.",
        );
      }
      cached = new InMemoryCredentialVault();
    }
  }
  return cached;
}

/** Test/maintenance hook: drop the memoized vault. */
export function resetVaultCache(): void {
  cached = null;
}
