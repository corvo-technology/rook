import { describe, expect, it } from "vitest";
import type { OnboardingContext } from "./onboarding-steps";
import { nextStep, progress, resolveStep, visibleSteps } from "./onboarding-steps";

const all: OnboardingContext = {
  canRenameSpace: true,
  spaceName: "Personal",
  needsModel: true,
  canInvite: true,
  canChooseHostComputer: true,
  computerHost: null,
  hasDesktopHostChoice: true,
  returning: false,
};

describe("visibleSteps", () => {
  it("lists every step in order when none is omitted", () => {
    expect(visibleSteps(all)).toEqual(["workspace", "start", "model", "bot", "invite", "computer"]);
  });

  it("omits the workspace step when the space cannot be renamed", () => {
    expect(visibleSteps({ ...all, canRenameSpace: false })).not.toContain("workspace");
  });

  it("omits the model step when no model is needed", () => {
    expect(visibleSteps({ ...all, needsModel: false })).not.toContain("model");
  });

  it("omits the computer step unless the host can be chosen and has not been", () => {
    expect(visibleSteps({ ...all, canChooseHostComputer: false })).not.toContain("computer");
    expect(visibleSteps({ ...all, computerHost: "docker" })).not.toContain("computer");
    expect(visibleSteps({ ...all, hasDesktopHostChoice: false })).not.toContain("computer");
  });
});

describe("a returning account", () => {
  it("skips the workspace and use steps when it already has content elsewhere", () => {
    expect(visibleSteps({ ...all, returning: true })).toEqual(["model", "bot", "computer"]);
  });
});

describe("the invite step", () => {
  it("is offered only to someone who can invite", () => {
    expect(visibleSteps({ ...all, canInvite: false })).not.toContain("invite");
  });

  it("comes after the first bot and before the computer", () => {
    expect(nextStep(all, "bot")).toBe("invite");
    expect(nextStep(all, "invite")).toBe("computer");
  });
});

describe("a renamed step", () => {
  it("opens the start step from the old survey address", () => {
    expect(resolveStep(all, "survey")).toBe("start");
  });
});

describe("nextStep", () => {
  it("skips omitted steps and ends with null", () => {
    const ctx = { ...all, needsModel: false, canInvite: false, canChooseHostComputer: false };
    expect(nextStep(ctx, "start")).toBe("bot");
    expect(nextStep(ctx, "bot")).toBeNull();
  });
});

describe("resolveStep", () => {
  it("opens the first visible step when the requested one is hidden or missing", () => {
    const ctx = { ...all, canRenameSpace: false, canChooseHostComputer: false };
    expect(resolveStep(ctx, "computer")).toBe("start");
    expect(resolveStep(ctx, undefined)).toBe("start");
    expect(resolveStep(ctx, "nonsense")).toBe("start");
  });

  it("opens a visible requested step", () => {
    expect(resolveStep(all, "model")).toBe("model");
  });

  it("does not open a hidden step from its URL", () => {
    expect(resolveStep({ ...all, canRenameSpace: false }, "workspace")).toBe("start");
  });
});

describe("resolveStep with progress", () => {
  it("opens the first step that is not done yet", () => {
    expect(resolveStep(all, undefined, new Set(["workspace", "start"]))).toBe("model");
  });

  it("opens the last step when everything is done", () => {
    const done = new Set(visibleSteps(all));
    expect(resolveStep(all, undefined, done)).toBe("computer");
  });

  it("still opens a requested visible step that is done", () => {
    expect(resolveStep(all, "start", new Set(["start"]))).toBe("start");
  });
});

describe("progress", () => {
  it("counts only completed visible steps", () => {
    const visible = visibleSteps(all);
    expect(progress(visible, new Set(["workspace", "start"]))).toEqual({
      done: 2,
      total: 6,
      percent: 33,
    });
  });

  it("is complete when there is nothing to do", () => {
    expect(progress([], new Set())).toEqual({ done: 0, total: 0, percent: 100 });
  });
});
