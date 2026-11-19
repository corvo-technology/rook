import type { TransactionalEmail } from "@corvo/adapter-kit";
import { noticeEmail } from "@corvo/auth";
import type { PartnerAlertDigest } from "@corvo/db";
import {
  fillPartnerAlertCopy,
  PARTNER_ALERT_COPY,
  partnerAlertLine,
  partnerAlertLocale,
} from "./partner-alert-copy.js";

/** The email for one batch of alerts, in the reader's language: one line per kind, one button. */
export function partnerAlertEmail(
  webOrigin: string,
  digest: PartnerAlertDigest,
): Promise<TransactionalEmail> {
  const locale = partnerAlertLocale(digest.locale, digest.partner.currency);
  const copy = PARTNER_ALERT_COPY[locale];
  const total = digest.items.reduce((sum, item) => sum + item.count, 0);
  const lines = digest.items.map((item) => partnerAlertLine(copy, item));
  const first = lines[0] ?? "";
  return noticeEmail(webOrigin, {
    to: digest.to,
    lang: locale,
    subject: `${digest.partner.name}: ${
      digest.items.length === 1 && total === 1
        ? first
        : fillPartnerAlertCopy(copy.several, { n: total })
    }`,
    title: digest.partner.name,
    lines,
    action: { label: copy.open, url: new URL(digest.path, webOrigin).href },
    note: fillPartnerAlertCopy(copy.note, { partner: digest.partner.name }),
  });
}
