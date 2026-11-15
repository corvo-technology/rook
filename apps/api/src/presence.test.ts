import { describe, expect, it, vi } from "vitest";
import { PresenceTracker } from "./presence.js";

function tracker() {
  let now = 1_000_000;
  const changes: string[] = [];
  const seen: Array<{ userId: string; at: number }> = [];
  const presence = new PresenceTracker({
    now: () => now,
    onChange: (spaceId) => changes.push(spaceId),
    persistSeen: async (_space, userId, at) => {
      seen.push({ userId, at: at.getTime() });
    },
  });
  return {
    presence,
    changes,
    seen,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("presence", () => {
  it("is online while a stream is open and the client is in use", () => {
    const { presence, changes } = tracker();
    expect(presence.statusOf("s", "u", null)).toBe("offline");
    presence.connect("s", "u");
    expect(presence.statusOf("s", "u", null)).toBe("online");
    expect(changes).toEqual(["s"]);
  });

  it("is away when the client is in the background or quiet for five minutes", () => {
    const { presence, advance } = tracker();
    presence.connect("s", "u");
    presence.touch("s", "u", false);
    expect(presence.statusOf("s", "u", null)).toBe("away");
    presence.touch("s", "u", true);
    expect(presence.statusOf("s", "u", null)).toBe("online");
    advance(5 * 60_000 + 1);
    expect(presence.statusOf("s", "u", null)).toBe("away");
    presence.sweep();
  });

  it("holds a page reload's gap, then goes offline when the last stream closes", () => {
    const { presence, advance, changes } = tracker();
    const leave = presence.connect("s", "u");
    const again = presence.connect("s", "u");
    leave();
    expect(presence.statusOf("s", "u", null)).toBe("online");
    again();
    expect(presence.statusOf("s", "u", null)).toBe("away");
    advance(11_000);
    expect(presence.statusOf("s", "u", null)).toBe("offline");
    presence.sweep();
    expect(changes.at(-1)).toBe("s");
  });

  it("tells the space once per change, not once per touch", () => {
    const { presence, changes } = tracker();
    presence.connect("s", "u");
    presence.touch("s", "u", true);
    presence.touch("s", "u", true);
    expect(changes).toHaveLength(1);
  });

  it("falls back to the stored last seen time for a member another instance holds", () => {
    const { presence } = tracker();
    const recent = new Date(1_000_000 - 30_000);
    const old = new Date(1_000_000 - 10 * 60_000);
    expect(presence.statusOf("s", "other", recent)).toBe("away");
    expect(presence.statusOf("s", "other", old)).toBe("offline");
    expect(presence.statusOf("s", "other", null)).toBe("offline");
  });

  it("writes the last seen time at most once a minute while connected, and when it closes", async () => {
    const { presence, seen, advance } = tracker();
    const leave = presence.connect("s", "u");
    presence.touch("s", "u", true);
    advance(30_000);
    presence.touch("s", "u", true);
    expect(seen).toHaveLength(1);
    advance(31_000);
    presence.touch("s", "u", true);
    expect(seen).toHaveLength(2);
    leave();
    await vi.waitFor(() => expect(seen).toHaveLength(3));
  });
});
