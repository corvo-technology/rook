import { describe, expect, it } from "vitest";
import { senderFor } from "./email-sender.js";

describe("senderFor", () => {
  const from = "Pedro of Rook <no-reply@example.test>";

  it("joins the name to the brand with the email's language", () => {
    expect(senderFor(from, "pt-BR")).toBe("Pedro do Rook <no-reply@example.test>");
    expect(senderFor(from, "pt")).toBe("Pedro do Rook <no-reply@example.test>");
    expect(senderFor(from, "en")).toBe(from);
    expect(senderFor(from)).toBe(from);
  });

  it("leaves senders without the pattern alone", () => {
    expect(senderFor("Rook <no-reply@example.test>", "pt-BR")).toBe("Rook <no-reply@example.test>");
    expect(senderFor("no-reply@example.test", "pt-BR")).toBe("no-reply@example.test");
  });

  it("handles a quoted display name", () => {
    expect(senderFor('"Pedro of Rook" <no-reply@example.test>', "pt-BR")).toBe(
      '"Pedro do Rook" <no-reply@example.test>',
    );
  });
});
