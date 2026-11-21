import { RoutineWatchSchema } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RoutineWatchTickDeps } from "./routine-watch.js";
import { checkRoutineWatch, pickPresetTool } from "./routine-watch.js";
import {
  expandWatchArgs,
  findConflicts,
  parseCalendarEvents,
  presetToolName,
  readCalendarPreset,
  readEmailPreset,
} from "./routine-watch-presets.js";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const ZONE = "America/Sao_Paulo";

function event(id: string, summary: string, start: string, end: string, extra = {}) {
  return { id, summary, start: { dateTime: start }, end: { dateTime: end }, ...extra };
}

const standup = event("a", "Standup", "2026-11-21T13:00:00Z", "2026-11-21T13:30:00Z");
const review = event("b", "Design review", "2026-11-22T15:00:00Z", "2026-11-22T16:00:00Z");

function calendar(items: unknown[], now = NOW, leadMinutes?: number) {
  return readCalendarPreset({ items }, { now, timeZone: ZONE, leadMinutes });
}

describe("calendar preset", () => {
  it("normalizes Google-style and flat events and skips cancelled ones", () => {
    const events = parseCalendarEvents({
      items: [
        standup,
        {
          id: "c",
          title: "Flat",
          start_time: "2026-11-21T10:00:00Z",
          end_time: "2026-11-21T11:00:00Z",
        },
        {
          id: "d",
          summary: "Gone",
          status: "cancelled",
          start: { dateTime: "2026-11-21T10:00:00Z" },
        },
        { id: "e", summary: "Holiday", start: { date: "2026-11-23" }, end: { date: "2026-11-24" } },
      ],
    });
    expect(events.map((e) => e.id).sort()).toEqual(["a", "c", "e"]);
    expect(events.find((e) => e.id === "e")?.allDay).toBe(true);
  });

  it("finds overlaps but not back-to-back, free or all-day events", () => {
    const events = parseCalendarEvents({
      items: [
        event("a", "A", "2026-11-21T10:00:00Z", "2026-11-21T11:00:00Z"),
        event("b", "B", "2026-11-21T10:30:00Z", "2026-11-21T11:30:00Z"),
        event("c", "C", "2026-11-21T11:30:00Z", "2026-11-21T12:00:00Z"),
        event("d", "Free", "2026-11-21T10:00:00Z", "2026-11-21T12:00:00Z", {
          transparency: "transparent",
        }),
        { id: "e", summary: "All day", start: { date: "2026-11-21" }, end: { date: "2026-11-22" } },
      ],
    });
    expect(findConflicts(events).map(([x, y]) => `${x.id}${y.id}`)).toEqual(["ab"]);
  });

  it("is quiet when nothing changed", () => {
    const first = calendar([standup, review]);
    const again = calendar([standup, review]);
    expect(again.changeNote(first.entries, NOW)).toBeNull();
  });

  it("reports a new event with its start in the user's timezone", () => {
    const first = calendar([standup]);
    const note = calendar([standup, review]).changeNote(first.entries, NOW);
    expect(note).toContain(`Times in ${ZONE}`);
    expect(note).toContain("New events:");
    expect(note).toContain("Design review");
    expect(note).toContain("12:00-13:00");
  });

  it("reports a moved event and a cancelled future event", () => {
    const first = calendar([standup, review]);
    const moved = event("a", "Standup", "2026-11-21T14:00:00Z", "2026-11-21T14:30:00Z");
    const note = calendar([moved]).changeNote(first.entries, NOW) ?? "";
    expect(note).toContain("Moved or renamed:");
    expect(note).toContain("was Sat 21 Nov, 10:00-10:30, now Sat 21 Nov, 11:00-11:30");
    expect(note).toContain("Cancelled:");
    expect(note).toContain("Design review");
  });

  it("does not report an event that simply ended", () => {
    const soon = event("x", "Quick sync", "2026-11-20T12:30:00Z", "2026-11-20T13:00:00Z");
    const first = calendar([soon, standup], NOW, 5);
    const later = new Date("2026-11-20T13:30:00Z");
    expect(calendar([standup], later, 5).changeNote(first.entries, NOW)).toBeNull();
  });

  it("reports a new conflict caused by a new or moved event only", () => {
    const first = calendar([standup, review]);
    const clash = event("n", "Customer call", "2026-11-21T13:15:00Z", "2026-11-21T14:00:00Z");
    const note = calendar([standup, review, clash]).changeNote(first.entries, NOW) ?? "";
    expect(note).toContain("Conflicts:");
    expect(note).toContain("Standup overlaps Customer call");
    // Once recorded, the same conflict is not news again.
    const recorded = calendar([standup, review, clash]);
    expect(calendar([standup, review, clash]).changeNote(recorded.entries, NOW)).toBeNull();
  });

  it("wakes once for a meeting starting within the lead time", () => {
    const meeting = event("m", "Board sync", "2026-11-20T12:10:00Z", "2026-11-20T13:00:00Z");
    const early = calendar([meeting], new Date("2026-11-20T11:30:00Z"), 15);
    expect(early.entries["soon:m"]).toBeUndefined();
    const inWindow = calendar([meeting], new Date("2026-11-20T11:58:00Z"), 15);
    const note = inWindow.changeNote(early.entries, new Date("2026-11-20T11:30:00Z"));
    expect(note).toContain("Starting soon:");
    expect(note).toContain("Board sync");
    expect(note).toContain("in 12 min");
    const next = calendar([meeting], new Date("2026-11-20T12:05:00Z"), 15);
    expect(next.changeNote(inWindow.entries, new Date("2026-11-20T11:58:00Z"))).toBeNull();
  });

  it("does not call an event entering the 7-day window new", () => {
    const far = event("f", "Offsite", "2026-11-27T13:00:00Z", "2026-11-27T14:00:00Z");
    const first = calendar([standup]);
    const later = new Date("2026-11-20T12:15:00Z");
    expect(calendar([standup, far], later).changeNote(first.entries, NOW)).toBeNull();
  });

  it("expands time placeholders in tool arguments", () => {
    expect(expandWatchArgs({ timeMin: "{{now}}", nested: { max: "{{in7d}}" }, n: 1 }, NOW)).toEqual(
      {
        timeMin: "2026-11-20T12:00:00.000Z",
        nested: { max: "2026-11-27T12:00:00.000Z" },
        n: 1,
      },
    );
  });
});

