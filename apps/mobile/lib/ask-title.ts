import { approvalNoticeBot, CARD_TITLE_ESCAPED_CHARACTERS, reviewBeforeSummary } from "@corvo/core";
import { t } from "./i18n";

const ESCAPED = new RegExp(`\\\\(${CARD_TITLE_ESCAPED_CHARACTERS})`, "g");

/** An ask title as plain text: the names in it were escaped for web's Markdown rendering. */
export function plainAskTitle(text: string): string {
  const summary = reviewBeforeSummary(text);
  if (summary !== undefined) return t("Review before {summary}", { summary });
  return text.replace(ESCAPED, "$1");
}

/** The note a parent's chat gets when a bot it created waits for approval, in the person's language. */
export function approvalNoticeText(text: string): string {
  const name = approvalNoticeBot(text);
  return name === undefined ? text : t("{name} is waiting for your approval.", { name });
}
