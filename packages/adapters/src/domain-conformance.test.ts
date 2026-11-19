import type { CustomHostnameStatus, DomainProvider } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { CloudflareCustomHostnames, toCustomHostname } from "./cloudflare-custom-hostnames.js";
import { DomainEmulator, EmailDomainEmulator } from "./domain-emulator.js";
import { domainsEndpoint, ResendEmailDomains } from "./resend-email-domains.js";

/**
 * A stand-in for the Cloudflare API: the same paths and JSON shapes, held in memory, so the real
 * adapter runs end to end without a network. `settle` moves a hostname the way Cloudflare would.
 */
function fakeCloudflare() {
  const rows = new Map<string, { id: string; hostname: string; status: string; ssl: string }>();
  const calls: Array<{ method: string; path: string; auth: string | null; body: unknown }> = [];
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname + url.search,
      auth: headers.get("authorization"),
      body,
    });
    const respond = (result: unknown, status = 200) =>
      Response.json({ success: true, result }, { status });
    const shape = (row: { id: string; hostname: string; status: string; ssl: string }) => ({
      id: row.id,
      hostname: row.hostname,
      status: row.status,
      ssl: { status: row.ssl },
    });
    const id = url.pathname.split("/custom_hostnames/")[1];
    if (method === "POST") {
      const exists = [...rows.values()].find((row) => row.hostname === body.hostname);
      if (exists) return Response.json({ success: false }, { status: 409 });
      const row = {
        id: `cf-${rows.size + 1}`,
        hostname: body.hostname as string,
        status: "pending",
        ssl: "pending_validation",
      };
      rows.set(row.id, row);
      return respond(shape(row));
    }
    if (method === "GET" && id) {
      const row = rows.get(id);
      return row ? respond(shape(row)) : Response.json({ success: false }, { status: 404 });
    }
    if (method === "GET") {
      const wanted = url.searchParams.get("hostname");
      return respond([...rows.values()].filter((row) => row.hostname === wanted).map(shape));
    }
    if (method === "DELETE" && id) {
      rows.delete(id);
      return respond({ id });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return {
    request,
    calls,
    settle(hostname: string, status: string, ssl: string) {
      const row = [...rows.values()].find((entry) => entry.hostname === hostname)!;
      row.status = status;
      row.ssl = ssl;
    },
  };
}

type Harness = {
  provider: DomainProvider;
  move(hostname: string, status: CustomHostnameStatus): void;
};

const providers: Record<string, () => Harness> = {
  emulator: () => {
    const emulator = new DomainEmulator("fallback.rook.example");
    return { provider: emulator, move: (hostname, status) => emulator.set(hostname, status) };
  },
  cloudflare: () => {
    const fake = fakeCloudflare();
    const provider = new CloudflareCustomHostnames(
      { zoneId: "zone-1", apiToken: "fake-token", fallbackOrigin: "fallback.rook.example" },
      { fetch: fake.request },
    );
    const states: Record<CustomHostnameStatus, [string, string]> = {
      pending: ["pending", "pending_validation"],
      verified: ["active", "pending_issuance"],
      active: ["active", "active"],
      failed: ["blocked", "validation_timed_out"],
    };
    return { provider, move: (hostname, status) => fake.settle(hostname, ...states[status]) };
  },
};

describe.each(Object.entries(providers))("%s domain provider contract", (_name, create) => {
  it("registers a hostname as pending and names the CNAME target", async () => {
    const { provider } = create();
    const host = await provider.create("app.acme.example.test");
    expect(host).toMatchObject({
      hostname: "app.acme.example.test",
      status: "pending",
      error: null,
    });
    expect(host.id).not.toBe("");
    expect(provider.fallbackHostname()).toBe("fallback.rook.example");
    expect(provider.describe().capabilities.customHostnames).toBe(true);
  });

  it("takes the hostname it already holds instead of failing", async () => {
    const { provider } = create();
    const first = await provider.create("app.acme.example.test");
    const second = await provider.create("app.acme.example.test");
    expect(second.id).toBe(first.id);
  });

  it("reports each stage the provider moves through", async () => {
    const { provider, move } = create();
    const host = await provider.create("app.acme.example.test");
    for (const status of ["verified", "active", "failed"] as const) {
      move("app.acme.example.test", status);
      expect((await provider.get(host.id))?.status).toBe(status);
    }
    expect((await provider.get(host.id))?.error).not.toBeNull();
  });

  it("answers null for a hostname it no longer has, and deleting twice is fine", async () => {
    const { provider } = create();
    const host = await provider.create("app.acme.example.test");
    await provider.delete(host.id);
    expect(await provider.get(host.id)).toBeNull();
    await expect(provider.delete(host.id)).resolves.toBeUndefined();
  });
});

