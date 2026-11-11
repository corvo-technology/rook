import { describe, expect, it } from "vitest";
import { maskSecrets } from "./secret-mask.js";

describe("maskSecrets", () => {
  it("masks bearer tokens and provider keys", () => {
    const masked = maskSecrets('401 {"error":"Bearer sk-test-0000000000 invalid"}');
    expect(masked).toContain("Bearer [redacted]");
    expect(masked).not.toContain("sk-test");
  });

  it("masks key assignments", () => {
    expect(maskSecrets("api_key=abc123 x")).toBe("api_key=[redacted] x");
  });

  it("masks three-part tokens", () => {
    expect(maskSecrets("token eyJhbGciOi.eyJzdWIiOi.c2ln here")).toBe("token [redacted] here");
  });

  it("leaves text without secrets unchanged", () => {
    expect(maskSecrets("The model is overloaded.")).toBe("The model is overloaded.");
    expect(maskSecrets("")).toBe("");
  });
});
