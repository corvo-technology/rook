import type {
  EmailDomain,
  EmailDomainProvider,
  EmailDomainRecord,
  EmailDomainStatus,
} from "@corvo/adapter-kit";

const RESEND_DOMAINS = "https://api.resend.com/domains";

interface Config {
  apiKey: string;
  /** The same Resend-compatible send endpoint the mail provider uses; Resend's own when unset. */
  endpoint?: string | undefined;
}

interface ResendRecord {
  type?: string;
  name?: string;
  value?: string;
  status?: string;
}

interface ResendDomain {
  id?: string;
  name?: string;
  status?: string;
  records?: ResendRecord[];
}

/** The domains endpoint of a Resend-compatible email API, beside its send endpoint. */
export function domainsEndpoint(endpoint: string | undefined): string {
  const value = endpoint?.trim();
  if (!value) return RESEND_DOMAINS;
  return value.replace(/\/emails\/?$/, "/domains").replace(/\/$/, "");
}

export class ResendEmailDomains implements EmailDomainProvider {
  private readonly base: string;
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: Config,
    dependencies: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    if (!config.apiKey.trim()) throw new Error("EMAIL_API_KEY is required for sender domains");
    this.base = domainsEndpoint(config.endpoint);
    this.request = dependencies.fetch ?? fetch;
    this.timeoutMs = dependencies.timeoutMs ?? 10_000;
  }

  describe() {
    return {
      id: "resend-domains",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { senderDomains: true },
    };
  }

  async create(name: string): Promise<EmailDomain> {
    return this.read(await this.call("POST", this.base, { name }));
  }

  async verify(id: string): Promise<EmailDomain> {
    const verify = await this.call("POST", `${this.base}/${encodeURIComponent(id)}/verify`);
    await verify.body?.cancel();
    // The records and their states come from the domain itself.
    return this.read(await this.call("GET", `${this.base}/${encodeURIComponent(id)}`));
  }

  async delete(id: string): Promise<void> {
    const response = await this.call("DELETE", `${this.base}/${encodeURIComponent(id)}`);
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw this.failure(response.status);
  }

  private call(method: string, url: string, body?: unknown): Promise<Response> {
    return this.request(url, {
      method,
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async read(response: Response): Promise<EmailDomain> {
    if (!response.ok) {
      await response.body?.cancel();
      throw this.failure(response.status);
    }
    const body = (await response.json()) as ResendDomain;
    if (!body.id || !body.name) throw new Error("The email service returned an invalid domain");
    return {
      id: body.id,
      name: body.name,
      status: domainStatus(body.status),
      records: (body.records ?? []).map(toRecord),
    };
  }

  private failure(status: number): Error {
    return new Error(`Sender domain request failed (HTTP ${status})`);
  }
}

function domainStatus(value: string | undefined): EmailDomainStatus {
  if (value === "verified") return "verified";
  if (value === "failed" || value === "temporary_failure") return "failed";
  return "pending";
}

function toRecord(record: ResendRecord): EmailDomainRecord {
  return {
    type: record.type ?? "TXT",
    name: record.name ?? "",
    value: record.value ?? "",
    status: record.status ?? "pending",
  };
}
