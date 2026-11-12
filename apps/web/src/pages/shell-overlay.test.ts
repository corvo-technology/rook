import { describe, expect, it } from "vitest";
import { legacyOverlayTarget, searchString, shellOverlaySearch } from "./shell-overlay";

const target = (search: string) => legacyOverlayTarget(new URLSearchParams(search));

describe("legacyOverlayTarget", () => {
  it("leaves links without overlay params alone", () => {
    expect(target("")).toBeNull();
    expect(target("?m=msg_1&routine=r_1")).toBeNull();
    expect(target("?messaging")).toBeNull();
  });

  it("sends a settings section to its page, general for bare or unknown values", () => {
    expect(target("?settings=voice")?.to).toBe("/settings/voice");
    expect(target("?settings")?.to).toBe("/settings/general");
    expect(target("?settings=nope")?.to).toBe("/settings/general");
    expect(target("?settings=confirmations")?.to).toBe("/settings/approvals");
  });

  it("sends a space's settings to its own route", () => {
    expect(target("?settings=space&space=sp_1")?.to).toBe("/settings/space/sp_1");
    expect(target("?settings=models&space=sp_1")?.to).toBe("/settings/models");
  });

  it("sends the store and MCP servers to their pages", () => {
    expect(target("?integrations")?.to).toBe("/app/store");
    expect(target("?mcp=")?.to).toBe("/settings/mcp");
    expect(target("?mcp=srv_1")?.to).toBe("/settings/mcp?server=srv_1");
  });

  it("keeps the other params", () => {
    const result = target("?m=msg_1&settings=voice&space=sp_1");
    expect(searchString(result?.rest ?? new URLSearchParams())).toBe("?m=msg_1");
  });
});

describe("shellOverlaySearch", () => {
  it("carries only the plan choice into a redirect", () => {
    expect(shellOverlaySearch(new URLSearchParams("?m=msg_1&plans"))).toBe("?plans");
    expect(shellOverlaySearch(new URLSearchParams("?routine=r_1"))).toBe("");
  });
});
