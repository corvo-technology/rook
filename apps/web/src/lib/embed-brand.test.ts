import { describe, expect, it } from "vitest";
import { embedAssistantName } from "./embed-brand";

const none = { assistant: null, icon: null, user: null };

describe("what the assistant is called inside a partner's product", () => {
  it("is the name the page passes, ahead of everything", () => {
    expect(embedAssistantName({ ...none, assistant: "Dra. Ana" }, "Clínica", "Assistant")).toBe(
      "Dra. Ana",
    );
  });

  it("is the name the template gave the Chief when the page passes none", () => {
    expect(embedAssistantName(none, "Assistente Clínica", "Assistant")).toBe("Assistente Clínica");
  });

  it("is a neutral label, never Rook's own name", () => {
    expect(embedAssistantName(none, "Rook", "Assistente")).toBe("Assistente");
    expect(embedAssistantName(none, " rook ", "Assistente")).toBe("Assistente");
    expect(embedAssistantName(none, undefined, "Assistente")).toBe("Assistente");
  });
});
