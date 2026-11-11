import { CARD_TITLE_ESCAPED_CHARACTERS } from "./action-approval.js";

/**
 * The live activity lines the runtime writes into a thread ("Reading notes.txt") are stored in
 * English. Each surface reads them back with this so it can show them in the person's language.
 */
export type ActivityLabel =
  | {
      id:
        | "running"
        | "reading"
        | "writing"
        | "listing"
        | "attaching"
        | "opening"
        | "openingPage"
        | "readingPage"
        | "searching"
        | "readingSkill"
        | "delegating"
        | "waitingFor"
        | "using";
      value: string;
    }
  | {
      id:
        | "findingTool"
        | "lookingAtScreen"
        | "readingThePage"
        | "usingThePage"
        | "operatingComputer"
        | "savingNote"
        | "renderingChart";
    };

const FIXED: Record<string, Extract<ActivityLabel, { id: string }>> = {
  "Finding a tool": { id: "findingTool" },
  "Looking at the screen": { id: "lookingAtScreen" },
  "Reading the page": { id: "readingThePage" },
  "Using the page": { id: "usingThePage" },
  "Operating the computer": { id: "operatingComputer" },
  "Saving a note to memory": { id: "savingNote" },
  "Rendering a chart": { id: "renderingChart" },
};

// Longer prefixes first, so "Reading page: x" is not read as a file named "page: x".
const WITH_VALUE: Array<[prefix: string, id: Extract<ActivityLabel, { value: string }>["id"]]> = [
  ["Running: ", "running"],
  ["Opening page: ", "openingPage"],
  ["Reading page: ", "readingPage"],
  ["Reading skill: ", "readingSkill"],
  ["Searching the web: ", "searching"],
  ["Delegating to helper: ", "delegating"],
  ["Waiting for ", "waitingFor"],
  ["Reading ", "reading"],
  ["Writing ", "writing"],
  ["Listing ", "listing"],
  ["Attaching ", "attaching"],
  ["Opening ", "opening"],
  ["Using ", "using"],
];

/** What an activity line says, or undefined for a line that is not one of the known forms. */
export function parseActivityLabel(label: string): ActivityLabel | undefined {
  const fixed = FIXED[label];
  if (fixed) return fixed;
  for (const [prefix, id] of WITH_VALUE) {
    if (label.startsWith(prefix) && label.length > prefix.length)
      return { id, value: label.slice(prefix.length) };
  }
  return undefined;
}

const ESCAPED = new RegExp(`\\\\(${CARD_TITLE_ESCAPED_CHARACTERS})`, "g");
const REVIEW_BEFORE = "Review before ";

/**
 * The action an approval titled "Review before …" is about, with a raw tool name
 * (`CANVA_CREATE_DESIGN`) read as words. Undefined for any other title.
 */
export function reviewBeforeSummary(text: string): string | undefined {
  if (!text.startsWith(REVIEW_BEFORE)) return undefined;
  const summary = text.slice(REVIEW_BEFORE.length).replace(ESCAPED, "$1");
  if (!/^[A-Za-z0-9_]+$/.test(summary)) return summary;
  const words = summary.replaceAll("_", " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const APPROVAL_NOTICE = /^(.+) is waiting for your approval\.$/s;

/**
 * The bot named in the line a parent's chat gets when a bot it created waits for approval, so each
 * surface can say it in the person's language. Undefined for any other text.
 */
export function approvalNoticeBot(text: string): string | undefined {
  return APPROVAL_NOTICE.exec(text)?.[1];
}
