import { describe, expect, it } from "vitest";
import { movedSettingsSection } from "./settings-route";

describe("movedSettingsSection", () => {
  it("sends the old servers, databases and mailboxes pages to Connections", () => {
    for (const section of ["mcp", "databases", "mailboxes"]) {
      expect(movedSettingsSection(section)).toBe("connections");
    }
  });

  it("leaves every other section where it is", () => {
    for (const section of ["general", "models", "connections", "members"]) {
      expect(movedSettingsSection(section)).toBeNull();
    }
  });
});
