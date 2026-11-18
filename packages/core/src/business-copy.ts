import type { BusinessKind } from "@corvo/contracts";
import { matchUiLocale } from "./ui-locale.js";

type BusinessCopy = {
  /** The wiki page every agent reads for what the workspace does. */
  title: string;
  /** The page's kind, shown as its heading in the wiki index. */
  type: string;
  /** "Type of business: X." */
  line: (kind: string) => string;
  kinds: Record<BusinessKind, string>;
};

const COPY = {
  en: {
    title: "About the business",
    type: "Business",
    line: (kind) => `Type of business: ${kind}.`,
    kinds: {
      agency: "Agency",
      "online-store": "Online store",
      clinic: "Clinic or practice",
      software: "Software and apps",
      "customer-service": "Customer service",
      "services-office": "Services office",
      other: "Something else",
    },
  },
  "pt-BR": {
    title: "Sobre o negócio",
    type: "Negócio",
    line: (kind) => `Tipo de negócio: ${kind}.`,
    kinds: {
      agency: "Agência",
      "online-store": "Loja online",
      clinic: "Clínica ou consultório",
      software: "Software e apps",
      "customer-service": "Atendimento ao cliente",
      "services-office": "Escritório de serviços",
      other: "Outra coisa",
    },
  },
  es: {
    title: "Sobre el negocio",
    type: "Negocio",
    line: (kind) => `Tipo de negocio: ${kind}.`,
    kinds: {
      agency: "Agencia",
      "online-store": "Tienda online",
      clinic: "Clínica o consulta",
      software: "Software y apps",
      "customer-service": "Atención al cliente",
      "services-office": "Oficina de servicios",
      other: "Otra cosa",
    },
  },
  de: {
    title: "Über das Unternehmen",
    type: "Unternehmen",
    line: (kind) => `Art des Unternehmens: ${kind}.`,
    kinds: {
      agency: "Agentur",
      "online-store": "Onlineshop",
      clinic: "Klinik oder Praxis",
      software: "Software und Apps",
      "customer-service": "Kundenservice",
      "services-office": "Dienstleistungsbüro",
      other: "Etwas anderes",
    },
  },
  fr: {
    title: "À propos de l'entreprise",
    type: "Entreprise",
    line: (kind) => `Type d'entreprise : ${kind}.`,
    kinds: {
      agency: "Agence",
      "online-store": "Boutique en ligne",
      clinic: "Clinique ou cabinet",
      software: "Logiciels et applications",
      "customer-service": "Service client",
      "services-office": "Cabinet de services",
      other: "Autre chose",
    },
  },
  ja: {
    title: "事業について",
    type: "事業",
    line: (kind) => `事業の種類：${kind}。`,
    kinds: {
      agency: "代理店",
      "online-store": "オンラインストア",
      clinic: "クリニック・診療所",
      software: "ソフトウェアとアプリ",
      "customer-service": "カスタマーサービス",
      "services-office": "サービス事務所",
      other: "その他",
    },
  },
  "zh-CN": {
    title: "关于业务",
    type: "业务",
    line: (kind) => `业务类型：${kind}。`,
    kinds: {
      agency: "代理机构",
      "online-store": "网店",
      clinic: "诊所",
      software: "软件和应用",
      "customer-service": "客户服务",
      "services-office": "服务办公室",
      other: "其他",
    },
  },
} satisfies Record<string, BusinessCopy>;

/** The wording of the business page in a language; any other language reads English. */
export function businessCopy(locale: string | null | undefined): BusinessCopy {
  return COPY[matchUiLocale(locale, Object.keys(COPY) as (keyof typeof COPY)[])];
}
