import { describe, expect, it } from "vitest";
import type { CliEngineHost } from "../cli-engine-host.js";
import { CliEngineSetupService } from "./setup.js";

const host = { configDir: () => "/data/engines/claude/config" } as unknown as CliEngineHost;
const service = (ownersComputer: boolean, script?: string) =>
  new CliEngineSetupService({
    host,
    dataDir: "/data",
    ownersComputer,
    script: async () => script,
  });

describe("CliEngineSetupService.setup", () => {
  it("signs in through the browser on the owner's computer", async () => {
    expect((await service(true).setup())[0]).toMatchObject({ id: "claude", signIn: "browser" });
  });

  it("signs in through a relayed terminal on a server that has script", async () => {
    expect((await service(false, "/usr/bin/script").setup())[0]?.signIn).toBe("terminal");
  });

  it("offers no sign-in on a server without script", async () => {
    expect((await service(false).setup())[0]?.signIn).toBeNull();
  });

  it("does not start a session for an id the engine does not know", async () => {
    expect(await service(true).signIn("other" as never)).toBeUndefined();
  });
});
