import { reviewBeforeSummary } from "./activity-label.js";
import { matchUiLocale } from "./ui-locale.js";

const LOCALES = ["de", "es", "ja", "pt-BR", "zh-CN"] as const;
type NotificationLocale = (typeof LOCALES)[number];

type ApprovalCopy = {
  /** "{name} needs approval" */
  title: (name: string) => string;
  /** "Review before {summary}" */
  body: (summary: string) => string;
};

/** The approval push in each language the apps ship; the body matches the in-app card title. */
const APPROVAL_COPY: Record<NotificationLocale, ApprovalCopy> = {
  de: {
    title: (name) => `${name} braucht eine Freigabe`,
    body: (summary) => `Vor dem Ausführen prüfen: ${summary}`,
  },
  es: {
    title: (name) => `${name} necesita aprobación`,
    body: (summary) => `Revisa antes: ${summary}`,
  },
  ja: {
    title: (name) => `${name} の承認が必要です`,
    body: (summary) => `実行前に確認: ${summary}`,
  },
  "pt-BR": {
    title: (name) => `${name} precisa de aprovação`,
    body: (summary) => `Confirme antes: ${summary}`,
  },
  "zh-CN": {
    title: (name) => `${name} 需要批准`,
    body: (summary) => `执行前请确认：${summary}`,
  },
};

const NEEDS_APPROVAL = /^(.+) needs approval$/s;

/**
 * An approval push the server wrote in English, in the language of the device that receives it.
 * Any other push, and any language without a catalog, stays as written.
 */
export function localizeApprovalNotification<T extends { title: string; body: string }>(
  message: T,
  locale: string | null | undefined,
): T {
  const language = matchUiLocale(locale, LOCALES);
  if (language === "en") return message;
  const copy = APPROVAL_COPY[language];
  const name = NEEDS_APPROVAL.exec(message.title)?.[1];
  const summary = reviewBeforeSummary(message.body);
  if (name === undefined || summary === undefined) return message;
  return { ...message, title: copy.title(name), body: copy.body(summary) };
}
