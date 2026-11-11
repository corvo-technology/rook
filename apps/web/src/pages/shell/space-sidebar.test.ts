import { describe, expect, it, vi } from "vitest";
import { commitSpaceRename, countUnreadChats, sidebarGroupsForSpaces } from "./space-sidebar";

function chat(id: string, name: string) {
  return {
    id,
    name,
    title: "",
    preview: "",
    pinned: false,
    sectionId: null,
    parentBotId: null,
  };
}

function space(
  id: string,
  name: string,
  options: {
    canRename?: boolean;
    canDelete?: boolean;
    canPause?: boolean;
    bots?: ReturnType<typeof chat>[];
  } = {},
) {
  return {
    id,
    name,
    canRename: options.canRename ?? false,
    canDelete: options.canDelete ?? false,
    canPause: options.canPause ?? false,
    bots: options.bots ?? [chat(`${id}-bot`, "Chief")],
    groups: [],
    botSections: [],
  };
}

describe("sidebarGroupsForSpaces", () => {
  it("leads with the Chief, then pinned, groups, saved sections and the rest, and keeps that order with an empty section", () => {
    const chief = { ...chat("chief", "Chefe"), spawnKey: "onboarding:first" };
    const pinned = { ...chat("pinned", "Pinned bot"), pinned: true };
    const loose = chat("loose", "Loose bot");
    const team = chat("team", "Team");
    const groups = sidebarGroupsForSpaces(
      [
        {
          ...space("space-1", "Personal"),
          bots: [loose, pinned, chief],
          groups: [team],
          botSections: [{ id: "work", name: "Work" }],
        },
      ],
      "",
      { pinned: "Pinned", unassigned: "Unassigned", groups: "Groups" },
    );
    expect(groups.map((group) => [group.key, group.bots.map((item) => item.chat.id)])).toEqual([
      ["chief", ["chief"]],
      ["pinned", ["pinned"]],
      ["groups", ["team"]],
      ["section:work", []],
      ["unassigned", ["loose"]],
    ]);
    expect(groups.map((group) => group.title)).toEqual([
      null,
      "Pinned",
      "Groups",
      "Work",
      "Unassigned",
    ]);
  });

  it("keeps an empty space with saved sections openable", () => {
    const empty = {
      ...space("space-2", "Support", { canRename: true, bots: [] }),
      botSections: [{ id: "saved", name: "Archived projects" }],
    };
    const groups = sidebarGroupsForSpaces([space("space-1", "Personal"), empty], "");
    expect(groups.filter((group) => group.spaceId === empty.id)).toEqual([
      expect.objectContaining({ emptySpaceId: "space-2", title: "Support" }),
      expect.objectContaining({
        sectionId: "saved",
        title: "Support",
        subtitle: "Archived projects",
        bots: [],
        emptySpaceId: undefined,
      }),
    ]);
  });

  it("keeps an empty section deletable when the only space has no chats", () => {
    const input = {
      ...space("space-1", "Personal", { bots: [] }),
      botSections: [{ id: "old", name: "Old ideas" }],
    };
    expect(sidebarGroupsForSpaces([input], "")).toEqual([
      expect.objectContaining({ key: "section:old", sectionId: "old", title: "Old ideas" }),
    ]);
    expect(sidebarGroupsForSpaces([input], "Old")).toEqual([]);
  });

  it("retains empty section and Unassigned drop targets when not searching", () => {
    const input = {
      ...space("space-1", "Personal"),
      bots: [{ ...chat("a", "Alpha"), sectionId: "s1" }],
      botSections: [
        { id: "s1", name: "Projects" },
        { id: "s2", name: "Empty" },
      ],
    };
    expect(sidebarGroupsForSpaces([input], "").map((group) => group.key)).toEqual([
      "section:s1",
      "section:s2",
      "unassigned",
    ]);
    expect(sidebarGroupsForSpaces([input], "Alpha").map((group) => group.key)).toEqual([
      "section:s1",
    ]);
  });

  it("leaves the only space unnamed on its roster, since the switcher already names it", () => {
    const [group] = sidebarGroupsForSpaces([space("space-1", "Personal", { canRename: true })], "");

    expect(group).toMatchObject({
      title: null,
      spaceName: "Personal",
      canRenameSpace: false,
      canOpenSpaceSettings: false,
      showLock: false,
    });
    expect(group?.bots).toHaveLength(1);
  });

  it("still names each space once there is more than one", () => {
    const groups = sidebarGroupsForSpaces(
      [
        space("space-1", "Personal", { canRename: true }),
        space("space-2", "Support", { canRename: true, canDelete: true, bots: [] }),
      ],
      "",
    );

    expect(groups.map((group) => group.title)).toEqual(["Personal", "Support"]);
    expect(groups[0]).toMatchObject({ canRenameSpace: true, canDeleteSpace: false });
    expect(groups[1]).toMatchObject({
      canRenameSpace: true,
      canDeleteSpace: true,
      emptySpaceId: "space-2",
    });
  });

  it("offers pausing only on the menu-hosting group of a space the member can pause", () => {
    const groups = sidebarGroupsForSpaces(
      [
        space("space-1", "Personal", { canPause: true }),
        space("space-2", "Support", { canPause: true, bots: [] }),
        space("space-3", "Shared"),
      ],
      "",
    );

    expect(groups.map((group) => group.canPauseSpace)).toEqual([true, true, false]);
    const [lone] = sidebarGroupsForSpaces([space("space-1", "Personal", { canPause: true })], "");
    expect(lone?.canPauseSpace).toBe(false);
  });

  it("keeps the space menu for a member who cannot rename or delete, for Settings", () => {
    const groups = sidebarGroupsForSpaces(
      [space("space-1", "Personal", { canRename: true }), space("space-2", "Shared")],
      "",
    );

    expect(groups[1]).toMatchObject({
      title: "Shared",
      canRenameSpace: false,
      canDeleteSpace: false,
      canOpenSpaceSettings: true,
    });
  });

  it("keeps settings reachable in a member's only empty space", () => {
    expect(sidebarGroupsForSpaces([space("space-1", "Shared", { bots: [] })], "")).toEqual([
      expect.objectContaining({
        title: "Shared",
        spaceName: "Shared",
        canRenameSpace: false,
        canDeleteSpace: false,
        canOpenSpaceSettings: true,
      }),
    ]);
  });

  it("hides space actions while a search removes every chat from the only space", () => {
    expect(
      sidebarGroupsForSpaces([space("space-1", "Personal", { canRename: true })], "missing"),
    ).toEqual([]);
  });
});

