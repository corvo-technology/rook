import type { PlanId } from "@corvo/contracts";
import type { PartnerAlertLocale } from "./partner-alert-copy.js";

/**
 * The words of the two subscription emails, in every language the email system has. Placeholders
 * are `{name}`; the amounts and dates arrive already formatted for the language and currency.
 */
export interface BillingEmailCopy {
  plans: Record<PlanId, string>;
  interval: { month: string; year: string };
  /** `{plan}` */
  activeSubject: string;
  changedSubject: string;
  /** `{plan}`, `{interval}` */
  plan: string;
  /** `{n}` */
  people: string;
  /** `{amount}` */
  charged: string;
  /** `{amount}`: dollars of model use each month. */
  ai: string;
  /** `{date}`, `{amount}` */
  renewal: string;
  cancel: string;
  manage: string;
  /** `{url}` */
  terms: string;
  /** `{date}` */
  reminderSubject: string;
  /** `{date}`, `{amount}`, `{plan}` */
  reminderCharge: string;
  reminderCancel: string;
}

export const BILLING_EMAIL_COPY: Record<PartnerAlertLocale, BillingEmailCopy> = {
  en: {
    plans: { personal: "Personal", team: "Team", company: "Company" },
    interval: { month: "monthly", year: "yearly" },
    activeSubject: "Your {plan} plan is active",
    changedSubject: "Your plan is now {plan}",
    plan: "Plan: {plan}, billed {interval}",
    people: "People: {n}",
    charged: "Charged: {amount}",
    ai: "AI: {amount} of use each month",
    renewal: "Next renewal: {date}, {amount}",
    cancel:
      "You can cancel anytime in billing settings. It takes effect at the end of the period you paid for.",
    manage: "Billing settings",
    terms: "Terms: {url}",
    reminderSubject: "Your yearly plan renews on {date}",
    reminderCharge: "On {date}, {amount} will be charged for your {plan} plan.",
    reminderCancel:
      "To avoid the charge, cancel before that date in billing settings. You keep access until the end of the period you paid for.",
  },
  "pt-BR": {
    plans: { personal: "Pessoal", team: "Equipe", company: "Empresa" },
    interval: { month: "mensal", year: "anual" },
    activeSubject: "Seu plano {plan} está ativo",
    changedSubject: "Seu plano agora é {plan}",
    plan: "Plano: {plan}, cobrança {interval}",
    people: "Pessoas: {n}",
    charged: "Cobrado: {amount}",
    ai: "IA: {amount} de uso por mês",
    renewal: "Próxima renovação: {date}, {amount}",
    cancel:
      "Você pode cancelar quando quiser nas configurações de cobrança. O cancelamento vale ao fim do período pago.",
    manage: "Configurações de cobrança",
    terms: "Termos: {url}",
    reminderSubject: "Seu plano anual renova em {date}",
    reminderCharge: "Em {date}, {amount} serão cobrados pelo plano {plan}.",
    reminderCancel:
      "Para evitar a cobrança, cancele antes dessa data nas configurações de cobrança. Você mantém o acesso até o fim do período pago.",
  },
  es: {
    plans: { personal: "Personal", team: "Equipo", company: "Empresa" },
    interval: { month: "mensual", year: "anual" },
    activeSubject: "Tu plan {plan} está activo",
    changedSubject: "Tu plan ahora es {plan}",
    plan: "Plan: {plan}, facturación {interval}",
    people: "Personas: {n}",
    charged: "Cobrado: {amount}",
    ai: "IA: {amount} de uso al mes",
    renewal: "Próxima renovación: {date}, {amount}",
    cancel:
      "Puedes cancelar cuando quieras en los ajustes de facturación. Surte efecto al final del período pagado.",
    manage: "Ajustes de facturación",
    terms: "Términos: {url}",
    reminderSubject: "Tu plan anual se renueva el {date}",
    reminderCharge: "El {date} se cobrarán {amount} por tu plan {plan}.",
    reminderCancel:
      "Para evitar el cobro, cancela antes de esa fecha en los ajustes de facturación. Conservas el acceso hasta el final del período pagado.",
  },
  fr: {
    plans: { personal: "Personnel", team: "Équipe", company: "Entreprise" },
    interval: { month: "mensuelle", year: "annuelle" },
    activeSubject: "Votre forfait {plan} est actif",
    changedSubject: "Votre forfait est maintenant {plan}",
    plan: "Forfait : {plan}, facturation {interval}",
    people: "Personnes : {n}",
    charged: "Prélevé : {amount}",
    ai: "IA : {amount} d'utilisation par mois",
    renewal: "Prochain renouvellement : {date}, {amount}",
    cancel:
      "Vous pouvez résilier à tout moment dans les paramètres de facturation. La résiliation prend effet à la fin de la période payée.",
    manage: "Paramètres de facturation",
    terms: "Conditions : {url}",
    reminderSubject: "Votre forfait annuel se renouvelle le {date}",
    reminderCharge: "Le {date}, {amount} seront prélevés pour votre forfait {plan}.",
    reminderCancel:
      "Pour éviter ce prélèvement, résiliez avant cette date dans les paramètres de facturation. Vous gardez l'accès jusqu'à la fin de la période payée.",
  },
  de: {
    plans: { personal: "Persönlich", team: "Team", company: "Unternehmen" },
    interval: { month: "monatlich", year: "jährlich" },
    activeSubject: "Ihr Tarif {plan} ist aktiv",
    changedSubject: "Ihr Tarif ist jetzt {plan}",
    plan: "Tarif: {plan}, {interval} abgerechnet",
    people: "Personen: {n}",
    charged: "Abgebucht: {amount}",
    ai: "KI: {amount} Nutzung pro Monat",
    renewal: "Nächste Verlängerung: {date}, {amount}",
    cancel:
      "Sie können jederzeit in den Abrechnungseinstellungen kündigen. Die Kündigung gilt zum Ende des bezahlten Zeitraums.",
    manage: "Abrechnungseinstellungen",
    terms: "Bedingungen: {url}",
    reminderSubject: "Ihr Jahrestarif verlängert sich am {date}",
    reminderCharge: "Am {date} werden {amount} für Ihren Tarif {plan} abgebucht.",
    reminderCancel:
      "Um die Abbuchung zu vermeiden, kündigen Sie vor diesem Datum in den Abrechnungseinstellungen. Der Zugang bleibt bis zum Ende des bezahlten Zeitraums bestehen.",
  },
  ja: {
    plans: { personal: "個人", team: "チーム", company: "企業" },
    interval: { month: "月払い", year: "年払い" },
    activeSubject: "{plan}プランが有効になりました",
    changedSubject: "プランが{plan}に変わりました",
    plan: "プラン: {plan}（{interval}）",
    people: "人数: {n}",
    charged: "請求額: {amount}",
    ai: "AI: 毎月{amount}分の利用",
    renewal: "次回の更新: {date}、{amount}",
    cancel: "解約は請求設定からいつでもできます。解約は支払い済みの期間の終了時に有効になります。",
    manage: "請求設定",
    terms: "利用規約: {url}",
    reminderSubject: "年払いプランは{date}に更新されます",
    reminderCharge: "{date}に、{plan}プランの{amount}が請求されます。",
    reminderCancel:
      "請求を避けるには、その日までに請求設定から解約してください。支払い済みの期間の終了まで利用できます。",
  },
  "zh-CN": {
    plans: { personal: "个人", team: "团队", company: "企业" },
    interval: { month: "按月", year: "按年" },
    activeSubject: "您的{plan}套餐已生效",
    changedSubject: "您的套餐已变为{plan}",
    plan: "套餐：{plan}，{interval}计费",
    people: "人数：{n}",
    charged: "已扣款：{amount}",
    ai: "AI：每月{amount}用量",
    renewal: "下次续费：{date}，{amount}",
    cancel: "您可以随时在账单设置中取消。取消将在已付费周期结束时生效。",
    manage: "账单设置",
    terms: "条款：{url}",
    reminderSubject: "您的年度套餐将于{date}续费",
    reminderCharge: "{date}将为您的{plan}套餐扣款{amount}。",
    reminderCancel: "如需避免扣款，请在该日期前于账单设置中取消。您可使用到已付费周期结束。",
  },
};