function gmail(
  id: string,
  from: string,
  subject: string,
  labelIds: string[],
  headers: object[] = [],
) {
  return {
    id,
    labelIds,
    payload: {
      headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...headers],
    },
  };
}

describe("email preset", () => {
  const options = { userEmails: ["me@example.com"] };

  it("keeps only unread mail from people", () => {
    const reading = readEmailPreset(
      {
        messages: [
          gmail("1", "Ana <ana@acme.test>", "Contract", ["INBOX", "UNREAD"]),
          gmail("2", "Bob <bob@acme.test>", "Already read", ["INBOX"]),
          gmail("3", "Me <me@example.com>", "Note to self", ["INBOX", "UNREAD"]),
          gmail("4", "noreply@shop.test", "Receipt", ["INBOX", "UNREAD"]),
          gmail("5", "Deals <hello@shop.test>", "Sale", ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"]),
          gmail(
            "6",
            "News <editor@paper.test>",
            "Weekly",
            ["INBOX", "UNREAD"],
            [{ name: "List-Unsubscribe", value: "<mailto:x@y.test>" }],
          ),
        ],
      },
      options,
    );
    expect(Object.keys(reading.entries)).toEqual(["msg:1"]);
  });

  it("handles flat message shapes with read flags", () => {
    const reading = readEmailPreset(
      [
        { id: "a", from: { email: "Cleo@acme.test" }, subject: "Hi", isRead: false },
        { id: "b", from: "dan@acme.test", subject: "Seen", isRead: true },
      ],
      options,
    );
    expect(Object.keys(reading.entries)).toEqual(["msg:a"]);
  });

  it("wakes with ids, senders and subjects for new messages only", () => {
    const first = readEmailPreset(
      { messages: [gmail("1", "ana@acme.test", "One", ["UNREAD"])] },
      options,
    );
    const next = readEmailPreset(
      {
        messages: [
          gmail("1", "ana@acme.test", "One", ["UNREAD"]),
          gmail("2", "Bob <bob@acme.test>", "Two", ["UNREAD"]),
        ],
      },
      options,
    );
    const note = next.changeNote(first.entries, null);
    expect(note).toBe('New unread mail:\n- id 2 | from bob@acme.test | subject "Two"');
    expect(note).not.toContain("snippet");
    expect(readEmailPreset({ messages: [] }, options).changeNote(next.entries, null)).toBeNull();
  });
});

describe("preset tool names", () => {
  it.each([
    ["calendar", "GOOGLECALENDAR_EVENTS_LIST", true],
    ["calendar", "GOOGLECALENDAR_CREATE_EVENT", false],
    ["calendar", "google_calendar-list-events", true],
    ["email", "GMAIL_FETCH_EMAILS", true],
    ["email", "GMAIL_LIST_MESSAGES", true],
    ["email", "gmail-find-email", true],
    ["email", "GMAIL_SEND_EMAIL", false],
  ] as const)("%s %s -> %s", (preset, name, expected) => {
    expect(presetToolName(preset, name)).toBe(expected);
  });
});

describe("preset watch through a fake connector", () => {
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ timezone: ZONE, email: "me@example.com" })) },
    connection: { findMany: vi.fn(async () => []) },
    spaceSettingOverride: { findUnique: vi.fn(async () => null) },
    actionApprovalRule: { findMany: vi.fn(async () => []) },
    userActionApprovalRule: { findMany: vi.fn(async () => []) },
  };
  function deps(
    results: unknown[],
    tools = [{ name: "GOOGLECALENDAR_EVENTS_LIST", readOnly: true }],
  ) {
    const execute = vi.fn(async function* () {
      yield { type: "result", data: results.shift() };
    });
    return {
      deps: {
        prisma,
        connector: {
          discoverTools: vi.fn(async () =>
            tools.map((t) => ({ ...t, route: { connectorId: "c" } })),
          ),
          execute,
        },
      } as unknown as RoutineWatchTickDeps,
      execute,
    };
  }
  const routine = (watch: unknown, watchState: unknown = null) => ({
    id: "r",
    spaceId: "s",
    userId: "u",
    botId: "b",
    watch,
    watchState,
  });
  const calendarWatch = RoutineWatchSchema.parse({
    kind: "tool",
    tool: "GOOGLECALENDAR_EVENTS_LIST",
    preset: "calendar",
    args: { timeMin: "{{now}}", timeMax: "{{in7d}}" },
  });

  it("baselines, stays quiet, then wakes on a real change with a fenced note", async () => {
    const { deps: d, execute } = deps([
      { items: [standup] },
      { items: [standup] },
      { items: [standup, review] },
    ]);
    const baseline = await checkRoutineWatch(d, routine(calendarWatch), NOW);
    expect(baseline.state.outcome).toBe("baseline");
    expect((execute.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      args: { timeMin: NOW.toISOString(), timeMax: "2026-11-27T12:00:00.000Z" },
    });
    const quiet = await checkRoutineWatch(d, routine(calendarWatch, baseline.state), NOW);
    expect(quiet).toMatchObject({ changed: false, state: { outcome: "unchanged" } });
    const changed = await checkRoutineWatch(d, routine(calendarWatch, quiet.state), NOW);
    expect(changed.changed).toBe(true);
    expect(changed.state.detail).toContain("Design review");
  });

  it("finds a connected tool for a preset and ignores write tools", async () => {
    const { deps: d } = deps(
      [],
      [
        { name: "GOOGLECALENDAR_CREATE_EVENT", readOnly: false },
        { name: "GOOGLECALENDAR_EVENTS_LIST", readOnly: true },
      ],
    );
    const target = { spaceId: "s", userId: "u", botId: "b" };
    expect(await pickPresetTool(d, target, "calendar")).toBe("GOOGLECALENDAR_EVENTS_LIST");
    expect(await pickPresetTool(d, target, "email")).toBeNull();
  });

  it("validates preset rules", () => {
    expect(
      RoutineWatchSchema.safeParse({ kind: "command", command: "x", preset: "email" }).success,
    ).toBe(false);
    expect(
      RoutineWatchSchema.safeParse({ kind: "tool", tool: "t", preset: "email", leadMinutes: 10 })
        .success,
    ).toBe(false);
    expect(
      RoutineWatchSchema.safeParse({ kind: "tool", tool: "t", preset: "calendar", leadMinutes: 10 })
        .success,
    ).toBe(true);
    expect(
      RoutineWatchSchema.safeParse({ kind: "tool", tool: "t", preset: "email", track: ["id"] })
        .success,
    ).toBe(false);
  });
});
