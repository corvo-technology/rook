import type { CustomHostname, CustomHostnameStatus, DomainProvider } from "@corvo/adapter-kit";

const API = "https://api.cloudflare.com/client/v4";

interface CloudflareConfig {
  zoneId: string;
  apiToken: string;
  /** The hostname partners point their CNAME at; it must be the zone's fallback origin. */
  fallbackOrigin: string;
  /** Another API base, for a compatible service or a test. */
  endpoint?: string;
}

interface Dependencies {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface CustomHostnameResult {
  id?: string;
  hostname?: string;
  status?: string;
  verification_errors?: string[];
  ssl?: { status?: string; validation_errors?: Array<{ message?: string }> };
}

const FAILED_HOSTNAME = new Set([
  "moved",
  "deleted",
  "pending_deletion",
  "blocked",
  "pending_blocked",
]);
const FAILED_CERTIFICATE = new Set([
  "initializing_timed_out",
  "validation_timed_out",
  "issuance_timed_out",
  "deployment_timed_out",
  "deleted",
  "expired",
]);

/** Cloudflare for SaaS custom hostnames: the partner's CNAME, and a certificate Cloudflare renews. */
export class CloudflareCustomHostnames implements DomainProvider {
  private readonly request: typeof fetch;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: CloudflareConfig,
    dependencies: Dependencies = {},
  ) {
    if (!config.zoneId.trim()) throw new Error("DOMAIN_ZONE_ID is required for Cloudflare");
    if (!config.apiToken.trim()) throw new Error("DOMAIN_API_TOKEN is required for Cloudflare");
    if (!config.fallbackOrigin.trim())
      throw new Error("DOMAIN_FALLBACK_ORIGIN is required for Cloudflare");
    this.request = dependencies.fetch ?? fetch;
    this.timeoutMs = dependencies.timeoutMs ?? 10_000;
    this.base = `${(config.endpoint?.trim() || API).replace(/\/$/, "")}/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames`;
  }

  describe() {
    return {
      id: "cloudflare-custom-hostnames",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { customHostnames: true },
    };
  }

  fallbackHostname(): string {
    return this.config.fallbackOrigin;
  }

  async create(hostname: string): Promise<CustomHostname> {
    const response = await this.call("POST", this.base, {
      hostname,
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
    if (response.status === 409) {
      await response.body?.cancel();
      // Already registered: take the existing one instead of failing.
      const existing = await this.find(hostname);
      if (existing) return existing;
      throw this.failure(409);
    }
    return this.read(response);
  }

  async get(id: string): Promise<CustomHostname | null> {
    const response = await this.call("GET", `${this.base}/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    return this.read(response);
  }

  async delete(id: string): Promise<void> {
    const response = await this.call("DELETE", `${this.base}/${encodeURIComponent(id)}`);
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw this.failure(response.status);
  }

  private async find(hostname: string): Promise<CustomHostname | null> {
    const response = await this.call(
      "GET",
      `${this.base}?hostname=${encodeURIComponent(hostname)}`,
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const body = (await response.json()) as { result?: CustomHostnameResult[] };
    const found = body.result?.find((entry) => entry.hostname === hostname);
    return found ? toCustomHostname(found) : null;
  }

  private call(method: string, url: string, body?: unknown): Promise<Response> {
    return this.request(url, {
      method,
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async read(response: Response): Promise<CustomHostname> {
    // Never surface provider bodies: they can carry account details.
    if (!response.ok) {
      await response.body?.cancel();
      throw this.failure(response.status);
    }
    const body = (await response.json()) as { result?: CustomHostnameResult };
    if (!body.result?.id || !body.result.hostname)
      throw new Error("Cloudflare returned an invalid custom hostname");
    return toCustomHostname(body.result);
  }

  private failure(status: number): Error {
    return new Error(`Cloudflare custom hostname request failed (HTTP ${status})`);
  }
}

export function toCustomHostname(result: CustomHostnameResult): CustomHostname {
  const hostname = result.status ?? "pending";
  const certificate = result.ssl?.status ?? "initializing";
  const errors = [
    ...(result.verification_errors ?? []),
    ...(result.ssl?.validation_errors ?? []).flatMap((error) =>
      error.message ? [error.message] : [],
    ),
  ];
  let status: CustomHostnameStatus = "pending";
  if (FAILED_HOSTNAME.has(hostname) || FAILED_CERTIFICATE.has(certificate)) status = "failed";
  else if (hostname === "active" && certificate === "active") status = "active";
  else if (hostname === "active") status = "verified";
  return {
    id: result.id ?? "",
    hostname: result.hostname ?? "",
    status,
    // Only a stuck hostname carries a reason worth showing.
    error: status === "failed" ? (errors[0] ?? `${hostname} / ${certificate}`).slice(0, 300) : null,
  };
}

/** The domain provider the deployment configures, or undefined when custom domains are off. */
export function domainProviderFromEnv(env: NodeJS.ProcessEnv): DomainProvider | undefined {
  const provider = env.DOMAIN_PROVIDER?.trim() || "none";
  if (provider === "none") return undefined;
  if (provider !== "cloudflare") throw new Error("DOMAIN_PROVIDER must be none or cloudflare");
  return new CloudflareCustomHostnames({
    zoneId: env.DOMAIN_ZONE_ID ?? "",
    apiToken: env.DOMAIN_API_TOKEN ?? "",
    fallbackOrigin: env.DOMAIN_FALLBACK_ORIGIN ?? "",
  });
}
