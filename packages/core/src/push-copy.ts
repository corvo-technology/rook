import { reviewBeforeSummary } from "./activity-label.js";

const NEEDS_APPROVAL_SUFFIX = " needs approval";

/** The approval push in each language the app is translated into; English is the source text. */
const APPROVAL_PUSH: Record<
  string,
  { title: (name: string) => string; body: (what: string) => string }
> = {
  "pt-BR": {
    title: (name) => `${name} precisa de aprovação`,
    body: (what) => `Confirme antes: ${what}`,
  },
  es: {
    title: (name) => `${name} necesita aprobación`,
    body: (what) => `Revisa antes: ${what}`,
  },
  de: {
    title: (name) => `${name} braucht eine Freigabe`,
    body: (what) => `Vor dem Ausführen prüfen: ${what}`,
  },
  ja: {
    title: (name) => `${name}の承認が必要です`,
    body: (what) => `実行前に確認: ${what}`,
  },
  "zh-CN": {
    title: (name) => `${name}需要审批`,
    body: (what) => `执行前请确认：${what}`,
  },
};

/**
 * An approval push in the person's language, built from the same "Review before …" title the
 * in-app card translates. Any other push, and any language without a translation, is unchanged.
 */
export function localizedApprovalPush<T extends { title: string; body: string }>(
  message: T,
  locale: string | undefined,
): T {
  const copy = locale ? APPROVAL_PUSH[locale] : undefined;
  const what = reviewBeforeSummary(message.body);
  if (!copy || what === undefined || !message.title.endsWith(NEEDS_APPROVAL_SUFFIX)) return message;
  const name = message.title.slice(0, -NEEDS_APPROVAL_SUFFIX.length);
  return { ...message, title: copy.title(name), body: copy.body(what) };
}
