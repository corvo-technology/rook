import { SandboxRateLimitError } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { ComputerBusyError } from "./computer-lifecycle.js";
import { isComputerSetupFailure, markComputerSetupFailure } from "./computer-setup-error.js";

describe("computer setup failures", () => {
  it("marks an error without changing it", () => {
    const error = new Error("The specified key does not exist.");
    expect(isComputerSetupFailure(error)).toBe(false);
    expect(markComputerSetupFailure(error)).toBe(error);
    expect(isComputerSetupFailure(error)).toBe(true);
  });

  it("leaves a busy computer and a rate limit to their own handling", () => {
    expect(isComputerSetupFailure(markComputerSetupFailure(new ComputerBusyError()))).toBe(false);
    expect(isComputerSetupFailure(markComputerSetupFailure(new SandboxRateLimitError()))).toBe(
      false,
    );
  });

  it("ignores values that are not objects", () => {
    expect(isComputerSetupFailure(markComputerSetupFailure("boom"))).toBe(false);
  });
});
