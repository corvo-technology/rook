import { HOLD_TO_APPROVE_MS, holdsToApprove } from "@corvo/core";
import { afterEach, describe, expect, it } from "vitest";
import { askActionLabel } from "./ask-action-label";
import { resetI18nForTests, t } from "./i18n";

const fakeT = (message: string, values?: Record<string, string | number>) =>
  message.replace(/\{site\}/g, () => String(values?.site));

describe("askActionLabel", () => {
  afterEach(() => resetI18nForTests());

  it.each([
    ["allow", "created", "Create space"],
    ["deny", "created", "Create space"],
    ["allow", "cancelled", "Cancel"],
    ["deny", "cancelled", "Cancel"],
  ] as const)("prioritizes %s's %s outcome", (id, outcome, expected) => {
    expect(askActionLabel({ id, label: "Server label", outcome }, { approval: true }, fakeT)).toBe(
      expected,
    );
  });

  it.each([
    ["allow", "Apply"],
    ["deny", "Dismiss"],
  ])("words a proposal's %s as %s, not a permission", (id, expected) => {
    expect(
      askActionLabel({ id, label: "Server label" }, { approval: true, proposal: true }, fakeT),
    ).toBe(expected);
  });

  it.each([
    ["always", "example.test", "Always allow example.test"],
    ["always", undefined, "Always allow this tool"],
    ["always", "", "Always allow this tool"],
    ["allow", undefined, "Allow once"],
    ["deny", undefined, "Not now"],
    ["custom", undefined, "Server label"],
  ])("labels approval action %s with site %s", (id, site, expected) => {
    expect(askActionLabel({ id, label: "Server label" }, { approval: true, site }, fakeT)).toBe(
      expected,
    );
  });

  it("words an always-allow that covers one tool for one agent as Always allow", () => {
    expect(
      askActionLabel(
        { id: "always", label: "Server label" },
        { approval: true, scoped: true },
        fakeT,
      ),
    ).toBe("Always allow");
  });

  it.each(["allow", "always", "deny", "custom"])(
    "preserves the server label for non-approval action %s",
    (id) => {
      for (const outcome of [undefined, "created", "cancelled"] as const) {
        expect(
          askActionLabel(
            { id, label: "Server label", outcome },
            { approval: false, site: "example.test" },
            fakeT,
          ),
        ).toBe("Server label");
      }
    },
  );

  it("uses the real mobile translator with site interpolation", () => {
    resetI18nForTests("pt-BR");
    expect(
      askActionLabel(
        { id: "always", label: "Server label" },
        { approval: true, site: "example.test" },
        t,
      ),
    ).toBe("Permitir sempre example.test");
  });
});

describe("holdsToApprove on a card's actions", () => {
  it("holds only the plain allow of an action a tool is about to run", () => {
    expect(holdsToApprove({ approval: true }, { id: "allow" })).toBe(true);
    expect(holdsToApprove({ approval: true }, { id: "always" })).toBe(false);
    expect(holdsToApprove({ approval: true }, { id: "deny" })).toBe(false);
    expect(holdsToApprove({ approval: false }, { id: "allow" })).toBe(false);
    expect(holdsToApprove({ approval: true, proposal: true }, { id: "allow" })).toBe(false);
    expect(holdsToApprove({ approval: true, instructionUpdate: true }, { id: "allow" })).toBe(
      false,
    );
    expect(holdsToApprove({ approval: true }, { id: "allow", outcome: "created" })).toBe(false);
    expect(HOLD_TO_APPROVE_MS).toBe(800);
  });
});
