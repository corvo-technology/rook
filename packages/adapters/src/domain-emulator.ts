import type {
  CustomHostname,
  CustomHostnameStatus,
  DomainProvider,
  EmailDomain,
  EmailDomainProvider,
  EmailDomainStatus,
} from "@corvo/adapter-kit";

/** Deterministic, offline domain provider: a hostname moves only when a test moves it. */
export class DomainEmulator implements DomainProvider {
  readonly hostnames = new Map<string, CustomHostname>();
  private next = 1;
  private failures = 0;

  constructor(private readonly fallback = "fallback.rook.example") {}

  describe() {
    return {
      id: "domain-emulator",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { customHostnames: true },
    };
  }

  fallbackHostname(): string {
    return this.fallback;
  }

  async create(hostname: string): Promise<CustomHostname> {
    this.maybeFail();
    const existing = [...this.hostnames.values()].find((entry) => entry.hostname === hostname);
    if (existing) return { ...existing };
    const created: CustomHostname = {
      id: `ch-${this.next++}`,
      hostname,
      status: "pending",
      error: null,
    };
    this.hostnames.set(created.id, created);
    return { ...created };
  }

  async get(id: string): Promise<CustomHostname | null> {
    this.maybeFail();
    const found = this.hostnames.get(id);
    return found ? { ...found } : null;
  }

  async delete(id: string): Promise<void> {
    this.maybeFail();
    this.hostnames.delete(id);
  }

  /** Test control: what the provider would report on the next poll. */
  set(
    hostname: string,
    status: CustomHostnameStatus,
    error: string | null = status === "failed" ? "Emulated provider failure" : null,
  ): void {
    const found = [...this.hostnames.values()].find((entry) => entry.hostname === hostname);
    if (!found) throw new Error(`No custom hostname ${hostname}`);
    found.status = status;
    found.error = error;
  }

  failNextCalls(count = 1): void {
    this.failures = count;
  }

  private maybeFail() {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("Emulated domain provider failure");
    }
  }
}

/** Deterministic, offline sender-domain provider. */
export class EmailDomainEmulator implements EmailDomainProvider {
  readonly domains = new Map<string, EmailDomain>();
  private next = 1;

  describe() {
    return {
      id: "email-domain-emulator",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { senderDomains: true },
    };
  }

  async create(name: string): Promise<EmailDomain> {
    const created: EmailDomain = {
      id: `ed-${this.next++}`,
      name,
      status: "pending",
      records: [
        {
          type: "MX",
          name: `send.${name}`,
          value: "feedback-smtp.mail.example.test",
          status: "pending",
        },
        {
          type: "TXT",
          name: `send.${name}`,
          value: "v=spf1 include:mail.example.test ~all",
          status: "pending",
        },
        {
          type: "TXT",
          name: `key._domainkey.${name}`,
          value: "p=fake-dkim-key",
          status: "pending",
        },
      ],
    };
    this.domains.set(created.id, created);
    return structuredClone(created);
  }

  async verify(id: string): Promise<EmailDomain> {
    const found = this.domains.get(id);
    if (!found) throw new Error("Unknown sender domain");
    return structuredClone(found);
  }

  async delete(id: string): Promise<void> {
    this.domains.delete(id);
  }

  /** Test control: what the service would report on the next check. */
  set(name: string, status: EmailDomainStatus): void {
    const found = [...this.domains.values()].find((entry) => entry.name === name);
    if (!found) throw new Error(`No sender domain ${name}`);
    found.status = status;
    for (const record of found.records) record.status = status;
  }
}
