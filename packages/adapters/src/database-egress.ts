import { lookup } from "node:dns/promises";
import {
  ipVersion,
  isCloudMetadataAddress,
  isCloudMetadataHost,
  isNonPublicAddress,
  normalizeHost,
} from "@corvo/contracts";
import type { ResolveHostname } from "./network-address.js";
import { egressRefused } from "./network-address.js";

const defaultResolve: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export interface DatabaseEgressPolicy {
  /** The deployment lets agents reach private and loopback addresses (self-hosted, desktop). */
  allowPrivate: boolean;
  resolveHostname?: ResolveHostname;
}

/**
 * Resolve a database host once and return the address to connect to. The caller connects to
 * that address, never to the name again, so a name that answers differently a moment later
 * cannot reach a place this check refused. Cloud metadata addresses are refused even where
 * private networks are allowed.
 */
export async function resolveDatabaseAddress(
  host: string,
  policy: DatabaseEgressPolicy,
): Promise<string> {
  const hostname = normalizeHost(host);
  const refuse = (reason: string) => egressRefused(hostname, new Error(reason));
  if (!hostname) throw refuse("Database host is empty");
  if (isCloudMetadataHost(hostname)) throw refuse("Database host is not reachable");
  const literal = ipVersion(hostname) !== 0;
  const addresses = literal
    ? [{ address: hostname, family: ipVersion(hostname) }]
    : await (policy.resolveHostname ?? defaultResolve)(hostname);
  if (addresses.length === 0) throw new Error("Database host did not resolve");
  for (const entry of addresses) {
    if (isCloudMetadataAddress(entry.address)) throw refuse("Database host is not reachable");
    if (!policy.allowPrivate && isNonPublicAddress(entry.address)) {
      throw refuse("Database host is a private address");
    }
  }
  // A name that resolves to both is refused above whenever any address is private and
  // private access is off, so the first address is as safe as the rest.
  return addresses[0]!.address;
}
