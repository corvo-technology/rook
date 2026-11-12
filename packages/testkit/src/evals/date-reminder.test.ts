import { describe, expect, it } from "vitest";
import {
  DATE_REMINDER_CASES,
  dateReminderInstructions,
  gradeDateReminder,
  parseDateReminderDecision,
} from "./date-reminder.js";
import type { EvalJudge } from "./judge.js";

const byId = (id: string) => DATE_REMINDER_CASES.find((c) => c.id === id)!;
const signal = new AbortController().signal;
const offer = JSON.stringify({
  offer: true,
  question: "Remind you?",
  options: ["The evening before", "No"],
});
const quiet = JSON.stringify({ offer: false, question: "", options: [] });
const passing: EvalJudge = async () => ({ pass: true, reason: "sound" });

describe("date reminder cases", () => {
  it("are twelve with unique ids, half expecting an offer", () => {
    const ids = DATE_REMINDER_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(12);
    expect(DATE_REMINDER_CASES.filter((c) => c.expected === "offer")).toHaveLength(6);
  });

  it("carry the shipped guidance into the instructions", () => {
    expect(dateReminderInstructions("GUIDE")).toContain("GUIDE");
  });
});

describe("gradeDateReminder", () => {
  it("passes an offer where one is expected, judging it when a judge is given", async () => {
    const c = byId("interview-en");
    expect((await gradeDateReminder(c, offer)).status).toBe("pass");
    let judged = 0;
    const judge: EvalJudge = async (input) => {
      judged += 1;
      expect(input.rubric).toContain("date-reminder-v1");
      return { pass: false, reason: "times do not fit" };
    };
    expect((await gradeDateReminder(c, offer, { judge, signal })).status).toBe("fail");
    expect(judged).toBe(1);
  });

  it("fails silence where an offer is expected and an offer where silence is", async () => {
    expect((await gradeDateReminder(byId("trip-en"), quiet)).status).toBe("fail");
    expect(
      (await gradeDateReminder(byId("no-date-en"), offer, { judge: passing, signal })).status,
    ).toBe("fail");
    expect((await gradeDateReminder(byId("no-date-en"), quiet)).status).toBe("pass");
  });

  it("leaves unreadable answers and judge errors unqualified, never a pass", async () => {
    expect((await gradeDateReminder(byId("trip-en"), "sure!")).status).toBe("unqualified");
    const broken: EvalJudge = async () => {
      throw new Error("down");
    };
    expect(
      (await gradeDateReminder(byId("trip-en"), offer, { judge: broken, signal })).status,
    ).toBe("unqualified");
  });

  it("reads a fenced JSON decision", () => {
    expect(parseDateReminderDecision(`\`\`\`json\n${quiet}\n\`\`\``)).toEqual({
      offer: false,
      question: "",
      options: [],
    });
  });
});
