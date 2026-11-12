import { approvalNoticeBot, parseActivityLabel, reviewBeforeSummary } from "@corvo/core";
import { t } from "@lingui/core/macro";

/** An activity line the runtime wrote in English, in the person's language. Unknown lines stay as written. */
export function activityLabelText(label: string): string {
  const parsed = parseActivityLabel(label);
  if (!parsed) return label;
  if (!("value" in parsed)) {
    if (parsed.id === "findingTool") return t`Finding a tool`;
    if (parsed.id === "lookingAtScreen") return t`Looking at the screen`;
    if (parsed.id === "readingThePage") return t`Reading the page`;
    if (parsed.id === "usingThePage") return t`Using the page`;
    if (parsed.id === "operatingComputer") return t`Operating the computer`;
    if (parsed.id === "savingNote") return t`Saving a note to memory`;
    return t`Rendering a chart`;
  }
  const value = parsed.value;
  if (parsed.id === "running") return t`Running: ${value}`;
  if (parsed.id === "reading") return t`Reading ${value}`;
  if (parsed.id === "writing") return t`Writing ${value}`;
  if (parsed.id === "listing") return t`Listing ${value}`;
  if (parsed.id === "attaching") return t`Attaching ${value}`;
  if (parsed.id === "opening") return t`Opening ${value}`;
  if (parsed.id === "openingPage") return t`Opening page: ${value}`;
  if (parsed.id === "readingPage") return t`Reading page: ${value}`;
  if (parsed.id === "searching") return t`Searching the web: ${value}`;
  if (parsed.id === "readingSkill") return t`Reading skill: ${value}`;
  if (parsed.id === "delegating") return t`Delegating to helper: ${value}`;
  if (parsed.id === "waitingFor") return t`Waiting for ${value}`;
  return t`Using ${value}`;
}

/**
 * A line the server wrote in English about an approval, in the person's language: the title of an
 * approval card and the note a parent's chat gets when a bot it created waits. Other text stays.
 */
export function approvalTextLabel(text: string): string {
  const name = approvalNoticeBot(text);
  if (name !== undefined) return t`${name} is waiting for your approval.`;
  const reviewing = reviewBeforeSummary(text);
  return reviewing === undefined ? text : t`Review before ${reviewing}`;
}
