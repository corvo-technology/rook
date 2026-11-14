import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ipVersion,
  isCloudMetadataHost,
  isInternalHostname,
  isNonPublicAddress,
  normalizeHost,
} from "@corvo/contracts/network-host";

/**
 * Managed residential egress for the agent browser. The operator sets one provider URL; every
 * cloud browser goes out through it, one sticky IP per bot. The provider URL (and its password)
 * lives only in the Rook server: a computer holds a per-bot capability for the Rook gateway.
 */

export const BROWSER_EGRESS_PATH = "/api/internal/browser-egress";
/** Header the gateway sets on a refusal, so the computer-side forwarder can tell why. */
export const BROWSER_EGRESS_ERROR_HEADER = "x-corvo-egress-error";
export const EGRESS_CREDITS_USED_UP = "EGRESS_CREDITS_USED_UP";
/** Re-minted every time the screen is ensured, so a short life keeps a leaked one of little use. */
export const BROWSER_EGRESS_CAPABILITY_TTL_MS = 12 * 60 * 60_000;

const SESSION_PLACEHOLDER = "{session}";
const SAFE_PROXY_TEXT = /^[\x21-\x7e]+$/;

export interface BrowserEgressConfig {
  /** The provider URL with `{session}` still in it. Never log it: it carries credentials. */
  readonly proxyUrl: string;
  readonly usdPerGb: number | undefined;
  /** Where computers reach the gateway, as an http(s) origin. */
  readonly gatewayOrigin: string;
}

/** What the gateway dials for one bot: the provider's host and the Basic credential. */
export interface EgressUpstream {
  readonly protocol: "http:" | "https:";
  readonly host: string;
  readonly port: number;
  readonly authorization: string | undefined;
}

/**
 * Reads and validates the egress settings. Errors name the variable and never repeat its value,
 * which holds the provider password. Undefined means egress is off.
 */
export function parseBrowserEgress(
  env: Record<string, string | undefined>,
): BrowserEgressConfig | undefined {
  const raw = env.BROWSER_EGRESS_PROXY_URL?.trim();
  if (!raw) return undefined;
  try {
    // Any bot id will do: this proves the template is a usable URL before the first connection.
    egressUpstream(raw, "validation");
  } catch (error) {
    throw new Error(
      `BROWSER_EGRESS_PROXY_URL must be an http or https proxy URL such as http://user-{session}:password@host:port (${error instanceof Error ? error.message : "invalid"}).`,
    );
  }
  const usdPerGb = parsePrice(env.BROWSER_EGRESS_USD_PER_GB);
  const gateway = (env.BROWSER_EGRESS_GATEWAY_URL ?? env.API_URL)?.trim();
  if (!gateway)
    throw new Error(
      "Set API_URL or BROWSER_EGRESS_GATEWAY_URL so computers can reach the gateway.",
    );
  let gatewayOrigin: string;
  try {
    const url = new URL(gateway);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    gatewayOrigin = url.origin;
  } catch {
    throw new Error("BROWSER_EGRESS_GATEWAY_URL (or API_URL) must be an http(s) URL.");
  }
  return { proxyUrl: raw, usdPerGb, gatewayOrigin };
}

function parsePrice(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000)
    throw new Error("BROWSER_EGRESS_USD_PER_GB must be a positive number of dollars per GB.");
  return price;
}

/** A stable, provider-safe id per bot: the same bot keeps its IP, no two bots share one. */
export function egressSessionId(botId: string): string {
  return createHash("sha256").update(`browser-egress:${botId}`).digest("hex").slice(0, 16);
}

