import type { PartnerAlertKind } from "@corvo/contracts";

export const PARTNER_ALERT_LOCALES = ["en", "pt-BR", "es", "fr", "de", "ja", "zh-CN"] as const;
export type PartnerAlertLocale = (typeof PARTNER_ALERT_LOCALES)[number];

/**
 * One line per kind. Kinds about a customer have a form for one (`{name}`) and one for several
 * (`{n}`); the rest are a single sentence. Numbers and names only, never what a customer wrote.
 */
type Line = string | { one: string; many: string };

export interface PartnerAlertCopy {
  lines: Record<PartnerAlertKind, Line>;
  /** What stands in for a customer's name when it is not known. */
  customer: string;
  /** The subject when one email carries several alerts: `{n}` alerts. */
  several: string;
  open: string;
  /** Why the email arrived and where to switch it off: `{partner}`. */
  note: string;
}

export const PARTNER_ALERT_COPY: Record<PartnerAlertLocale, PartnerAlertCopy> = {
  en: {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name} reached its monthly limit.",
        many: "{n} customers reached their monthly limit",
      },
      "partner.balance_low": "Your credit fund is running low.",
      "partner.autotopup_started": "An automatic top-up started.",
      "partner.autotopup_failed": "The automatic top-up failed.",
      "invoice.issued": "A new invoice is ready.",
      "subscription.lapsed": {
        one: "{name} has a payment past due.",
        many: "{n} customers have a payment past due",
      },
      "customer.connector_down": {
        one: "{name}'s connector is down.",
        many: "{n} customers have a connector down",
      },
    },
    customer: "A customer",
    several: "{n} alerts",
    open: "Open",
    note: "You get this because you manage {partner}. You can switch these emails off in Integration.",
  },
  "pt-BR": {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name} atingiu o limite mensal.",
        many: "{n} clientes atingiram o limite mensal",
      },
      "partner.balance_low": "Seu fundo de créditos está acabando.",
      "partner.autotopup_started": "Uma recarga automática começou.",
      "partner.autotopup_failed": "A recarga automática falhou.",
      "invoice.issued": "Há uma nova fatura.",
      "subscription.lapsed": {
        one: "{name} está com um pagamento em atraso.",
        many: "{n} clientes estão com pagamento em atraso",
      },
      "customer.connector_down": {
        one: "O conector de {name} está fora do ar.",
        many: "{n} clientes estão com o conector fora do ar",
      },
    },
    customer: "Um cliente",
    several: "{n} avisos",
    open: "Abrir",
    note: "Você recebe este aviso por gerenciar {partner}. Dá para desativar esses e-mails em Integração.",
  },
  es: {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name} alcanzó su límite mensual.",
        many: "{n} clientes alcanzaron su límite mensual",
      },
      "partner.balance_low": "Tu fondo de créditos se está acabando.",
      "partner.autotopup_started": "Empezó una recarga automática.",
      "partner.autotopup_failed": "La recarga automática falló.",
      "invoice.issued": "Hay una factura nueva.",
      "subscription.lapsed": {
        one: "{name} tiene un pago vencido.",
        many: "{n} clientes tienen un pago vencido",
      },
      "customer.connector_down": {
        one: "El conector de {name} está caído.",
        many: "{n} clientes tienen el conector caído",
      },
    },
    customer: "Un cliente",
    several: "{n} avisos",
    open: "Abrir",
    note: "Recibes este aviso porque gestionas {partner}. Puedes desactivar estos correos en Integración.",
  },
  fr: {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name} a atteint sa limite mensuelle.",
        many: "{n} clients ont atteint leur limite mensuelle",
      },
      "partner.balance_low": "Votre réserve de crédits baisse.",
      "partner.autotopup_started": "Une recharge automatique a démarré.",
      "partner.autotopup_failed": "La recharge automatique a échoué.",
      "invoice.issued": "Une nouvelle facture est disponible.",
      "subscription.lapsed": {
        one: "{name} a un paiement en retard.",
        many: "{n} clients ont un paiement en retard",
      },
      "customer.connector_down": {
        one: "Le connecteur de {name} est hors service.",
        many: "{n} clients ont un connecteur hors service",
      },
    },
    customer: "Un client",
    several: "{n} alertes",
    open: "Ouvrir",
    note: "Vous recevez ceci car vous gérez {partner}. Vous pouvez désactiver ces e-mails dans Intégration.",
  },
  de: {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name} hat das Monatslimit erreicht.",
        many: "{n} Kunden haben das Monatslimit erreicht",
      },
      "partner.balance_low": "Ihr Guthaben geht zur Neige.",
      "partner.autotopup_started": "Eine automatische Aufladung wurde gestartet.",
      "partner.autotopup_failed": "Die automatische Aufladung ist fehlgeschlagen.",
      "invoice.issued": "Eine neue Rechnung liegt vor.",
      "subscription.lapsed": {
        one: "Bei {name} ist eine Zahlung überfällig.",
        many: "Bei {n} Kunden ist eine Zahlung überfällig",
      },
      "customer.connector_down": {
        one: "Der Connector von {name} ist ausgefallen.",
        many: "Bei {n} Kunden ist der Connector ausgefallen",
      },
    },
    customer: "Ein Kunde",
    several: "{n} Hinweise",
    open: "Öffnen",
    note: "Sie erhalten dies, weil Sie {partner} verwalten. Diese E-Mails lassen sich unter Integration ausschalten.",
  },
  ja: {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name}が月間上限に達しました。",
        many: "{n}件のお客様が月間上限に達しました",
      },
      "partner.balance_low": "クレジットの残りが少なくなっています。",
      "partner.autotopup_started": "自動チャージを開始しました。",
      "partner.autotopup_failed": "自動チャージに失敗しました。",
      "invoice.issued": "新しい請求書があります。",
      "subscription.lapsed": {
        one: "{name}の支払いが滞っています。",
        many: "{n}件のお客様の支払いが滞っています",
      },
      "customer.connector_down": {
        one: "{name}のコネクターが停止しています。",
        many: "{n}件のお客様のコネクターが停止しています",
      },
    },
    customer: "お客様",
    several: "{n}件のお知らせ",
    open: "開く",
    note: "{partner}の管理者のためお送りしています。このメールは連携の設定でオフにできます。",
  },
  "zh-CN": {
    lines: {
      "customer.credit_limit_reached": {
        one: "{name}已达到月度上限。",
        many: "{n}位客户已达到月度上限",
      },
      "partner.balance_low": "你的额度资金即将用完。",
      "partner.autotopup_started": "自动充值已开始。",
      "partner.autotopup_failed": "自动充值失败。",
      "invoice.issued": "有一张新账单。",
      "subscription.lapsed": {
        one: "{name}有一笔逾期付款。",
        many: "{n}位客户有逾期付款",
      },
      "customer.connector_down": {
        one: "{name}的连接器已中断。",
        many: "{n}位客户的连接器已中断",
      },
    },
    customer: "一位客户",
    several: "{n}条提醒",
    open: "打开",
    note: "你收到此邮件是因为你管理{partner}。可在“集成”中关闭这些邮件。",
  },
};

/** The language of the email: the person's app language when known, else the partner's market. */
export function partnerAlertLocale(locale: string | null, currency: string): PartnerAlertLocale {
  const exact = PARTNER_ALERT_LOCALES.find((candidate) => candidate === locale);
  if (exact) return exact;
  const language = locale?.split("-")[0]?.toLowerCase();
  if (language === "pt") return "pt-BR";
  if (language === "zh") return "zh-CN";
  const byLanguage = PARTNER_ALERT_LOCALES.find((candidate) => candidate === language);
  if (byLanguage) return byLanguage;
  return currency === "BRL" ? "pt-BR" : "en";
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** The sentence one kind of alert becomes. */
export function partnerAlertLine(
  copy: PartnerAlertCopy,
  item: { kind: PartnerAlertKind; count: number; names: string[] },
): string {
  const line = copy.lines[item.kind];
  if (typeof line === "string") return line;
  if (item.count === 1) return fill(line.one, { name: item.names[0] ?? copy.customer });
  const many = fill(line.many, { n: item.count });
  return item.names.length > 0 ? `${many}: ${item.names.join(", ")}` : many;
}

export { fill as fillPartnerAlertCopy };
