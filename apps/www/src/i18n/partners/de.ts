import type { PartnersCopy } from "./types";

const de: PartnersCopy = {
  path: "/de/partner",
  link: "Partner",
  meta: {
    title: "Partner · Rook",
    description:
      "KI-Agenten unter Ihrer eigenen Marke: im Produkt eingebettet oder als White Label. Wiederkehrende Provision pro Kunde, plus Ihr eigener Aufschlag.",
  },
  hero: {
    title: "KI-Agenten unter Ihrer eigenen Marke anbieten",
    lead: "Binden Sie Rook in Ihr Produkt ein oder verkaufen Sie es als eigene Plattform. Sie verdienen an jedem Kunden, jeden Monat.",
    cta: "Partner werden",
    docs: "Technische Doku",
  },
  modes: {
    heading: "Zwei Wege zur Partnerschaft",
    items: [
      {
        who: "SaaS-Produkte",
        title: "In Ihr Produkt eingebettet",
        body: "Für Software von Kliniken, Barbershops oder Salons. Die Agenten leben in Ihrem Produkt und greifen per MCP auf Ihre Daten zu.",
      },
      {
        who: "Agenturen und Reseller",
        title: "White Label",
        body: "Für Agenturen und Reseller. Rook läuft unter Ihrer Marke, auf Ihrer Domain, zu Ihren Preisen.",
      },
    ],
  },
  earn: {
    heading: "So verdienen Sie",
    lead: "Eine wiederkehrende Provision auf das Abo jedes Kunden, dazu Ihr eigener Aufschlag. Der Aufschlag gehört ganz Ihnen.",
    exampleLabel: "Beispiel zur Veranschaulichung",
    price: "Kunde zahlt",
    commission: "Provision",
    markup: "Ihr Aufschlag",
    total: "Sie erhalten",
    note: "Die Prozentsätze sind pro Partner konfigurierbar, das Beispiel nutzt 20 %. Zahlen nur zur Veranschaulichung, keine Vertragsbedingungen.",
  },
  included: {
    heading: "Was bereitsteht",
    items: [
      { title: "Agenten-Vorlagen je Branche", body: "Vorlagen für Kliniken, Barbershops, Salons und mehr, mit den täglichen Abläufen." },
      { title: "Embed-SDK", body: "Rook in Ihrem Produkt, mit Ihrem Login und Ihrem Look." },
      { title: "Partner-API", body: "Kunden anlegen, Limits setzen und die Nutzung per Code verfolgen." },
      { title: "Aufzeichnung von Konsultationen", body: "Für Kliniken: Der Agent transkribiert den Termin und erstellt einen Akteneintrag als Entwurf." },
      { title: "Guthaben pro Kunde", body: "Steuern Sie, wie viel jeder Kunde ausgeben darf, und laden Sie bei Bedarf auf." },
      { title: "Webhooks", body: "Erfahren Sie, wenn das Guthaben aufgebraucht ist oder etwas Wichtiges passiert." },
      { title: "Getrennte Daten", body: "Jeder Kunde in seinem eigenen Bereich, getrennt von den anderen." },
      { title: "LGPD", body: "Der Umgang mit personenbezogenen Daten ist von Anfang an auf das brasilianische Gesetz ausgelegt." },
    ],
  },
  proof: {
    heading: "Läuft bereits in echten Produkten",
    body: "Eine Familie vertikaler Produkte für Kliniken, Barbershops und Salons nutzt Rook eingebettet. Die Agenten antworten, planen und dokumentieren, verbunden mit den Daten jedes Kunden.",
  },
  how: {
    heading: "So funktioniert es",
    steps: [
      { title: "Sprechen Sie mit uns", body: "Erzählen Sie uns von Produkt und Kunden. Wir antworten in wenigen Tagen." },
      { title: "Vorlage einrichten", body: "Gemeinsam wählen wir Agenten, Limits und Preise." },
      { title: "Integrieren", body: "Mit dem SDK einbetten oder Ihr White Label starten." },
      { title: "Verkaufen", body: "Ihre Kunden abonnieren und Sie werden jeden Monat bezahlt." },
    ],
  },
  faq: {
    heading: "Fragen",
    items: [
      { question: "Muss ich programmieren können?", answer: "Zum Einbetten in Ihr Produkt ja: SDK und API sind für Ihr technisches Team. White Label kommt ohne Code aus." },
      { question: "Wer betreut meine Kunden?", answer: "Sie bleiben die erste Anlaufstelle und wir stehen dahinter. Das klären wir im ersten Gespräch." },
      { question: "Sind die Daten meiner Kunden getrennt?", answer: "Ja. Jeder Kunde hat einen isolierten Bereich, und die Agenten erreichen nur, was Sie anbinden." },
      { question: "Was kostet der Einstieg?", answer: "Wir besprechen das Modell, das zu Ihrem Geschäft passt. Das Formular verpflichtet zu nichts." },
      { question: "Kann ich meine eigene Domain und Marke nutzen?", answer: "Ja. Im White Label erscheint Rook unter Ihrer Marke, auf Ihrer Domain, zu Ihren Preisen." },
    ],
  },
  form: {
    heading: "Partner werden",
    name: "Name",
    email: "Geschäftliche E-Mail",
    company: "Unternehmen",
    website: "Website",
    type: "Wie möchten Sie Partner werden",
    types: { embedded: "In mein Produkt eingebettet", white_label: "White Label", unsure: "Noch unsicher" },
    country: "Land",
    customers: "Wie viele Kunden haben Sie",
    customerRanges: ["Bis 50", "50 bis 200", "200 bis 1.000", "Über 1.000"],
    message: "Nachricht",
    consent: "Ich bin damit einverstanden, zum Partnerprogramm kontaktiert zu werden und dass meine Daten dafür verarbeitet werden.",
    submit: "Senden",
    successTitle: "Wir haben Ihre Nachricht erhalten.",
    success: "Wir haben eine E-Mail an {email} gesendet. Wir melden uns bald.",
    error: "Das Senden hat gerade nicht geklappt. Versuchen Sie es gleich noch einmal.",
    requiredError: "Bitte füllen Sie dieses Feld aus.",
    emailError: "Geben Sie eine gültige E-Mail ein.",
    consentError: "Wir benötigen Ihre Einwilligung, um fortzufahren.",
  },
};

export default de;
