import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX = "cpk_";
const PREFIX_BYTES = 6;
const SECRET_BYTES = 32;
const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = /^cpk_[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/;

/**
 * A partner key is `cpk_<prefix>.<secret>`. The prefix finds the partner without revealing the key;
 * only the prefix and a hash of the whole key are ever stored. The secret is random and long, so a
 * fast hash is enough: there is nothing to guess.
 */
export function generatePartnerKey(): { key: string; prefix: string; hash: string } {
  const prefix = `${KEY_PREFIX}${randomBytes(PREFIX_BYTES).toString("base64url")}`;
  const key = `${prefix}.${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { key, prefix, hash: hashPartnerKey(key) };
}

export function hashPartnerKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The lookup prefix of a well-formed key, or null for anything else. */
export function partnerKeyPrefix(key: string): string | null {
  if (key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) return null;
  return key.slice(0, key.indexOf("."));
}

/** Constant time, and false for anything that is not a key or not a stored hash. */
export function verifyPartnerKey(key: string, storedHash: string): boolean {
  if (partnerKeyPrefix(key) === null || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashPartnerKey(key), "hex"), Buffer.from(storedHash, "hex"));
}

/**
 * The secret that signs a partner's webhook. It is derived from the deployment's encryption key, so
 * the database holds nothing that could forge a notice; raising `version` replaces it.
 */
export function partnerWebhookSecret(
  encryptionKey: string,
  partnerId: string,
  version: number,
): string {
  const mac = createHmac("sha256", encryptionKey)
    .update(`corvo/partner-webhook/v1\0${partnerId}\0${version}`)
    .digest("base64url");
  return `whsec_${mac}`;
}

/** The value of the `X-Rook-Signature` header: `sha256=` and the hex HMAC of `<timestamp>.<body>`. */
export function signPartnerWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
