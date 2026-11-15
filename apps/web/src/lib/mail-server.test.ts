import { describe, expect, it } from "vitest";
import { parseMailServer } from "./mail-server";

describe("parseMailServer", () => {
  it("uses the default port and encrypts from the start on 993 and 465", () => {
    expect(parseMailServer("imap.example.test", 993)).toEqual({
      host: "imap.example.test",
      port: 993,
      secure: true,
    });
    expect(parseMailServer(" smtp.example.test ", 465)).toMatchObject({ port: 465, secure: true });
  });

  it("upgrades with STARTTLS on the other ports", () => {
    expect(parseMailServer("smtp.example.test:587", 465)).toEqual({
      host: "smtp.example.test",
      port: 587,
      secure: false,
    });
    expect(parseMailServer("imap.example.test:143", 993)?.secure).toBe(false);
  });

  it("refuses anything that is not a host and an optional port", () => {
    for (const value of [
      "",
      "https://imap.example.test",
      "imap.example.test:0",
      "a b",
      "host:99999",
    ])
      expect(parseMailServer(value, 993)).toBeNull();
  });
});