describe("commitSpaceRename", () => {
  it("applies the saved name when the following refresh fails", async () => {
    const rename = vi.fn(async () => undefined);
    const apply = vi.fn();
    const refresh = vi.fn(async () => {
      throw new Error("list failed");
    });

    await expect(commitSpaceRename({ rename, apply, refresh })).resolves.toBeUndefined();
    expect(rename).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not apply a name when the rename itself fails", async () => {
    const apply = vi.fn();
    const refresh = vi.fn(async () => undefined);

    await expect(
      commitSpaceRename({
        rename: async () => {
          throw new Error("Space deletion is already in progress");
        },
        apply,
        refresh,
      }),
    ).rejects.toThrow("Space deletion is already in progress");
    expect(apply).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

it("counts unread bots and groups from the sidebar across spaces", () => {
  const input = [
    {
      ...space("first", "First"),
      bots: [
        { ...chat("read", "Read"), unread: false },
        { ...chat("bot", "Unread bot"), unread: true, pinned: true },
      ],
      groups: [{ ...chat("group", "Unread group"), unread: true }],
    },
    {
      ...space("second", "Second"),
      bots: [{ ...chat("other", "Other"), unread: true }],
      groups: [],
    },
  ];
  expect(countUnreadChats(sidebarGroupsForSpaces(input, ""))).toBe(3);
  expect(countUnreadChats(sidebarGroupsForSpaces(input, "Unread"))).toBe(2);
  expect(countUnreadChats(sidebarGroupsForSpaces(input, "Read group"))).toBe(1);
  expect(countUnreadChats(sidebarGroupsForSpaces(input, "missing"))).toBe(0);
  input[0]!.groups[0]!.unread = false;
  expect(countUnreadChats(sidebarGroupsForSpaces(input, ""))).toBe(2);
  input[0]!.bots[0]!.unread = true;
  expect(countUnreadChats(sidebarGroupsForSpaces(input, ""))).toBe(3);
  expect(countUnreadChats([])).toBe(0);
});
