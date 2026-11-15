import { describe, expect, it } from "vitest";
import { unreadBadgeText } from "./notifications.js";

describe("unreadBadgeText", () => {
  it("shows the count and caps what it shows at 99", () => {
    expect(unreadBadgeText(1)).toBe("1");
    expect(unreadBadgeText(99)).toBe("99");
    expect(unreadBadgeText(100)).toBe("99+");
  });
});
