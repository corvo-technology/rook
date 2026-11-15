import { expect, it } from "vitest";
import { titleWithUnread, unreadTotal } from "./unread";

it("sums counts and counts an unread row without one as one", () => {
  expect(
    unreadTotal([
      { unread: true, unreadCount: 4 },
      { unread: true },
      { unread: true, unreadCount: 0 },
      { unread: false, unreadCount: 3 },
      { unread: false },
    ]),
  ).toBe(6);
});

it("puts the total in front of the title and takes it away at zero", () => {
  expect(titleWithUnread("Corvo", 3)).toBe("(3) Corvo");
  expect(titleWithUnread("(3) Corvo", 5)).toBe("(5) Corvo");
  expect(titleWithUnread("(5) Corvo", 0)).toBe("Corvo");
});
