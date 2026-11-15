import { lookup } from "node:dns/promises";
import {
  ipVersion,
  isCloudMetadataAddress,
  isCloudMetadataHost,
  isLinkLocalAddress,
  isNonPublicAddress,
  normalizeHost,
} from "@corvo/contracts";
import type { ResolvedAddress, ResolveHostname } from "./network-address.js";
import { egressRefused } from "./network-address.js";
import { isPrivateRemoteMcpHostname } from "./remote-mcp.js";

export interface MailHostPolicy {
  /** Deployment-owner escape for a mail server on the same machine or LAN. Default off. */
  allowPrivateEndpoint?: boolean;
  resolveHostname?: ResolveHostname;
}

const defaultResolve: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

/**
 * Resolves a mail server's host to the one address the connection will use, or refuses it. On the
 * cloud, private, loopback, link-local and metadata addresses are refused, so an agent's owner
 * cannot point a mailbox at the server's own network. Connecting to the returned address, not to
 * the name, keeps a second DNS answer from changing where the connection goes.
 */
export async function resolveMailHost(
  host: string,
  policy: MailHostPolicy = {},
): Promise<ResolvedAddress> {
  const hostname = normalizeHost(host.trim());
  const literal = ipVersion(hostname);
  if (!literal && !HOSTNAME.test(hostname)) throw new Error("Mail server host is invalid");
  if (isCloudMetadataHost(hostname)) {
    throw egressRefused(hostname, new Error("Mail server host is a private address"));
  }
  const allowPrivate = policy.allowPrivateEndpoint === true;
  if (!allowPrivate && isPrivateRemoteMcpHostname(hostname)) {
    throw egressRefused(hostname, new Error("Mail server host is a private address"));
  }
  const addresses: ResolvedAddress[] = literal
    ? [{ address: hostname, family: literal }]
    : await (policy.resolveHostname ?? defaultResolve)(hostname);
  const first = addresses[0];
  const refuse = (reason: string) => egressRefused(hostname, new Error(reason));
  if (!first) throw new Error("Mail server host did not resolve");
  for (const entry of addresses) {
    if (isCloudMetadataAddress(entry.address) || isLinkLocalAddress(entry.address)) {
      throw refuse("Mail server host resolves to a private address");
    }
    if (!allowPrivate && isNonPublicAddress(entry.address)) {
      throw refuse("Mail server host resolves to a private address");
    }
  }
  return first;
}