/** The provider endpoint for one bot, with `{session}` replaced by that bot's sticky id. */
export function egressUpstream(template: string, botId: string): EgressUpstream {
  const url = new URL(template.replaceAll(SESSION_PLACEHOLDER, egressSessionId(botId)));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported scheme");
  if (!url.hostname) throw new Error("missing host");
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if ((user && !SAFE_PROXY_TEXT.test(user)) || (password && !SAFE_PROXY_TEXT.test(password)))
    throw new Error("unsupported credential characters");
  return {
    protocol: url.protocol,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
    authorization:
      user || password
        ? `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
        : undefined,
  };
}

export interface EgressScope {
  spaceId: string;
  botId: string;
}

/** HMAC key for capabilities, derived so the deployment's master secret is never used directly. */
export function egressCapabilityKey(masterSecret: string): Buffer {
  return createHmac("sha256", masterSecret).update("corvo:browser-egress:v1").digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** `v1.<scope and expiry>.<mac>`. Names one bot and nothing else; it carries no provider data. */
export function sealEgressCapability(
  key: Buffer,
  scope: EgressScope,
  now = Date.now(),
  ttlMs = BROWSER_EGRESS_CAPABILITY_TTL_MS,
): string {
  const payload = Buffer.from(
    JSON.stringify({ s: scope.spaceId, b: scope.botId, e: now + ttlMs }),
  ).toString("base64url");
  return `v1.${payload}.${sign(key, `v1.${payload}`)}`;
}

export function openEgressCapability(
  key: Buffer,
  capability: string | undefined,
  now = Date.now(),
): EgressScope | undefined {
  const parts = capability?.split(".");
  if (!parts || parts.length !== 3 || parts[0] !== "v1") return undefined;
  const [, payload, mac] = parts as [string, string, string];
  const expected = Buffer.from(sign(key, `v1.${payload}`));
  const supplied = Buffer.from(mac);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      s?: unknown;
      b?: unknown;
      e?: unknown;
    };
    if (
      typeof body.s !== "string" ||
      typeof body.b !== "string" ||
      typeof body.e !== "number" ||
      body.e <= now
    )
      return undefined;
    return { spaceId: body.s, botId: body.b };
  } catch {
    return undefined;
  }
}

/** Mail, remote login, file sharing, remote desktop and database ports: abuse, not browsing. */
const REFUSED_PORTS = new Set([
  21, 22, 23, 25, 53, 110, 119, 135, 137, 138, 139, 143, 389, 445, 465, 514, 587, 636, 993, 995,
  1433, 1521, 2049, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017,
]);

/**
 * Why a browser may not tunnel to this destination, or undefined when it may. The provider does
 * the DNS, so only what can be judged without it is judged here: addresses that are not public,
 * internal names, and ports used for abuse.
 */
export function refusedEgressDestination(host: string, port: number): string | undefined {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "invalid port";
  if (REFUSED_PORTS.has(port)) return "port not allowed";
  const name = normalizeHost(host);
  if (!name || /[\s/@?#\\]/.test(name)) return "invalid host";
  if (isInternalHostname(name) || isCloudMetadataHost(name)) return "internal host";
  if (ipVersion(name) !== 0 && isNonPublicAddress(name)) return "private address";
  // 0x7f.1, 2130706433 and friends are IP literals to a resolver but not to ipVersion.
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(name) && ipVersion(name) === 0)
    return "private address";
  return undefined;
}

/** What a computer needs to send one bot's browser through the gateway. */
export type BrowserEgressGrant = { gateway: string; capability: string };

export interface BrowserEgressMinter {
  grant(scope: EgressScope, now?: number): BrowserEgressGrant;
}

/** Mints bot capabilities from the deployment env, or undefined when egress is off. */
export function browserEgressMinter(
  env: Record<string, string | undefined>,
  masterSecret: () => string,
): BrowserEgressMinter | undefined {
  const config = parseBrowserEgress(env);
  if (!config) return undefined;
  const gateway = `${config.gatewayOrigin.replace(/^http/, "ws")}${BROWSER_EGRESS_PATH}`;
  const key = egressCapabilityKey(masterSecret());
  return {
    grant: (scope, now) => ({ gateway, capability: sealEgressCapability(key, scope, now) }),
  };
}