describe("Cloudflare adapter", () => {
  it("sends the token as a bearer and asks for an HTTP-validated certificate", async () => {
    const fake = fakeCloudflare();
    const provider = new CloudflareCustomHostnames(
      { zoneId: "zone-1", apiToken: "fake-token", fallbackOrigin: "fallback.rook.example" },
      { fetch: fake.request },
    );
    await provider.create("app.acme.example.test");
    expect(fake.calls[0]).toMatchObject({
      method: "POST",
      path: "/client/v4/zones/zone-1/custom_hostnames",
      auth: "Bearer fake-token",
      body: { hostname: "app.acme.example.test", ssl: { method: "http", type: "dv" } },
    });
  });

  it("never surfaces the provider's own words in an error", async () => {
    const provider = new CloudflareCustomHostnames(
      { zoneId: "zone-1", apiToken: "fake-token", fallbackOrigin: "fallback.rook.example" },
      {
        fetch: (async () =>
          new Response("account 1234 secret detail", { status: 403 })) as typeof fetch,
      },
    );
    await expect(provider.create("app.acme.example.test")).rejects.toThrow(
      "Cloudflare custom hostname request failed (HTTP 403)",
    );
  });

  it("needs a zone, a token and a fallback origin", () => {
    for (const config of [
      { zoneId: "", apiToken: "t", fallbackOrigin: "f.example" },
      { zoneId: "z", apiToken: "", fallbackOrigin: "f.example" },
      { zoneId: "z", apiToken: "t", fallbackOrigin: "" },
    ]) {
      expect(() => new CloudflareCustomHostnames(config)).toThrow();
    }
  });

  it("reads Cloudflare's statuses into the four states, with the first reason when stuck", () => {
    const base = { id: "1", hostname: "a.example.test" };
    expect(
      toCustomHostname({ ...base, status: "pending", ssl: { status: "initializing" } }).status,
    ).toBe("pending");
    expect(
      toCustomHostname({ ...base, status: "active", ssl: { status: "pending_deployment" } }).status,
    ).toBe("verified");
    expect(toCustomHostname({ ...base, status: "active", ssl: { status: "active" } }).status).toBe(
      "active",
    );
    const failed = toCustomHostname({
      ...base,
      status: "pending",
      ssl: { status: "validation_timed_out", validation_errors: [{ message: "CNAME not found" }] },
    });
    expect(failed).toMatchObject({ status: "failed", error: "CNAME not found" });
  });
});

describe("sender domain emulator", () => {
  it("lists the records to add and moves to verified once they are found", async () => {
    const emulator = new EmailDomainEmulator();
    const domain = await emulator.create("mail.acme.example.test");
    expect(domain.status).toBe("pending");
    expect(domain.records.map((record) => record.type)).toEqual(["MX", "TXT", "TXT"]);
    emulator.set("mail.acme.example.test", "verified");
    expect((await emulator.verify(domain.id)).status).toBe("verified");
    await emulator.delete(domain.id);
    await expect(emulator.verify(domain.id)).rejects.toThrow();
  });
});

describe("Resend-compatible sender domains", () => {
  it("creates, verifies and removes a domain through the service's own endpoint", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const domain = {
      id: "dom-1",
      name: "mail.acme.example.test",
      status: "not_started",
      records: [
        {
          record: "SPF",
          type: "MX",
          name: "send",
          value: "feedback-smtp.example.test",
          status: "not_started",
        },
      ],
    };
    const provider = new ResendEmailDomains(
      { apiKey: "fake-key", endpoint: "https://mail.example.test/v1/emails" },
      {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push({ method: init?.method ?? "GET", url: String(input) });
          if (String(input).endsWith("/verify"))
            return Response.json({ object: "domain", id: "dom-1" });
          if (init?.method === "DELETE") return Response.json({ deleted: true });
          return Response.json(calls.length >= 3 ? { ...domain, status: "verified" } : domain);
        }) as typeof fetch,
      },
    );
    const created = await provider.create("mail.acme.example.test");
    expect(created).toMatchObject({ id: "dom-1", status: "pending" });
    expect(created.records[0]).toMatchObject({ type: "MX", name: "send" });
    expect((await provider.verify("dom-1")).status).toBe("verified");
    await provider.delete("dom-1");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://mail.example.test/v1/domains",
      "POST https://mail.example.test/v1/domains/dom-1/verify",
      "GET https://mail.example.test/v1/domains/dom-1",
      "DELETE https://mail.example.test/v1/domains/dom-1",
    ]);
  });

  it("finds the domains endpoint from the send endpoint, defaulting to the service's own", () => {
    expect(domainsEndpoint(undefined)).toBe("https://api.resend.com/domains");
    expect(domainsEndpoint("https://mail.example.test/emails")).toBe(
      "https://mail.example.test/domains",
    );
  });
});
