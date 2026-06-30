import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileCredentialVault,
  InMemoryCredentialVault,
  decryptSecret,
  encryptSecret,
  getVault,
  hasVaultSecret,
  resetVaultCache,
  vaultPath,
} from "./secrets";

const KEY = "test-master-key-1234";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a UTF-8 payload", () => {
    const env = encryptSecret("hello 안녕 🔐", KEY);
    expect(decryptSecret(env, KEY)).toBe("hello 안녕 🔐");
  });

  it("produces different ciphertext each call (random salt+iv)", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("never leaks plaintext into the envelope", () => {
    const env = encryptSecret("super-secret-token", KEY);
    expect(env).not.toContain("super-secret-token");
    expect(Buffer.from(env, "base64").toString("utf8")).not.toContain("token");
  });

  it("fails with the wrong key", () => {
    const env = encryptSecret("payload", KEY);
    expect(() => decryptSecret(env, "wrong-key-abcdef")).toThrow(/wrong key/);
  });

  it("detects tampered ciphertext via the GCM auth tag", () => {
    const env = encryptSecret("payload", KEY);
    const buf = Buffer.from(env, "base64");
    buf[buf.length - 1] ^= 0xff; // flip the last ciphertext byte
    expect(() => decryptSecret(buf.toString("base64"), KEY)).toThrow(
      /wrong key or tampered/,
    );
  });

  it("rejects a truncated envelope", () => {
    expect(() => decryptSecret("YWJj", KEY)).toThrow(/truncated or corrupt/);
  });

  it("requires a non-trivial master secret", () => {
    expect(() => encryptSecret("x", "short")).toThrow(/LEVER_SECRET_KEY/);
    expect(() => encryptSecret("x", "")).toThrow(/LEVER_SECRET_KEY/);
  });
});

describe("InMemoryCredentialVault", () => {
  it("round-trips a credential object", async () => {
    const v = new InMemoryCredentialVault(KEY);
    await v.set("google", { clientId: "abc", token: "xyz" });
    expect(await v.get("google")).toEqual({ clientId: "abc", token: "xyz" });
  });

  it("returns null for an unknown name and removes existing", async () => {
    const v = new InMemoryCredentialVault(KEY);
    expect(await v.get("nope")).toBeNull();
    await v.set("meta", { a: 1 });
    expect(await v.remove("meta")).toBe(true);
    expect(await v.remove("meta")).toBe(false);
    expect(await v.get("meta")).toBeNull();
  });

  it("lists names sorted", async () => {
    const v = new InMemoryCredentialVault(KEY);
    await v.set("tiktok", { a: 1 });
    await v.set("google", { a: 1 });
    expect(await v.list()).toEqual(["google", "tiktok"]);
  });
});

describe("FileCredentialVault", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lever-vault-"));
    path = join(dir, "creds.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists encrypted across separate instances", async () => {
    const writer = new FileCredentialVault(path, KEY);
    await writer.set("taboola", { apiKey: "tb-secret-key" });
    const reader = new FileCredentialVault(path, KEY);
    expect(await reader.get("taboola")).toEqual({ apiKey: "tb-secret-key" });
  });

  it("writes only ciphertext to disk", async () => {
    const v = new FileCredentialVault(path, KEY);
    await v.set("meta", { accessToken: "fb-plaintext-token" });
    const onDisk = await readFile(path, "utf8");
    expect(onDisk).not.toContain("fb-plaintext-token");
    expect(onDisk).not.toContain("accessToken");
  });

  it("a different master secret cannot read the file", async () => {
    await new FileCredentialVault(path, KEY).set("google", { t: "secret" });
    const intruder = new FileCredentialVault(path, "another-master-key-99");
    await expect(intruder.get("google")).rejects.toThrow(/wrong key/);
  });
});

describe("vault selection", () => {
  const saved = {
    LEVER_SECRET_KEY: process.env.LEVER_SECRET_KEY,
    LEVER_VAULT_PATH: process.env.LEVER_VAULT_PATH,
  };
  afterEach(() => {
    for (const [k, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
    resetVaultCache();
  });

  it("uses in-memory when no secret is set", () => {
    delete process.env.LEVER_SECRET_KEY;
    resetVaultCache();
    expect(hasVaultSecret()).toBe(false);
    expect(getVault()).toBeInstanceOf(InMemoryCredentialVault);
  });

  it("uses the file vault when a secret is configured", () => {
    process.env.LEVER_SECRET_KEY = "configured-master-key";
    resetVaultCache();
    expect(hasVaultSecret()).toBe(true);
    expect(getVault()).toBeInstanceOf(FileCredentialVault);
  });

  it("honors LEVER_VAULT_PATH override", () => {
    process.env.LEVER_VAULT_PATH = "/tmp/custom/creds.json";
    expect(vaultPath()).toBe("/tmp/custom/creds.json");
  });

  it("warns in production when falling back to the in-memory vault", () => {
    const savedEnv = process.env.NODE_ENV;
    delete process.env.LEVER_SECRET_KEY;
    process.env.NODE_ENV = "production";
    resetVaultCache();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(getVault()).toBeInstanceOf(InMemoryCredentialVault);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/LEVER_SECRET_KEY/);
    } finally {
      warn.mockRestore();
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
      resetVaultCache();
    }
  });

  it("stays silent outside production when falling back", () => {
    const savedEnv = process.env.NODE_ENV;
    delete process.env.LEVER_SECRET_KEY;
    process.env.NODE_ENV = "test";
    resetVaultCache();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      getVault();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
      resetVaultCache();
    }
  });
});
