import { describe, expect, it } from "vitest";
import {
  BROWSER_EGRESS_PATH,
  browserEgressMinter,
  egressCapabilityKey,
  egressSessionId,
  egressUpstream,
  openEgressCapability,
  parseBrowserEgress,
  refusedEgressDestination,
  sealEgressCapability,
} from "./browser-egress.js";

const SECRET = "provider-password-123";
const PROXY = `http://user-{session}:${SECRET}@proxy.example.test:8000`;

describe("parseBrowserEgress", () => {
  it("is off unless a provider URL is set", () => {
    expect(parseBrowserEgress({})).toBeUndefined();
    expect(parseBrowserEgress({ BROWSER_EGRESS_PROXY_URL: "  " })).toBeUndefined();
  });

  it("reads the provider URL, the price and the gateway origin", () => {
    expect(
      parseBrowserEgress({
        BROWSER_EGRESS_PROXY_URL: PROXY,
        BROWSER_EGRESS_USD_PER_GB: "6.5",
        API_URL: "https://api.example.test/some/path",
      }),
    ).toEqual({
      proxyUrl: PROXY,
      usdPerGb: 6.5,
      gatewayOrigin: "https://api.example.test",
    });
    expect(
      parseBrowserEgress({
        BROWSER_EGRESS_PROXY_URL: PROXY,
        API_URL: "https://api.example.test",
        BROWSER_EGRESS_GATEWAY_URL: "https://egress.example.test:8443",
      })?.gatewayOrigin,
    ).toBe("https://egress.example.test:8443");
  });

  it("rejects bad settings without repeating the credential", () => {
    const bad = [
      { BROWSER_EGRESS_PROXY_URL: `socks5://u:${SECRET}@proxy.example.test:1080` },
      { BROWSER_EGRESS_PROXY_URL: `not a url ${SECRET}` },
      { BROWSER_EGRESS_PROXY_URL: PROXY },
      {
        BROWSER_EGRESS_PROXY_URL: PROXY,
        API_URL: "https://a.test",
        BROWSER_EGRESS_USD_PER_GB: "0",
      },
      { BROWSER_EGRESS_PROXY_URL: PROXY, API_URL: "ftp://a.test" },
    ];
    for (const env of bad) {
      let message = "";
      try {
        parseBrowserEgress(env);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(SECRET);
    }
  });
});

describe("egressUpstream", () => {
  it("gives each bot its own sticky session in the username", () => {
    const auth = (bot: string) =>
      Buffer.from(
        egressUpstream(PROXY, bot).authorization?.replace("Basic ", "") ?? "",
        "base64",
      ).toString();
    expect(auth("bot-a")).toBe(`user-${egressSessionId("bot-a")}:${SECRET}`);
    expect(auth("bot-a")).toBe(auth("bot-a"));
    expect(auth("bot-a")).not.toBe(auth("bot-b"));
    expect(egressSessionId("bot-a")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("works without a placeholder or credentials", () => {
    expect(egressUpstream("http://proxy.example.test:3128", "bot")).toEqual({
      protocol: "http:",
      host: "proxy.example.test",
      port: 3128,
      authorization: undefined,
    });
    expect(egressUpstream("https://proxy.example.test", "bot").port).toBe(443);
  });
});

describe("egress capabilities", () => {
  const key = egressCapabilityKey("master-secret");
  const scope = { spaceId: "space", botId: "bot" };

  it("round-trips one bot's scope", () => {
    expect(openEgressCapability(key, sealEgressCapability(key, scope))).toEqual(scope);
  });

  it("refuses forged, tampered, foreign and expired capabilities", () => {
    const sealed = sealEgressCapability(key, scope, 1_000, 60_000);
    expect(openEgressCapability(key, sealed, 2_000)).toEqual(scope);
    expect(openEgressCapability(key, sealed, 61_001)).toBeUndefined();
    expect(openEgressCapability(egressCapabilityKey("other"), sealed, 2_000)).toBeUndefined();
    const [v, , mac] = sealed.split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ s: "space", b: "other-bot", e: 9e15 })).toString(
      "base64url",
    );
    expect(openEgressCapability(key, `${v}.${forged}.${mac}`, 2_000)).toBeUndefined();
    for (const junk of [undefined, "", "v1", "v1.a.b", "v2.a.b", "a.b.c.d"])
      expect(openEgressCapability(key, junk, 2_000)).toBeUndefined();
  });
});

describe("refusedEgressDestination", () => {
  it("lets public sites through", () => {
    for (const [host, port] of [
      ["example.com", 443],
      ["example.com", 80],
      ["93.184.216.34", 8443],
      ["2606:2800:220:1:248:1893:25c8:1946", 443],
    ] as const)
      expect(refusedEgressDestination(host, port)).toBeUndefined();
  });

  it("refuses private, loopback, link-local and metadata destinations", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "api.localhost",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "[::1]",
      "metadata.google.internal",
      "db.internal",
      "printer.local",
      "2130706433",
      "0x7f.1",
    ])
      expect(refusedEgressDestination(host, 443), host).toBeDefined();
  });

  it("refuses abuse ports and malformed targets", () => {
    for (const port of [22, 25, 445, 3389, 6379])
      expect(refusedEgressDestination("example.com", port)).toBeDefined();
    expect(refusedEgressDestination("example.com", 0)).toBeDefined();
    expect(refusedEgressDestination("example.com", 70000)).toBeDefined();
    expect(refusedEgressDestination("exa mple.com", 443)).toBeDefined();
    expect(refusedEgressDestination("", 443)).toBeDefined();
  });
});

describe("browserEgressMinter", () => {
  it("is absent when egress is off, and never derives the grant from the provider URL", () => {
    expect(browserEgressMinter({}, () => "master")).toBeUndefined();
    const minter = browserEgressMinter(
      { BROWSER_EGRESS_PROXY_URL: PROXY, API_URL: "https://api.example.test" },
      () => "master",
    );
    const grant = minter!.grant({ spaceId: "s", botId: "b" });
    expect(grant.gateway).toBe(`wss://api.example.test${BROWSER_EGRESS_PATH}`);
    expect(JSON.stringify(grant)).not.toContain(SECRET);
    expect(JSON.stringify(grant)).not.toContain("proxy.example.test");
    expect(openEgressCapability(egressCapabilityKey("master"), grant.capability)).toEqual({
      spaceId: "s",
      botId: "b",
    });
  });
});
