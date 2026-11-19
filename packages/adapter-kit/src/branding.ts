import type { AdapterDescriptor } from "./types.js";

/**
 * White label plumbing (docs/partner-commerce.md, section 8). Product code owns the states and the
 * rules; adapters own the vendor API behind these two small interfaces.
 */

/** Where a custom hostname is: DNS not seen yet, hostname verified, certificate live, or stuck. */
export type CustomHostnameStatus = "pending" | "verified" | "active" | "failed";

export interface CustomHostname {
  /** The provider's id, kept to poll and delete. */
  id: string;
  hostname: string;
  status: CustomHostnameStatus;
  /** What the provider says is wrong, for a person to read; null when nothing is. */
  error: string | null;
}

/** Serves a partner's own hostname with a certificate the provider issues and renews. */
export interface DomainProvider {
  describe(): AdapterDescriptor<{ customHostnames: boolean }>;
  /** The hostname a partner points its CNAME at. */
  fallbackHostname(): string;
  /** Registers the hostname; safe to call again for a hostname the provider already holds. */
  create(hostname: string): Promise<CustomHostname>;
  /** Null when the provider no longer knows the id. */
  get(id: string): Promise<CustomHostname | null>;
  /** A hostname the provider does not have is not an error. */
  delete(id: string): Promise<void>;
}

export interface EmailDomainRecord {
  /** MX, TXT or CNAME. */
  type: string;
  name: string;
  value: string;
  /** The provider's own word for the record: "pending", "verified", "failed". */
  status: string;
}

export type EmailDomainStatus = "pending" | "verified" | "failed";

export interface EmailDomain {
  id: string;
  name: string;
  status: EmailDomainStatus;
  /** SPF, DKIM and return-path records the owner of the domain adds to its DNS. */
  records: EmailDomainRecord[];
}

/** Verifies a domain mail may be sent from, at the same service that sends it. */
export interface EmailDomainProvider {
  describe(): AdapterDescriptor<{ senderDomains: boolean }>;
  create(name: string): Promise<EmailDomain>;
  /** Asks the service to check the records now and returns where the domain stands. */
  verify(id: string): Promise<EmailDomain>;
  delete(id: string): Promise<void>;
}
