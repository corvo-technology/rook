import { describe, expect, it } from "vitest";
import {
  generatePartnerKey,
  hashPartnerKey,
  isPartnerTestKey,
  partnerKeyPrefix,
  partnerWebhookSecret,
  signPartnerWebhook,
  verifyPartnerKey,
} from "./partner-key.js";

describe("partner test keys", () => {
  it("is told from a live key by its prefix and verifies like one", () => {
    const test = generatePartnerKey({ test: true });
    expect(test.key.startsWith("cpk_test_")).toBe(true);
    expect(test.prefix.startsWith("cpk_test_")).toBe(true);
    expect(isPartnerTestKey(test.key)).toBe(true);
    expect(partnerKeyPrefix(test.key)).toBe(test.prefix);
    expect(verifyPartnerKey(test.key, test.hash)).toBe(true);
  });

  it("never makes a live key that looks like a test key", () => {
    for (let index = 0; index < 200; index += 1) {
      const live = generatePartnerKey();
      expect(live.key.startsWith("cpk_test_")).toBe(false);
      expect(isPartnerTestKey(live.key)).toBe(false);
    }
  });

  it("does not verify a test key against a live key's hash", () => {
    expect(
      verifyPartnerKey(generatePartnerKey({ test: true }).key, generatePartnerKey().hash),
    ).toBe(false);
  });
});

describe("partner keys", () => {
  it("makes a key that verifies against the hash it was stored as", () => {
    const { key, hash } = generatePartnerKey();
    expect(verifyPartnerKey(key, hash)).toBe(true);
  });

  it("never stores or returns the key inside its hash or prefix", () => {
    const { key, hash, prefix } = generatePartnerKey();
    expect(hash).not.toContain(key);
    expect(key).toContain(prefix);
    expect(prefix.length).toBeLessThan(key.length / 2);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("makes a different key every time", () => {
    const first = generatePartnerKey();
    const second = generatePartnerKey();
    expect(first.key).not.toBe(second.key);
    expect(first.prefix).not.toBe(second.prefix);
    expect(first.hash).not.toBe(second.hash);
  });

  it("hashes the same key to the same value", () => {
    const { key, hash } = generatePartnerKey();
    expect(hashPartnerKey(key)).toBe(hash);
  });

  it("refuses a wrong key, a key cut short, an empty key and a hash that is not a hash", () => {
    const { key, hash } = generatePartnerKey();
    const other = generatePartnerKey().key;
    expect(verifyPartnerKey(other, hash)).toBe(false);
    expect(verifyPartnerKey(key.slice(0, -1), hash)).toBe(false);
    expect(verifyPartnerKey(`${key}x`, hash)).toBe(false);
    expect(verifyPartnerKey("", hash)).toBe(false);
    expect(verifyPartnerKey(key, "")).toBe(false);
    expect(verifyPartnerKey(key, "not-a-hash")).toBe(false);
  });

  it("finds the prefix of a well-formed key, and nothing in anything else", () => {
    const { key, prefix } = generatePartnerKey();
    expect(partnerKeyPrefix(key)).toBe(prefix);
    expect(partnerKeyPrefix("")).toBeNull();
    expect(partnerKeyPrefix("Bearer nonsense")).toBeNull();
    expect(partnerKeyPrefix(`${"a".repeat(400)}`)).toBeNull();
  });
});

describe("partner webhook signing", () => {
  it("derives a stable secret per partner and version, from the deployment key", () => {
    const secret = partnerWebhookSecret("deployment-key", "partner-1", 0);
    expect(secret).toBe(partnerWebhookSecret("deployment-key", "partner-1", 0));
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(partnerWebhookSecret("deployment-key", "partner-2", 0)).not.toBe(secret);
    expect(partnerWebhookSecret("deployment-key", "partner-1", 1)).not.toBe(secret);
    expect(partnerWebhookSecret("other-key", "partner-1", 0)).not.toBe(secret);
  });

  it("signs the timestamp and body together so neither can be swapped", () => {
    const secret = partnerWebhookSecret("deployment-key", "partner-1", 0);
    const signature = signPartnerWebhook(secret, "1700000000", '{"a":1}');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signPartnerWebhook(secret, "1700000001", '{"a":1}')).not.toBe(signature);
    expect(signPartnerWebhook(secret, "1700000000", '{"a":2}')).not.toBe(signature);
  });
});
