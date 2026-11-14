import type { AdapterContext, ComputerRef } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  browserEgressMinter,
  egressCapabilityKey,
  openEgressCapability,
} from "./browser-egress.js";
import { LinuxDesktop } from "./linux-desktop.js";

const SECRET = "provider-password-123";
const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  screenLeaseId: "run-1:1",
  signal: new AbortController().signal,
} as AdapterContext;
const computer = { id: "c", botId: "b", kind: "e2b", providerRef: "c" } as ComputerRef;

function run(minter: ReturnType<typeof browserEgressMinter>, ctx = context) {
  const commands: string[] = [];
  const desktop = new LinuxDesktop(
    {
      environment: async () => ({
        homeDir: "/home/corvo",
        workspaceDir: "/home/corvo",
        browserProfilesDir: "/home/corvo/.browser-profiles",
        displayStart: 1,
      }),
      run: async (_computer, command) => {
        commands.push(command);
        return { code: 0, stdout: "CORVO_DESKTOP=0:view-token\n" };
      },
      screenUrl: async () => "http://screen.example",
    },
    minter,
  );
  return desktop
    .observe(computer, ctx)
    .catch(() => undefined)
    .then(() => commands.join("\n"));
}

const configured = () =>
  browserEgressMinter(
    {
      BROWSER_EGRESS_PROXY_URL: `http://user-{session}:${SECRET}@proxy.example.test:8000`,
      API_URL: "https://api.example.test",
    },
    () => "master",
  );

describe("browser egress in the computer", () => {
  it("adds the proxy flags and the bot capability only when egress is configured", async () => {
    const on = await run(configured());
    expect(on).toContain('--proxy-server="http://127.0.0.1:$egress_port"');
    expect(on).toContain("--proxy-bypass-list=");
    expect(on).toContain("localhost;127.0.0.1;[::1]");
    expect(on).toContain("wss://api.example.test/api/internal/browser-egress");
    const off = await run(undefined);
    expect(off).not.toContain("--proxy-server");
    expect(off).not.toContain("egress");
  });

  it("never puts the provider secret, host or URL in the computer", async () => {
    const on = await run(configured());
    expect(on).not.toContain(SECRET);
    expect(on).not.toContain("proxy.example.test");
    expect(on).not.toContain("BROWSER_EGRESS_PROXY_URL");
    const capability = /"capability":"([^"]+)"/.exec(on)?.[1];
    expect(openEgressCapability(egressCapabilityKey("master"), capability)).toEqual({
      spaceId: "space-1",
      botId: "bot-1",
    });
  });

  it("leaves a run without a bot direct", async () => {
    const { botId: _botId, ...anonymous } = context;
    expect(await run(configured(), anonymous as AdapterContext)).not.toContain("--proxy-server");
  });
});
