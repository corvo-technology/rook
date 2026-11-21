import { describe, expect, it } from "vitest";
import { VaultCreateInput, VaultCredentialSchema } from "./vault.js";

const destination = {
  name: "billing",
  origin: "https://api.example.test",
  auth: { type: "bearer" },
};

describe("vault contract", () => {
  it("defaults a new credential to personal with no agents", () => {
    const parsed = VaultCreateInput.parse({ destination, value: "fake-value-1" });
    expect(parsed.scope).toBe("personal");
    expect(parsed.botIds).toEqual([]);
  });

  it("only knows personal and space credentials, and bounds the value", () => {
    expect(
      VaultCreateInput.safeParse({ destination, value: "fake-value-1", scope: "everyone" }).success,
    ).toBe(false);
    expect(VaultCreateInput.safeParse({ destination, value: "" }).success).toBe(false);
    expect(VaultCreateInput.safeParse({ destination, value: "x".repeat(16_385) }).success).toBe(
      false,
    );
  });

  it("describes a credential without any part of its value", () => {
    const shape = Object.keys(VaultCredentialSchema.shape);
    expect(shape).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/value|secret|cipher|last4|hint/i)]),
    );
  });
});
